import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache } from '../localCache';

describe('LRUCache', () => {
  let cache: LRUCache<string>;

  beforeEach(() => {
    cache = new LRUCache<string>(3, 60_000); // 3 kapasiteli, 1 dakika TTL
  });

  it('stores and retrieves values', () => {
    cache.set('a', 'value-a');
    expect(cache.get('a')).toBe('value-a');
  });

  it('returns null for missing keys', () => {
    expect(cache.get('missing')).toBeNull();
  });

  it('evicts the least recently used entry when capacity is exceeded', () => {
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // Kapasite doldu. 'd' eklenince en eski 'a' çıkmalı
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBeNull();   // evicted
    expect(cache.get('b')).toBe('value-b');
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('updates LRU order on access — accessed entry survives eviction', () => {
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // 'a'ya eriş → 'a' artık en yeni, 'b' en eski
    cache.get('a');

    // 'd' eklenince en eski 'b' çıkmalı (a değil)
    cache.set('d', 'value-d');

    expect(cache.get('b')).toBeNull();   // evicted
    expect(cache.get('a')).toBe('value-a'); // survived
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    cache.set('a', 'value-a', 1000); // 1 saniye TTL

    expect(cache.get('a')).toBe('value-a');

    vi.advanceTimersByTime(1001); // 1 saniye geç

    expect(cache.get('a')).toBeNull(); // expired
    vi.useRealTimers();
  });

  it('tracks hit and miss metrics correctly', () => {
    cache.set('a', 'value-a');

    cache.get('a'); // hit
    cache.get('a'); // hit
    cache.get('missing'); // miss

    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(1);
    expect(metrics.hitRate).toBeCloseTo(2 / 3);
  });

  it('tracks eviction count', () => {
    cache.set('a', 'x');
    cache.set('b', 'x');
    cache.set('c', 'x');
    cache.set('d', 'x'); // evicts 'a'
    cache.set('e', 'x'); // evicts 'b'

    expect(cache.getMetrics().evictions).toBe(2);
  });
});
