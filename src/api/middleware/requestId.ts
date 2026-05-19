/**
 * Request ID Middleware
 *
 * Ne yapar?
 * Her HTTP isteğine benzersiz bir ID atar.
 * Bu ID:
 *   1. X-Request-ID response header'ına eklenir
 *   2. Tüm log satırlarına otomatik eklenir (Fastify logger bunu yapar)
 *   3. Hata response'larına eklenir
 *
 * Neden önemli?
 * Production'da bir kullanıcı "şu an hata aldım" dediğinde,
 * X-Request-ID değerini alıp logda aratırsın.
 * O isteğe ait tüm log satırları (DB sorgusu, cache miss, hata) gelir.
 * Buna "distributed tracing"in en basit hali denir.
 *
 * Örnek:
 *   İstek gelir  → reqId: "req_a3f9k2m"
 *   DB sorgusu   → [req_a3f9k2m] SELECT * FROM urls WHERE short_code = $1
 *   Cache miss   → [req_a3f9k2m] Cache miss for url:abc123
 *   Hata         → [req_a3f9k2m] Short URL not found
 *   Response     → X-Request-ID: req_a3f9k2m
 */

import { FastifyInstance } from 'fastify';

// Kısa, okunabilir ID üretici
// crypto.randomUUID() yerine daha kısa bir format kullanıyoruz
function generateRequestId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'req_';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function registerRequestId(app: FastifyInstance): void {
  // Her isteğe ID ata
  app.addHook('onRequest', async (request, reply) => {
    // İstemci kendi ID'sini gönderebilir (proxy, gateway senaryoları)
    // Yoksa biz üretiriz
    const requestId =
      (request.headers['x-request-id'] as string) || generateRequestId();

    // Fastify'ın request nesnesine ekle — handler'lardan erişilebilir
    request.id = requestId;

    // Response header'ına ekle — istemci görebilsin
    reply.header('X-Request-ID', requestId);
  });
}
