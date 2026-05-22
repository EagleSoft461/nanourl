/**
 * Structured Logging Konfigürasyonu
 *
 * Neden structured logging?
 * console.log("User 123 created URL") → arama yapılamaz, parse edilemez
 * JSON log → { "userId": "123", "action": "url.created", "shortCode": "abc" }
 *   → Datadog/CloudWatch'ta "userId:123" diye aratabilirsin
 *   → Alert kurabilirsin: "error rate > %1 ise bildir"
 *
 * Fastify pino kullanır — Node.js'in en hızlı JSON logger'ı.
 * Neden pino? Async yazma, minimal overhead, JSON native.
 *
 * Log seviyeleri (düşükten yükseğe):
 *   trace → debug → info → warn → error → fatal
 *
 * Production'da: info ve üzeri loglanır
 * Development'ta: debug ve üzeri, okunabilir format
 */

import { FastifyBaseLogger } from 'fastify';

export interface LoggerConfig {
  level: string;
  transport?: {
    target: string;
    options?: Record<string, unknown>;
  };
  serializers?: Record<string, (value: unknown) => unknown>;
}

export function getLoggerConfig(): LoggerConfig | boolean {
  // Test ortamında logging'i kapat — test çıktısını kirletmesin
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    // Development: okunabilir, renkli format (pino-pretty)
    // pino-pretty kurulu değilse JSON formatına düşer
    return {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    };
  }

  // Production: JSON format, info seviyesi
  return {
    level: process.env.LOG_LEVEL || 'info',
    // Her log satırına servis adı ekle
    // Neden? Birden fazla servis varsa hangi servisten geldiği belli olsun
    serializers: {
      req: (req: unknown) => {
        const r = req as { method: string; url: string; id: string };
        return { method: r.method, url: r.url, requestId: r.id };
      },
      res: (res: unknown) => {
        const r = res as { statusCode: number };
        return { statusCode: r.statusCode };
      },
    },
  };
}
