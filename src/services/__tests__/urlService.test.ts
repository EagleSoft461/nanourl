import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pgQuery: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  redisDel: vi.fn(),
  generateShortCode: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  pgPool: {
    query: mocks.pgQuery,
  },
  redis: {
    get: mocks.redisGet,
    setex: mocks.redisSetex,
    del: mocks.redisDel,
  },
}));

vi.mock('../../generators/snowflake', () => ({
  snowflake: {
    generateShortCode: mocks.generateShortCode,
  },
}));

import { URLService } from '../urlService';

describe('URLService', () => {
  let service: URLService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new URLService();
    mocks.redisSetex.mockResolvedValue('OK');
    mocks.redisDel.mockResolvedValue(1);
  });

  it('returns not_found when a short code does not exist', async () => {
    mocks.redisGet.mockResolvedValue(null);
    mocks.pgQuery.mockResolvedValue({ rows: [] });

    const result = await service.resolveRedirect('missing1');

    expect(result).toEqual({ status: 'not_found' });
    expect(mocks.pgQuery).toHaveBeenCalledWith(
      'SELECT * FROM urls WHERE short_code = $1',
      ['missing1']
    );
  });

  it('returns expired and clears cache for expired database records', async () => {
    const expiredAt = new Date(Date.now() - 1000);
    mocks.redisGet.mockResolvedValue(null);
    mocks.pgQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          short_code: 'expired1',
          original_url: 'https://example.com',
          created_at: new Date(),
          expires_at: expiredAt,
          click_count: 0,
          user_id: null,
          custom_alias: false,
        },
      ],
    });

    const result = await service.resolveRedirect('expired1');

    expect(result).toEqual({ status: 'expired' });
    expect(mocks.redisDel).toHaveBeenCalledWith('url:expired1');
    expect(mocks.redisSetex).not.toHaveBeenCalled();
    expect(mocks.pgQuery).toHaveBeenCalledTimes(1);
  });

  it('returns found, increments clicks, and caches valid database records', async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    mocks.redisGet.mockResolvedValue(null);
    mocks.pgQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            short_code: 'valid1',
            original_url: 'https://example.com',
            created_at: new Date(),
            expires_at: expiresAt,
            click_count: 2,
            user_id: null,
            custom_alias: false,
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await service.resolveRedirect('valid1');
    await vi.waitFor(() => {
      expect(mocks.pgQuery).toHaveBeenCalledWith(
        'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
        ['valid1']
      );
    });

    expect(result).toEqual({ status: 'found', originalUrl: 'https://example.com' });
    expect(mocks.redisSetex).toHaveBeenCalledWith(
      'url:valid1',
      expect.any(Number),
      expect.stringContaining('"originalUrl":"https://example.com"')
    );
  });

  it('detects duplicate custom aliases before insert', async () => {
    mocks.redisGet.mockResolvedValue(
      JSON.stringify({
        originalUrl: 'https://existing.example.com',
        expiresAt: null,
      })
    );

    await expect(
      service.createUrl({
        url: 'https://example.com',
        customAlias: 'taken1',
      })
    ).rejects.toThrow('Custom alias already taken');

    expect(mocks.pgQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO urls'),
      expect.any(Array)
    );
  });

  it('uses cached expiry metadata when resolving redirects', async () => {
    mocks.redisGet.mockResolvedValue(
      JSON.stringify({
        originalUrl: 'https://example.com',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
    );

    const result = await service.resolveRedirect('cachedExpired1');

    expect(result).toEqual({ status: 'expired' });
    expect(mocks.pgQuery).not.toHaveBeenCalled();
    expect(mocks.redisDel).toHaveBeenCalledWith('url:cachedExpired1');
  });
});
