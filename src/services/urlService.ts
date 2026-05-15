import { pgPool, redis } from '../config/database';
import { snowflake } from '../generators/snowflake';
import { URLEntity, CreateURLRequest, CreateURLResponse } from '../domain/url';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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

    await redis.setex('url:' + shortCode, 3600, request.url);

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
      return {
        shortCode,
        originalUrl: cached,
        clickCount: 0,
        customAlias: false,
      } as URLEntity;
    }

    const result = await pgPool.query(
      'SELECT * FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    
    await redis.setex('url:' + shortCode, 3600, row.original_url);

    return {
      id: row.id,
      shortCode: row.short_code,
      originalUrl: row.original_url,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      clickCount: row.click_count,
      userId: row.user_id,
      customAlias: row.custom_alias,
    };
  }

  async getRedirectUrl(shortCode: string): Promise<string | null> {
    const url = await this.findByShortCode(shortCode);
    
    if (!url) return null;
    
    if (url.expiresAt && new Date(url.expiresAt) < new Date()) {
      return null;
    }

    this.incrementClickCount(shortCode).catch(console.error);

    return url.originalUrl;
  }

  private async incrementClickCount(shortCode: string): Promise<void> {
    await pgPool.query(
      'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
      [shortCode]
    );
  }
}

export const urlService = new URLService();