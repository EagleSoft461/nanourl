import { pgPool, redis } from '../config/database';
import { snowflake } from '../generators/snowflake';
import { CreateURLRequest, CreateURLResponse, RedirectResolution } from '../domain/url';
import { PostgresURLRepository } from '../repositories/postgres/PostgresURLRepository';
import { RedisCacheProvider } from '../infrastructure/cache/RedisCacheProvider';
import { URLRepository, URLRecord, ListURLsOptions, PaginatedResult } from '../repositories/urlRepository';
import { CacheProvider } from '../infrastructure/cache/cacheProvider';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Kaç kez yeniden deneneceği — auto-generated short code çakışmasında
const MAX_RETRIES = 3;

export class URLService {
  constructor(
    private readonly repository: URLRepository,
    private readonly cache: CacheProvider
  ) {}

  async createUrl(input: CreateURLRequest): Promise<CreateURLResponse> {
    // Custom alias ise retry yok — çakışma direkt hata
    if (input.customAlias) {
      return this._insertUrl(input.customAlias, input);
    }

    // Auto-generated short code — çakışmada max 3 kez yeniden dene
    // Neden? Snowflake teorik olarak unique ama aynı ms'de aynı node
    // sequence overflow yaşarsa çakışma olabilir. Retry bunu güvenli hale getirir.
    let lastError: Error = new Error('Failed to generate unique short code');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const shortCode = snowflake.generateShortCode();
      try {
        return await this._insertUrl(shortCode, input);
      } catch (err) {
        if (err instanceof Error && err.message === 'Short code already exists') {
          lastError = err;
          continue; // Yeni kod üretip tekrar dene
        }
        throw err; // Başka bir hata ise direkt fırlat
      }
    }

    throw new Error(`${lastError.message} after ${MAX_RETRIES} attempts`);
  }

  // createUrl'in iç yardımcısı — tek bir insert denemesi yapar
  private async _insertUrl(
    shortCode: string,
    input: CreateURLRequest
  ): Promise<CreateURLResponse> {
    const cacheKey = this.getCacheKey(shortCode);

    // Önce cache'e bak (hızlı yol)
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      throw new Error(
        input.customAlias ? 'Custom alias already taken' : 'Short code already exists'
      );
    }

    // Sonra DB'ye bak
    const existing = await this.repository.findByShortCode(shortCode);
    if (existing) {
      throw new Error(
        input.customAlias ? 'Custom alias already taken' : 'Short code already exists'
      );
    }

    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null;

    const created = await this.repository.create({
      originalURL: input.url,
      shortCode,
      expiresAt,
    });

    // Yeni kaydı cache'e yaz (5 dakika TTL)
    await this.cache.set(
      cacheKey,
      { originalUrl: created.originalUrl, expiresAt: created.expiresAt?.toISOString() ?? null },
      60 * 5
    );

    return {
      shortCode: created.shortCode,
      shortUrl: `${BASE_URL}/${created.shortCode}`,
      originalUrl: created.originalUrl,
      expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
      qrCode: `${BASE_URL}/qr/${created.shortCode}`,
    };
  }

  async resolveRedirect(shortCode: string): Promise<RedirectResolution> {
    const cacheKey = this.getCacheKey(shortCode);

    // 1. Cache kontrolü (Redis)
    // Neden önce cache? DB'ye gitmeden önce hızlı cevap vermek için.
    const cached = await this.cache.get<{ originalUrl: string; expiresAt: string | null }>(cacheKey);
    if (cached) {
      if (this.isExpired(cached.expiresAt ? new Date(cached.expiresAt) : null)) {
        await this.cache.del(cacheKey); // Süresi dolmuş kaydı cache'den temizle
        return { status: 'expired' };
      }
      return { status: 'found', originalUrl: cached.originalUrl };
    }

    // 2. DB lookup
    const url = await this.repository.findByShortCode(shortCode);
    if (!url) {
      return { status: 'not_found' };
    }

    // 3. Expiry kontrolü
    if (this.isExpired(url.expiresAt ?? null)) {
      await this.cache.del(cacheKey);
      return { status: 'expired' };
    }

    // 4. Kalan TTL kadar cache'e yaz
    // Neden kalan TTL? URL'nin expiry'sinden fazla cache'de kalmasın.
    const ttlSeconds = url.expiresAt
      ? Math.floor((url.expiresAt.getTime() - Date.now()) / 1000)
      : 60 * 60; // Expiry yoksa 1 saat

    await this.cache.set(
      cacheKey,
      { originalUrl: url.originalUrl, expiresAt: url.expiresAt?.toISOString() ?? null },
      ttlSeconds
    );

    // 5. Click sayacını async artır (fire and forget)
    // Neden async? Redirect hızını etkilememek için. Sayaç 1-2 saniye gecikmeli
    // güncellense de kullanıcı fark etmez.
    this.repository.incrementClickCount(shortCode).catch(() => {});

    return { status: 'found', originalUrl: url.originalUrl };
  }

  async deleteUrl(shortCode: string): Promise<void> {
    await this.repository.delete(shortCode);
    await this.cache.del(this.getCacheKey(shortCode));
  }

  async getInfo(shortCode: string): Promise<URLRecord | null> {
    // Önce cache'e bak, yoksa DB'den al
    // Not: cache'de sadece redirect için gereken minimal veri var,
    // tam metadata (clickCount, userId vb.) için DB'ye gitmek gerekebilir.
    return this.repository.findByShortCode(shortCode);
  }

  async updateUrl(
    shortCode: string,
    data: { url?: string; expiresIn?: number | null }
  ): Promise<URLRecord | null> {
    const updated = await this.repository.update(shortCode, {
      originalURL: data.url,
      // expiresIn saniye cinsinden gelir, Date'e çevir
      // null gelirse expiry kaldırılıyor demektir
      expiresAt:
        data.expiresIn === null
          ? null
          : data.expiresIn !== undefined
          ? new Date(Date.now() + data.expiresIn * 1000)
          : undefined,
    });

    if (updated) {
      // Cache'i güncelle — eski veri kalmasın
      await this.cache.set(
        this.getCacheKey(shortCode),
        { originalUrl: updated.originalUrl, expiresAt: updated.expiresAt?.toISOString() ?? null },
        60 * 5
      );
    }

    return updated;
  }

  async listUrls(options: {
    page?: number;
    pageSize?: number;
    sort?: string;
    order?: string;
    search?: string;
  }): Promise<PaginatedResult<URLRecord>> {
    // Kullanıcıdan gelen değerleri güvenli varsayılanlarla normalize et
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const sort = options.sort === 'click_count' ? 'click_count' : 'created_at';
    const order = options.order === 'asc' ? 'asc' : 'desc';

    return this.repository.list({ page, pageSize, sort, order, search: options.search });
  }

  private getCacheKey(shortCode: string): string {
    return `url:${shortCode}`;
  }

  private isExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  }
}

// Singleton — uygulama boyunca tek bir instance kullanılır
export const urlService = new URLService(
  new PostgresURLRepository(pgPool),
  new RedisCacheProvider(redis)
);
