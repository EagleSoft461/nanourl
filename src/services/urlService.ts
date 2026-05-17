import { pgPool } from '../config/database';
import { redis } from '../config/database';
import { snowflake } from '../generators/snowflake';
import { CreateURLRequest, CreateURLResponse, RedirectResolution } from '../domain/url';
import { PostgresURLRepository } from '../repositories/postgres/PostgresURLRepository';
import { RedisCacheProvider } from '../infrastructure/cache/RedisCacheProvider';
import { URLRepository } from '../repositories/urlRepository';
import { CacheProvider } from '../infrastructure/cache/cacheProvider';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export class URLService {
  constructor(
    private readonly repository: URLRepository,
    private readonly cache: CacheProvider
  ) {}

  async createUrl(input: CreateURLRequest): Promise<CreateURLResponse> {
    const shortCode = input.customAlias ?? snowflake.generateShortCode();

    // Çakışma kontrolü — önce cache, sonra DB
    const cacheKey = this.getCacheKey(shortCode);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      throw new Error('Custom alias already taken');
    }

    const existing = await this.repository.findByShortCode(shortCode);
    if (existing) {
      throw new Error('Custom alias already taken');
    }

    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null;

    const created = await this.repository.create({
      originalURL: input.url,
      shortCode,
      expiresAt,
    });

    // Cache'e yaz
    await this.cache.set(
      cacheKey,
      { originalUrl: created.originalUrl, expiresAt: created.expiresAt },
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

    // 1. Cache kontrolü
    const cached = await this.cache.get<{ originalUrl: string; expiresAt: string | null }>(cacheKey);
    if (cached) {
      if (this.isExpired(cached.expiresAt ? new Date(cached.expiresAt) : null)) {
        await this.cache.del(cacheKey);
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

    // 4. Cache'e yaz
    const ttlSeconds = url.expiresAt
      ? Math.floor((url.expiresAt.getTime() - Date.now()) / 1000)
      : 60 * 60;

    await this.cache.set(
      cacheKey,
      { originalUrl: url.originalUrl, expiresAt: url.expiresAt?.toISOString() ?? null },
      ttlSeconds
    );

    // 5. Click sayacını async artır (fire and forget)
    this.repository.incrementClickCount(shortCode).catch(() => {});

    return { status: 'found', originalUrl: url.originalUrl };
  }

  async deleteUrl(shortCode: string): Promise<void> {
    await this.repository.delete(shortCode);
    await this.cache.del(this.getCacheKey(shortCode));
  }

  private getCacheKey(shortCode: string): string {
    return `url:${shortCode}`;
  }

  private isExpired(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() < Date.now();
  }
}

// Singleton — production'da gerçek bağımlılıklarla initialize edilir
export const urlService = new URLService(
  new PostgresURLRepository(pgPool),
  new RedisCacheProvider(redis)
);
