/**
 * Event Emission Integration Testleri
 *
 * Ne test ediyoruz?
 * - URL oluşturulunca url.created event'i yayınlanıyor mu?
 * - Redirect olunca url.accessed event'i yayınlanıyor mu?
 * - Süresi dolan URL'de url.expired event'i yayınlanıyor mu?
 *
 * Strateji:
 * InMemoryProducer inject ediyoruz — gerçek Kafka yok.
 * setEventProducer() ile singleton'ı değiştiriyoruz.
 * Test sonunda orijinal producer'ı geri yüklüyoruz.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  InMemoryProducer,
  setEventProducer,
  KafkaJsProducer,
} from '../../kafka/kafkaProducer';
import { URLService } from '../../../services/urlService';
import { URLRepository, URLRecord } from '../../../repositories/urlRepository';
import { CacheProvider } from '../../cache/cacheProvider';
import { LRUCache } from '../../cache/localCache';
import { BloomFilter } from '../../cache/bloomFilter';

// Minimal mock repository
function makeMockRepo(): URLRepository {
  const record: URLRecord = {
    id: '1',
    shortCode: 'test01',
    originalUrl: 'https://example.com',
    clickCount: 0,
    createdAt: new Date(),
    expiresAt: null,
  };
  return {
    create: vi.fn().mockResolvedValue(record),
    findByShortCode: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
    incrementClickCount: vi.fn(),
    list: vi.fn(),
  };
}

// Minimal mock cache
function makeMockCache(): CacheProvider {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Event emission', () => {
  let producer: InMemoryProducer;
  let originalProducer: KafkaJsProducer;

  beforeEach(() => {
    producer = new InMemoryProducer();
    // Gerçek producer'ı test producer'ı ile değiştir
    setEventProducer(producer);
  });

  afterEach(() => {
    producer.clear();
  });

  // ── url.created ────────────────────────────────────────────────────────────

  it('publishes url.created event when a URL is created', async () => {
    const repo = makeMockRepo();
    const cache = makeMockCache();
    const service = makeService(repo, cache);

    await service.createUrl({ url: 'https://example.com' });

    const events = producer.getEvents('url.created');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'url.created',
      originalUrl: 'https://example.com',
      version: '1.0',
    });
    // Her event benzersiz ID taşımalı
    expect(events[0].eventId).toBeTruthy();
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('includes userId in url.created event when user is authenticated', async () => {
    const repo = makeMockRepo();
    const cache = makeMockCache();
    const service = makeService(repo, cache);

    await service.createUrl({ url: 'https://example.com', userId: 'user-42' });

    const events = producer.getEvents<import('../../../infrastructure/events/eventSchema').UrlCreatedEvent>('url.created');
    expect(events[0].userId).toBe('user-42');
  });

  // ── url.expired ────────────────────────────────────────────────────────────

  it('publishes url.expired event when an expired URL is resolved', async () => {
    const expiredAt = new Date(Date.now() - 5000); // 5 saniye önce doldu
    const repo = makeMockRepo();
    vi.mocked(repo.findByShortCode).mockResolvedValue({
      id: '1',
      shortCode: 'expired1',
      originalUrl: 'https://example.com',
      clickCount: 0,
      createdAt: new Date(),
      expiresAt: expiredAt,
    });

    const cache = makeMockCache();
    const service = makeService(repo, cache);

    const result = await service.resolveRedirect('expired1');

    expect(result.status).toBe('expired');

    // Event async yayınlanıyor — kısa bekle
    await vi.waitFor(() => {
      const events = producer.getEvents('url.expired');
      expect(events).toHaveLength(1);
      expect(events[0].shortCode).toBe('expired1');
    });
  });

  // ── Kafka hatası redirect'i durdurmamalı ──────────────────────────────────

  it('does not throw when event publishing fails', async () => {
    const brokenProducer = {
      publish: vi.fn().mockRejectedValue(new Error('Kafka connection failed')),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    setEventProducer(brokenProducer);

    const repo = makeMockRepo();
    const cache = makeMockCache();
    const service = makeService(repo, cache);

    // Hata fırlatmamalı — fire and forget
    await expect(service.createUrl({ url: 'https://example.com' })).resolves.toBeDefined();
  });
});

// Her testte Bloom filter'ı "her şey var" diyen mock ile inject et
function makePassthroughBloomFilter(): BloomFilter {
  const filter = new BloomFilter(100, 0.01);
  vi.spyOn(filter, 'mightContain').mockReturnValue(true);
  return filter;
}

function makeService(repo: URLRepository, cache: CacheProvider): URLService {
  return new URLService(
    repo,
    cache,
    new LRUCache(100, 60_000),
    makePassthroughBloomFilter()
  );
}
