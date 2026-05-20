/**
 * Event Schema Tanımları
 *
 * Kafka'ya gönderilen her event bu tiplere uymalı.
 * Neden ayrı bir dosya? Event schema'sı hem producer hem consumer tarafından
 * kullanılır. Tek yerde tanımlanırsa değişiklik her iki tarafı da etkiler —
 * tip güvenliği sağlar.
 *
 * Event tipleri:
 *   url.created  → Yeni URL oluşturulduğunda
 *   url.accessed → Redirect gerçekleştiğinde (en sık olan)
 *   url.expired  → URL'nin süresi dolduğunda
 */

// Her event'in ortak alanları
interface BaseEvent {
  eventId: string;       // Benzersiz event ID (idempotency için)
  timestamp: number;     // Unix ms — ne zaman oldu?
  version: '1.0';        // Schema versiyonu — ileride breaking change olursa
}

// URL oluşturuldu
export interface UrlCreatedEvent extends BaseEvent {
  type: 'url.created';
  shortCode: string;
  originalUrl: string;
  userId: string | null;
  expiresAt: string | null; // ISO 8601
}

// Redirect gerçekleşti — en sık yayınlanan event
export interface UrlAccessedEvent extends BaseEvent {
  type: 'url.accessed';
  shortCode: string;
  ip: string;
  userAgent: string;
  referer: string | null;
}

// URL süresi doldu
export interface UrlExpiredEvent extends BaseEvent {
  type: 'url.expired';
  shortCode: string;
  expiredAt: string; // ISO 8601
}

// Union type — Kafka'ya gönderilen her şey bu tiplerden biri
export type AnalyticsEvent = UrlCreatedEvent | UrlAccessedEvent | UrlExpiredEvent;

// Topic isimleri — magic string yerine sabit kullan
export const TOPICS = {
  URL_CREATED: 'url.created',
  URL_ACCESSED: 'url.accessed',
  URL_EXPIRED: 'url.expired',
} as const;

// Event factory'leri — her event için doğru şekli üretir
// Neden? Handler'larda new Date().toISOString() gibi tekrar eden kodu önler
import { randomUUID } from 'crypto';

export function createUrlCreatedEvent(data: Omit<UrlCreatedEvent, keyof BaseEvent | 'type'>): UrlCreatedEvent {
  return {
    eventId: randomUUID(),
    timestamp: Date.now(),
    version: '1.0',
    type: 'url.created',
    ...data,
  };
}

export function createUrlAccessedEvent(data: Omit<UrlAccessedEvent, keyof BaseEvent | 'type'>): UrlAccessedEvent {
  return {
    eventId: randomUUID(),
    timestamp: Date.now(),
    version: '1.0',
    type: 'url.accessed',
    ...data,
  };
}

export function createUrlExpiredEvent(data: Omit<UrlExpiredEvent, keyof BaseEvent | 'type'>): UrlExpiredEvent {
  return {
    eventId: randomUUID(),
    timestamp: Date.now(),
    version: '1.0',
    type: 'url.expired',
    ...data,
  };
}
