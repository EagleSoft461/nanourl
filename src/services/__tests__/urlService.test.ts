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
import { URLRepository, URLRecord, CreateURLDTO } from '../../repositories/urlRepository';
import { CacheProvider } from '../../infrastructure/cache/cacheProvider';
import { LRUCache } from '../../infrastructure/cache/localCache';
import { BloomFilter } from '../../infrastructure/cache/bloomFilter';

// Test için minimal mock repository
function makeMockRepository(): URLRepository {
  return {
    create: vi.fn(),
    findByShortCode: vi.fn(),
    incrementClickCount: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  };
}

// Test için minimal mock cache
function makeMockCache(): CacheProvider {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

// Bloom filter mock — her şeyi "var" sayar, DB'ye gitmeyi engellemesin
function makePassthroughBloomFilter(): BloomFilter {
  const filter = new BloomFilter(100, 0.01);
  vi.spyOn(filter, 'mightContain').mockReturnValue(true);
  return filter;
}

// L1 cache mock — boş başlar, test izolasyonu için
function makeEmptyL1Cache() {
  return new LRUCache<{ originalUrl: string; expiresAt: string | null }>(100, 60_000);
}

describe('URLService', () => {
  let service: URLService;
  let mockRepo: ReturnType<typeof makeMockRepository>;
  let mockCache: ReturnType<typeof makeMockCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = makeMockRepository();
    mockCache = makeMockCache();
    service = new URLService(mockRepo, mockCache, makeEmptyL1Cache(), makePassthroughBloomFilter());
    vi.mocked(mockCache.set).mockResolvedValue(undefined);
    vi.mocked(mockCache.del).mockResolvedValue(undefined);
  });

  it('returns not_found when a short code does not exist', async () => {
    vi.mocked(mockCache.get).mockResolvedValue(null);
    vi.mocked(mockRepo.findByShortCode).mockResolvedValue(null);

    const result = await service.resolveRedirect('missing1');

    expect(result).toEqual({ status: 'not_found' });
    expect(mockRepo.findByShortCode).toHaveBeenCalledWith('missing1');
  });

  it('returns expired and clears cache for expired database records', async () => {
    const expiredAt = new Date(Date.now() - 1000);
    vi.mocked(mockCache.get).mockResolvedValue(null);
    vi.mocked(mockRepo.findByShortCode).mockResolvedValue({
      id: '1',
      shortCode: 'expired1',
      originalUrl: 'https://example.com',
      createdAt: new Date(),
      expiresAt: expiredAt,
      clickCount: 0,
    });

    const result = await service.resolveRedirect('expired1');

    expect(result).toEqual({ status: 'expired' });
    expect(mockCache.del).toHaveBeenCalledWith('url:expired1');
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(mockRepo.findByShortCode).toHaveBeenCalledTimes(1);
  });

  it('returns found, increments clicks, and caches valid database records', async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    vi.mocked(mockCache.get).mockResolvedValue(null);
    vi.mocked(mockRepo.findByShortCode).mockResolvedValue({
      id: '1',
      shortCode: 'valid1',
      originalUrl: 'https://example.com',
      createdAt: new Date(),
      expiresAt,
      clickCount: 2,
    });
    vi.mocked(mockRepo.incrementClickCount).mockResolvedValue(undefined);
    vi.mocked(mockCache.set).mockResolvedValue(undefined);

    const result = await service.resolveRedirect('valid1');

    await vi.waitFor(() => {
      expect(mockRepo.incrementClickCount).toHaveBeenCalledWith('valid1');
    });

    expect(result).toEqual({ status: 'found', originalUrl: 'https://example.com' });
    expect(mockCache.set).toHaveBeenCalledWith(
      'url:valid1',
      expect.objectContaining({ originalUrl: 'https://example.com' }),
      expect.any(Number)
    );
  });

  it('detects duplicate custom aliases before insert', async () => {
    vi.mocked(mockCache.get).mockResolvedValue({
      originalUrl: 'https://existing.example.com',
      expiresAt: null,
    });

    await expect(
      service.createUrl({
        url: 'https://example.com',
        customAlias: 'taken1',
      })
    ).rejects.toThrow('Custom alias already taken');

    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('uses cached expiry metadata when resolving redirects', async () => {
    vi.mocked(mockCache.get).mockResolvedValue({
      originalUrl: 'https://example.com',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const result = await service.resolveRedirect('cachedExpired1');

    expect(result).toEqual({ status: 'expired' });
    expect(mockRepo.findByShortCode).not.toHaveBeenCalled();
    expect(mockCache.del).toHaveBeenCalledWith('url:cachedExpired1');
  });
});
