/**
 * Prometheus Metrics
 *
 * Ne yapar?
 * Uygulama metriklerini Prometheus formatında toplar.
 * /metrics endpoint'i bu verileri döndürür.
 * Prometheus bu endpoint'i scrape eder (çeker), Grafana görselleştirir.
 *
 * Metrik tipleri:
 *   Counter   → Sadece artar (toplam istek sayısı, hata sayısı)
 *   Gauge     → Artar/azalır (aktif bağlantı sayısı, cache boyutu)
 *   Histogram → Dağılım (latency — P50, P95, P99 hesaplamak için)
 *
 * Neden Histogram latency için?
 * Ortalama yanıltıcıdır. 99 istek 1ms, 1 istek 10000ms → ortalama ~101ms
 * ama P99 = 10000ms. Histogram gerçek dağılımı gösterir.
 *
 * Prometheus format örneği:
 *   http_requests_total{method="GET",route="/health",status="200"} 42
 *   http_request_duration_seconds_bucket{le="0.01"} 38
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Ayrı registry — default registry ile çakışmayı önler
export const registry = new Registry();

// Node.js default metrikleri — CPU, bellek, event loop lag vb.
// Neden? Uygulama metriklerinin yanında sistem sağlığını da izle
collectDefaultMetrics({ register: registry });

// ── HTTP Metrikleri ───────────────────────────────────────────────────────────

// Toplam HTTP istek sayısı
// Labels: method (GET/POST), route (/api/v1/urls), status (200/404/500)
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

// HTTP istek süresi (saniye cinsinden)
// Histogram: P50, P95, P99 latency hesaplamak için
// buckets: hangi eşik değerlerinde sayım yapılsın?
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  // 0.001s = 1ms, 0.01s = 10ms (P99 hedefimiz), 1s = 1000ms
  registers: [registry],
});

// ── Cache Metrikleri ──────────────────────────────────────────────────────────

export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['layer'], // 'l1' veya 'l2'
  registers: [registry],
});

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['layer'],
  registers: [registry],
});

// ── URL Metrikleri ────────────────────────────────────────────────────────────

export const urlsCreatedTotal = new Counter({
  name: 'urls_created_total',
  help: 'Total number of short URLs created',
  registers: [registry],
});

export const redirectsTotal = new Counter({
  name: 'redirects_total',
  help: 'Total number of redirects served',
  labelNames: ['status'], // 'found', 'not_found', 'expired'
  registers: [registry],
});

// ── Fastify Hook — Her isteği otomatik ölç ───────────────────────────────────

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerMetrics(app: FastifyInstance): void {
  // Her istek başında timer başlat
  app.addHook('onRequest', async (request: FastifyRequest & { _metricsStart?: number }) => {
    request._metricsStart = Date.now();
  });

  // Her istek bitince ölç ve kaydet
  app.addHook('onResponse', async (
    request: FastifyRequest & { _metricsStart?: number },
    reply: FastifyReply
  ) => {
    const duration = request._metricsStart
      ? (Date.now() - request._metricsStart) / 1000
      : 0;

    // Route'u normalize et — /api/v1/urls/abc123 → /api/v1/urls/:shortCode
    // Neden? Her farklı shortCode ayrı metrik satırı oluşturmasın (cardinality patlaması)
    const route = request.routeOptions?.url ?? request.url.split('?')[0];
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, duration);
  });
}
