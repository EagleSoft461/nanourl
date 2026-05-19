/**
 * Rate Limiting Middleware
 *
 * Ne yapar?
 * Bir IP veya kullanıcının belirli sürede kaç istek atabileceğini sınırlar.
 * Limit aşılınca 429 Too Many Requests döner.
 *
 * Nasıl çalışır?
 * Her istek için bir "anahtar" üretilir (IP veya user ID).
 * Bu anahtara karşılık gelen sayaç Redis'te tutulur.
 * Sayaç limiti aşarsa istek reddedilir.
 *
 * Neden Redis? Birden fazla sunucu node'u varsa sayaçların paylaşılması gerekir.
 * Her node kendi sayacını tutsa toplam limit aşılabilir.
 */

import rateLimit from '@fastify/rate-limit';
import { FastifyInstance } from 'fastify';
import { redis } from '../../config/database';

// Tier tanımları — Phase 4'te JWT eklenince authenticated tier devreye girer
const ANON_LIMIT = 10;       // istek/dakika (anonim)
const AUTH_LIMIT = 100;      // istek/dakika (giriş yapmış)
const WINDOW_MS = 60 * 1000; // 1 dakika

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,           // Tüm route'lara uygula
    max: ANON_LIMIT,        // Varsayılan limit (anonim)
    timeWindow: WINDOW_MS,
    redis,                  // Sayaçları Redis'te tut (multi-node uyumlu)

    // keyGenerator: "Bu isteği kim yapıyor?" sorusunu cevaplar
    // JWT varsa user ID, yoksa IP adresi kullan
    keyGenerator: (request) => {
      // @ts-ignore — JWT decode Phase 4'te eklenecek, şimdilik IP kullan
      const userId = request.user?.id;
      return userId ? `user:${userId}` : `ip:${request.ip}`;
    },

    // Limit aşılınca ne dönsün?
    errorResponseBuilder: (_request, context) => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      },
    }),

    // Response header'larına limit bilgisi ekle
    // Neden? İstemci "kaç hakkım kaldı?" diye bakabilir
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
}

// Belirli route'lara farklı limit uygulamak için yardımcı
// Kullanım: app.get('/path', { config: { rateLimit: authRateLimit } }, handler)
export const authRateLimit = {
  max: AUTH_LIMIT,
  timeWindow: WINDOW_MS,
};
