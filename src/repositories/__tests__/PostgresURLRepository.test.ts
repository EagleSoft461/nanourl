/**
 * PostgresURLRepository Unit Testleri
 *
 * Strateji: pg.Pool mock'lanır — gerçek DB bağlantısı yok.
 * Sadece şunları test ediyoruz:
 *   1. Doğru SQL sorgusu gönderiliyor mu?
 *   2. DB'den gelen snake_case kolonlar camelCase'e doğru map ediliyor mu?
 *   3. Hata durumları doğru handle ediliyor mu?
 *
 * Neden bu testler önemli?
 *   Repository katmanı iş mantığı ile DB arasındaki köprü.
 *   Buradaki bir bug (yanlış kolon adı, yanlış parametre sırası) production'da
 *   veri bozulmasına yol açabilir. Bu testler bunu erken yakalar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { PostgresURLRepository } from '../postgres/PostgresURLRepository';

// pg.Pool'u mock'la — gerçek DB bağlantısı açılmaz
vi.mock('pg', () => {
  const mockQuery = vi.fn();
  return {
    Pool: vi.fn().mockImplementation(() => ({ query: mockQuery })),
  };
});

function getMockQuery() {
  // Pool constructor'ından mock query fonksiyonunu al
  return (new Pool() as any).query as ReturnType<typeof vi.fn>;
}

describe('PostgresURLRepository', () => {
  let repo: PostgresURLRepository;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const pool = new Pool();
    mockQuery = (pool as any).query;
    repo = new PostgresURLRepository(pool);
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('inserts a new URL and returns a mapped URLRecord', async () => {
      const now = new Date();
      const expires = new Date(now.getTime() + 3600_000);

      // DB'nin döndüreceği satırı simüle et (snake_case — PostgreSQL convention)
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: '42',
          short_code: 'abc123',
          original_url: 'https://example.com',
          click_count: '0',
          created_at: now,
          expires_at: expires,
        }],
      });

      const result = await repo.create({
        shortCode: 'abc123',
        originalURL: 'https://example.com',
        expiresAt: expires,
      });

      // SQL doğru mu?
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO urls'),
        ['abc123', 'https://example.com', expires, null]
      );

      // snake_case → camelCase dönüşümü doğru mu?
      expect(result).toEqual({
        id: '42',
        shortCode: 'abc123',
        originalUrl: 'https://example.com',
        clickCount: 0,        // string '0' → number 0
        createdAt: now,
        expiresAt: expires,
        userId: null,
      });
    });

    it('passes null expiresAt when no expiry is set', async () => {
      const now = new Date();
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: '1',
          short_code: 'noexp1',
          original_url: 'https://example.com',
          click_count: '0',
          created_at: now,
          expires_at: null,
        }],
      });

      const result = await repo.create({
        shortCode: 'noexp1',
        originalURL: 'https://example.com',
        expiresAt: null,
      });

      // null expiry DB'ye null olarak gitmeli
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO urls'),
        ['noexp1', 'https://example.com', null, null]
      );
      expect(result.expiresAt).toBeNull();
    });
  });

  // ─── findByShortCode ───────────────────────────────────────────────────────

  describe('findByShortCode', () => {
    it('returns a URLRecord when the short code exists', async () => {
      const now = new Date();
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: '7',
          short_code: 'found1',
          original_url: 'https://example.com',
          click_count: '15',
          created_at: now,
          expires_at: null,
        }],
      });

      const result = await repo.findByShortCode('found1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE short_code = $1'),
        ['found1']
      );
      expect(result).not.toBeNull();
      expect(result!.shortCode).toBe('found1');
      expect(result!.clickCount).toBe(15); // string → number
    });

    it('returns null when the short code does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await repo.findByShortCode('missing1');

      expect(result).toBeNull();
    });
  });

  // ─── incrementClickCount ───────────────────────────────────────────────────

  describe('incrementClickCount', () => {
    it('runs the correct UPDATE query', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await repo.incrementClickCount('abc123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('click_count = click_count + 1'),
        ['abc123']
      );
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('runs the correct DELETE query', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      await repo.delete('abc123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM urls'),
        ['abc123']
      );
    });
  });
});
