import { Pool } from 'pg';
import {
  CreateURLDTO,
  UpdateURLDTO,
  URLRecord,
  URLRepository,
  ListURLsOptions,
  PaginatedResult,
} from '../urlRepository';

// DB'den gelen satırı TypeScript tipine map eden yardımcı
// Neden? PostgreSQL kolon adları snake_case, TypeScript camelCase kullanır.
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

export class PostgresURLRepository implements URLRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: CreateURLDTO): Promise<URLRecord> {
    const result = await this.pool.query(
      `INSERT INTO urls (short_code, original_url, expires_at, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, short_code, original_url, click_count, created_at, expires_at, user_id`,
      [data.shortCode, data.originalURL, data.expiresAt ?? null, data.userId ?? null]
    );
    return rowToRecord(result.rows[0]);
  }

  async findByShortCode(shortCode: string): Promise<URLRecord | null> {
    const result = await this.pool.query(
      `SELECT id, short_code, original_url, click_count, created_at, expires_at, user_id
       FROM urls
       WHERE short_code = $1`,
      [shortCode]
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  async update(shortCode: string, data: UpdateURLDTO): Promise<URLRecord | null> {
    // Dinamik UPDATE: sadece gönderilen alanları güncelle
    // Neden? PATCH semantiği — gönderilmeyen alanlar değişmemeli.
    //
    // Örnek: { originalURL: "https://new.com" } gelirse
    //   SET original_url = $1 WHERE short_code = $2
    // Örnek: { originalURL: "...", expiresAt: null } gelirse
    //   SET original_url = $1, expires_at = $2 WHERE short_code = $3

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
    const result = await this.pool.query(
      `UPDATE urls
       SET ${setClauses.join(', ')}
       WHERE short_code = $${paramIndex}
       RETURNING id, short_code, original_url, click_count, created_at, expires_at, user_id`,
      values
    );

    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  async delete(shortCode: string): Promise<void> {
    await this.pool.query(`DELETE FROM urls WHERE short_code = $1`, [shortCode]);
  }

  async incrementClickCount(shortCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1`,
      [shortCode]
    );
  }

  async list(options: ListURLsOptions): Promise<PaginatedResult<URLRecord>> {
    // OFFSET hesaplama: sayfa 1 → offset 0, sayfa 2 → offset pageSize, ...
    const offset = (options.page - 1) * options.pageSize;

    // Güvenli kolon adı — SQL injection'a karşı whitelist kullan
    // Neden? Kullanıcıdan gelen sort değerini direkt SQL'e koymak tehlikeli.
    const sortColumn = options.sort === 'click_count' ? 'click_count' : 'created_at';
    const sortOrder = options.order === 'asc' ? 'ASC' : 'DESC';

    const values: unknown[] = [];
    let whereClause = '';

    if (options.search) {
      values.push(`%${options.search}%`);
      // original_url veya short_code içinde arama
      whereClause = `WHERE original_url ILIKE $${values.length} OR short_code ILIKE $${values.length}`;
    }

    // COUNT(*) OVER() — toplam satır sayısını ayrı sorgu atmadan öğren
    // Neden? İki sorgu yerine tek sorguda hem veri hem toplam sayı gelir.
    values.push(options.pageSize, offset);
    const result = await this.pool.query(
      `SELECT id, short_code, original_url, click_count, created_at, expires_at, user_id,
              COUNT(*) OVER() AS total_count
       FROM urls
       ${whereClause}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const totalItems = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

    return {
      data: result.rows.map(rowToRecord),
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / options.pageSize),
      },
    };
  }
}
