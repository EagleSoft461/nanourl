/**
 * Sharded PostgreSQL URL Repository
 *
 * PostgresURLRepository'den farkı:
 * Her operasyonda ShardRouter'dan doğru Pool'u alır.
 * Üst katman (URLService) hiçbir şey bilmez — sadece URLRepository interface'ini görür.
 *
 * Bu "Transparent Sharding" pattern'i:
 * Service → URLRepository interface → ShardedPostgresURLRepository → ShardRouter → Pool
 *
 * Cross-shard queries (list, search):
 * Tüm shard'lara paralel sorgu at, sonuçları birleştir.
 * Neden paralel? Sıralı olursa N shard * sorgu süresi = yavaş.
 * Promise.all ile hepsi aynı anda çalışır.
 */

import {
  CreateURLDTO,
  UpdateURLDTO,
  URLRecord,
  URLRepository,
  ListURLsOptions,
  PaginatedResult,
} from '../urlRepository';
import { ShardRouter } from '../../infrastructure/sharding/shardRouter';

// DB satırını TypeScript tipine map eden yardımcı
function rowToRecord(row: {
  id: string;
  short_code: string;
  original_url: string;
  click_count: string;
  created_at: Date;
  expires_at: Date | null;
  user_id?: string | null;
}): URLRecord {
  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    clickCount: Number(row.click_count),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    userId: row.user_id ?? null,
  };
}

export class ShardedPostgresURLRepository implements URLRepository {
  constructor(private readonly router: ShardRouter) {}

  async create(data: CreateURLDTO): Promise<URLRecord> {
    // Yeni URL hangi shard'a gidecek?
    const pool = this.router.getPool(data.shortCode);

    const result = await pool.query(
      `INSERT INTO urls (short_code, original_url, expires_at, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, short_code, original_url, click_count, created_at, expires_at, user_id`,
      [data.shortCode, data.originalURL, data.expiresAt ?? null, data.userId ?? null]
    );
    return rowToRecord(result.rows[0]);
  }

  async findByShortCode(shortCode: string): Promise<URLRecord | null> {
    // Short code'dan shard'ı belirle — deterministik
    const pool = this.router.getPool(shortCode);

    const result = await pool.query(
      `SELECT id, short_code, original_url, click_count, created_at, expires_at, user_id
       FROM urls WHERE short_code = $1`,
      [shortCode]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  async update(shortCode: string, data: UpdateURLDTO): Promise<URLRecord | null> {
    const pool = this.router.getPool(shortCode);

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.originalURL !== undefined) {
      setClauses.push(`original_url = $${paramIndex++}`);
      values.push(data.originalURL);
    }
    if (data.expiresAt !== undefined) {
      setClauses.push(`expires_at = $${paramIndex++}`);
      values.push(data.expiresAt);
    }
    if (setClauses.length === 0) return this.findByShortCode(shortCode);

    values.push(shortCode);
    const result = await pool.query(
      `UPDATE urls SET ${setClauses.join(', ')}
       WHERE short_code = $${paramIndex}
       RETURNING id, short_code, original_url, click_count, created_at, expires_at, user_id`,
      values
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  async delete(shortCode: string): Promise<void> {
    const pool = this.router.getPool(shortCode);
    await pool.query(`DELETE FROM urls WHERE short_code = $1`, [shortCode]);
  }

  async incrementClickCount(shortCode: string): Promise<void> {
    const pool = this.router.getPool(shortCode);
    await pool.query(
      `UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1`,
      [shortCode]
    );
  }

  async list(options: ListURLsOptions): Promise<PaginatedResult<URLRecord>> {
    // Cross-shard query — tüm shard'lara paralel sorgu at
    // Neden paralel? Promise.all ile hepsi aynı anda çalışır
    const pools = this.router.getAllPools();
    const offset = (options.page - 1) * options.pageSize;
    const sortColumn = options.sort === 'click_count' ? 'click_count' : 'created_at';
    const sortOrder = options.order === 'asc' ? 'ASC' : 'DESC';

    const values: unknown[] = [];
    let whereClause = '';
    if (options.search) {
      values.push(`%${options.search}%`);
      whereClause = `WHERE original_url ILIKE $1 OR short_code ILIKE $1`;
    }

    // Tüm shard'lardan veri çek (sayfalama için fazla çek, sonra kes)
    // Not: Gerçek production'da cursor-based pagination daha verimli
    const shardResults = await Promise.all(
      pools.map((pool) =>
        pool.query(
          `SELECT id, short_code, original_url, click_count, created_at, expires_at, user_id
           FROM urls ${whereClause}
           ORDER BY ${sortColumn} ${sortOrder}
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, options.pageSize * options.page, 0]
        )
      )
    );

    // Tüm shard sonuçlarını birleştir
    const allRows = shardResults.flatMap((r) => r.rows);

    // Birleştirilmiş sonucu sırala
    allRows.sort((a, b) => {
      const aVal = sortColumn === 'click_count' ? Number(a.click_count) : new Date(a.created_at).getTime();
      const bVal = sortColumn === 'click_count' ? Number(b.click_count) : new Date(b.created_at).getTime();
      return sortOrder === 'ASC' ? aVal - bVal : bVal - aVal;
    });

    const totalItems = allRows.length;
    const pageData = allRows.slice(offset, offset + options.pageSize);

    return {
      data: pageData.map(rowToRecord),
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / options.pageSize),
      },
    };
  }
}
