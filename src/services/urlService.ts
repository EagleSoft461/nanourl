import { pgPool, redis } from '../config/database';
import { snowflake } from '../generators/snowflake';
import { URLEntity, CreateURLRequest, CreateURLResponse, RedirectResolution } from '../domain/url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface CachedUrl {
  originalUrl: string;
  expiresAt: string | null;
}

export class URLService {
  async createUrl(request: CreateURLRequest): Promise<CreateURLResponse> {
    const shortCode = request.customAlias || snowflake.generateShortCode();
    
    if (request.customAlias) {
      const existing = await this.findByShortCode(shortCode);
      if (existing) {
        throw new Error('Custom alias already taken');
      }
    }

    const expiresAt = request.expiresIn 
      ? new Date(Date.now() + request.expiresIn * 1000)
      : null;

    const result = await pgPool.query(
      'INSERT INTO urls (short_code, original_url, expires_at, click_count, custom_alias) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [shortCode, request.url, expiresAt, 0, !!request.customAlias]
    );

    const { created_at } = result.rows[0];

    await this.cacheUrl(shortCode, {
      originalUrl: request.url,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });

    return {
      shortCode,
      shortUrl: BASE_URL + '/' + shortCode,
      originalUrl: request.url,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      createdAt: created_at.toISOString(),
      qrCode: BASE_URL + '/qr/' + shortCode,
    };
  }

  async findByShortCode(shortCode: string): Promise<URLEntity | null> {
    const cached = await redis.get('url:' + shortCode);
    if (cached) {
      const cachedUrl = this.parseCachedUrl(cached);
      if (!cachedUrl) {
        await redis.del('url:' + shortCode);
      } else {
        return {
          shortCode,
          originalUrl: cachedUrl.originalUrl,
          expiresAt: cachedUrl.expiresAt ? new Date(cachedUrl.expiresAt) : null,
          clickCount: 0,
          customAlias: false,
        } as URLEntity;
      }
    }

    const result = await pgPool.query(
      'SELECT * FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const entity = {
      id: row.id,
      shortCode: row.short_code,
      originalUrl: row.original_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      clickCount: row.click_count,
      userId: row.user_id,
      customAlias: row.custom_alias,
    };

    if (!entity.expiresAt || new Date(entity.expiresAt) > new Date()) {
      await this.cacheUrl(shortCode, {
        originalUrl: row.original_url,
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      });
    }

    return entity;
  }

  async resolveRedirect(shortCode: string): Promise<RedirectResolution> {
    const url = await this.findByShortCode(shortCode);
    
    if (!url) return { status: 'not_found' };
    
    if (url.expiresAt && new Date(url.expiresAt) < new Date()) {
      await redis.del('url:' + shortCode);
      return { status: 'expired' };
    }

    this.incrementClickCount(shortCode).catch(console.error);

    return { status: 'found', originalUrl: url.originalUrl };
  }

  async getRedirectUrl(shortCode: string): Promise<string | null> {
    const result = await this.resolveRedirect(shortCode);
    return result.status === 'found' ? result.originalUrl : null;
  }

  private async cacheUrl(shortCode: string, value: CachedUrl): Promise<void> {
    const cacheKey = 'url:' + shortCode;
    const payload = JSON.stringify(value);

    if (!value.expiresAt) {
      await redis.setex(cacheKey, 3600, payload);
      return;
    }

    const secondsUntilExpiry = Math.floor((new Date(value.expiresAt).getTime() - Date.now()) / 1000);
    if (secondsUntilExpiry <= 0) {
      await redis.del(cacheKey);
      return;
    }

    await redis.setex(cacheKey, Math.min(3600, secondsUntilExpiry), payload);
  }

  private parseCachedUrl(cached: string): CachedUrl | null {
    try {
      const parsed = JSON.parse(cached) as Partial<CachedUrl>;
      if (typeof parsed.originalUrl !== 'string') {
        return null;
      }
      return {
        originalUrl: parsed.originalUrl,
        expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
      };
    } catch {
      return {
        originalUrl: cached,
        expiresAt: null,
      };
    }
  }

  private async incrementClickCount(shortCode: string): Promise<void> {
    await pgPool.query(
      'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
      [shortCode]
    );
  }
}

export const urlService = new URLService();
