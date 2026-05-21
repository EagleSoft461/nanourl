/**
 * Cache Warming & L1 Invalidation
 *
 * Cache Warming nedir?
 * Uygulama başlarken en çok tıklanan URL'leri Redis'e yükle.
 * Neden? Deploy sonrası "soğuk başlangıç" — ilk istekler DB'ye gider.
 * Warming ile ilk istek bile cache'den gelir.
 *
 * L1 Invalidation via Redis Pub/Sub nedir?
 * 3 sunucu node'u varsa:
 *   Node 1: URL silindi → L1'den temizledi
 *   Node 2: Hâlâ L1'de eski veri var ← SORUN
 *   Node 3: Hâlâ L1'de eski veri var ← SORUN
 *
 * Çözüm: Redis pub/sub kanalı
 *   Node 1: URL silindi → Redis'e "cache.invalidate: abc123" yayınla
 *   Node 2 & 3: Mesajı alır → kendi L1'inden siler
 *
 * Pub/Sub nedir?
 * Publisher → kanal → Subscriber(lar)
 * Redis'te bir kanal var, tüm node'lar subscribe.
 * Bir node yayınlayınca diğerleri anında alır.
 */

import { pgPool, redis } from '../../config/database';
import { urlL1Cache } from './localCache';
import { urlBloomFilter } from './bloomFilter';
import Redis from 'ioredis';

const INVALIDATION_CHANNEL = 'cache.invalidate';
const WARM_LIMIT = 10_000;

// Cache warming — en çok tıklanan URL'leri Redis'e yükle
export async function warmCache(): Promise<void> {
  console.log('[CacheWarming] Starting cache warm-up...');
  const start = Date.now();

  try {
    const result = await pgPool.query<{
      short_code: string;
      original_url: string;
      expires_at: Date | null;
    }>(
      `SELECT short_code, original_url, expires_at
       FROM urls
       WHERE expires_at IS NULL OR expires_at > NOW()
       ORDER BY click_count DESC
       LIMIT $1`,
      [WARM_LIMIT]
    );

    if (result.rows.length === 0) {
      console.log('[CacheWarming] No URLs to warm.');
      return;
    }

    // Redis pipeline — tek seferde tüm komutları gönder
    // Neden pipeline? 10K ayrı SET yerine tek network round-trip
    const pipeline = redis.pipeline();

    for (const row of result.rows) {
      const ttlSeconds = row.expires_at
        ? Math.floor((row.expires_at.getTime() - Date.now()) / 1000)
        : 3600; // 1 saat varsayılan

      if (ttlSeconds <= 0) continue; // Süresi dolmuş, atla

      const value = JSON.stringify({
        originalUrl: row.original_url,
        expiresAt: row.expires_at?.toISOString() ?? null,
      });

      pipeline.setex(`url:${row.short_code}`, ttlSeconds, value);

      // Bloom filter'a da ekle
      urlBloomFilter.add(row.short_code);
    }

    await pipeline.exec();

    const elapsed = Date.now() - start;
    console.log(
      `[CacheWarming] Warmed ${result.rows.length} URLs in ${elapsed}ms`
    );
  } catch (err) {
    // Warming hatası uygulamayı durdurmamalı — sadece logla
    console.error('[CacheWarming] Failed:', err);
  }
}

// Redis Pub/Sub — L1 cache invalidation
// Ayrı bir Redis bağlantısı gerekiyor
// Neden? subscribe() modunda olan bağlantı başka komut çalıştıramaz
let subscriber: Redis | null = null;

export function startCacheInvalidationListener(): void {
  subscriber = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    lazyConnect: true,
  });

  subscriber.subscribe(INVALIDATION_CHANNEL, (err) => {
    if (err) {
      console.error('[CacheInvalidation] Subscribe failed:', err);
      return;
    }
    console.log('[CacheInvalidation] Listening for invalidation events...');
  });

  subscriber.on('message', (_channel: string, shortCode: string) => {
    // Diğer node'dan invalidation mesajı geldi — L1'den sil
    urlL1Cache.delete(`url:${shortCode}`);
  });

  subscriber.on('error', (err: Error) => {
    console.error('[CacheInvalidation] Redis error:', err);
  });
}

// Bir URL silinince/güncellenince tüm node'lara haber ver
export async function publishCacheInvalidation(shortCode: string): Promise<void> {
  try {
    await redis.publish(INVALIDATION_CHANNEL, shortCode);
  } catch (err) {
    // Pub/sub hatası kritik değil — sadece logla
    console.error('[CacheInvalidation] Publish failed:', err);
  }
}

export async function stopCacheInvalidationListener(): Promise<void> {
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
}
