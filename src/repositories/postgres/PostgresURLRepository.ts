import { Pool } from 'pg';
import { CreateURLDTO, URLRecord, URLRepository } from '../urlRepository';

export class PostgresURLRepository implements URLRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateURLDTO): Promise<URLRecord> {
    const result = await this.pool.query<{
      id: string;
      short_code: string;
      original_url: string;
      click_count: string;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `INSERT INTO urls (short_code, original_url, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, short_code, original_url, click_count, created_at, expires_at`,
      [data.shortCode, data.originalURL, data.expiresAt ?? null]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      shortCode: row.short_code,
      originalUrl: row.original_url,
      clickCount: Number(row.click_count),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async findByShortCode(shortCode: string): Promise<URLRecord | null> {
    const result = await this.pool.query<{
      id: string;
      short_code: string;
      original_url: string;
      click_count: string;
      created_at: Date;
      expires_at: Date | null;
    }>(
      `SELECT id, short_code, original_url, click_count, created_at, expires_at
       FROM urls
       WHERE short_code = $1`,
      [shortCode]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      shortCode: row.short_code,
      originalUrl: row.original_url,
      clickCount: Number(row.click_count),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  async incrementClickCount(shortCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1`,
      [shortCode]
    );
  }

  async delete(shortCode: string): Promise<void> {
    await this.pool.query(`DELETE FROM urls WHERE short_code = $1`, [shortCode]);
  }
}
