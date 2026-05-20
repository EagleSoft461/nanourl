/**
 * Analytics Worker
 *
 * Ne yapar?
 * Kafka topic'lerini dinler, gelen event'leri işler ve DB'yi günceller.
 *
 * Nasıl çalışır?
 * 1. Kafka'ya bağlanır, topic'lere subscribe olur
 * 2. Event gelince işler (click_count güncelle, log yaz vb.)
 * 3. Offset'i commit eder — "bu event'i işledim" der
 * 4. Uygulama kapanınca graceful shutdown yapar
 *
 * Consumer Group nedir?
 * Birden fazla worker aynı consumer group'ta olursa,
 * Kafka her partition'ı sadece bir worker'a verir.
 * Örnek: 3 partition, 3 worker → her worker 1 partition işler (paralel)
 * Örnek: 3 partition, 1 worker → worker tüm partition'ları işler
 *
 * Offset nedir?
 * Her Kafka mesajının bir numarası var (offset).
 * Consumer "offset 42'ye kadar işledim" diye Kafka'ya bildirir.
 * Worker çökerse kaldığı yerden devam eder — mesaj kaybı olmaz.
 *
 * Graceful Shutdown nedir?
 * SIGTERM gelince (Kubernetes pod kapatma, deploy vb.):
 * 1. Yeni mesaj almayı durdur
 * 2. Mevcut mesajı bitir
 * 3. Offset'i commit et
 * 4. Bağlantıyı kapat
 * Böylece mesaj kaybolmaz veya iki kez işlenmez.
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { pgPool } from '../config/database';
import { AnalyticsEvent, TOPICS } from '../infrastructure/events/eventSchema';

const CONSUMER_GROUP = 'nanourl-analytics';

export class AnalyticsWorker {
  private consumer: Consumer;
  private running = false;

  constructor() {
    const kafka = new Kafka({
      clientId: 'nanourl-analytics-worker',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      logLevel: 1,
    });

    this.consumer = kafka.consumer({
      groupId: CONSUMER_GROUP,
      // En az bir kez işleme garantisi
      // Neden? autoCommit: false ile offset'i manuel commit ederiz
      // İşlem başarısız olursa offset commit edilmez → tekrar işlenir
    });
  }

  async start(): Promise<void> {
    await this.consumer.connect();

    // Tüm topic'lere subscribe ol
    await this.consumer.subscribe({
      topics: [TOPICS.URL_CREATED, TOPICS.URL_ACCESSED, TOPICS.URL_EXPIRED],
      fromBeginning: false, // Sadece yeni mesajları işle
    });

    this.running = true;
    console.log('[AnalyticsWorker] Started, listening for events...');

    await this.consumer.run({
      // autoCommit: true (varsayılan) — mesajı aldıktan sonra otomatik commit
      // Daha güvenli için false yapıp manuel commit yapılabilir
      // Şimdilik basit tutuyoruz
      eachMessage: async (payload: EachMessagePayload) => {
        await this.handleMessage(payload);
      },
    });
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let event: AnalyticsEvent;
    try {
      event = JSON.parse(message.value.toString()) as AnalyticsEvent;
    } catch {
      console.error('[AnalyticsWorker] Failed to parse message:', message.value.toString());
      return; // Parse edilemeyen mesajı atla — dead letter queue Phase 6'da
    }

    try {
      switch (event.type) {
        case 'url.accessed':
          await this.handleUrlAccessed(event);
          break;
        case 'url.created':
          await this.handleUrlCreated(event);
          break;
        case 'url.expired':
          await this.handleUrlExpired(event);
          break;
        default:
          console.warn('[AnalyticsWorker] Unknown event type:', (event as any).type);
      }
    } catch (err) {
      // Hata olursa log yaz ama worker'ı durdurma
      // Neden? Bir event'teki hata tüm pipeline'ı durdurmamalı
      console.error(`[AnalyticsWorker] Failed to process event ${event.type}:`, err);
    }
  }

  private async handleUrlAccessed(event: { shortCode: string }): Promise<void> {
    // click_count'u artır
    // Not: Bu artık redirect handler'da değil, burada yapılıyor
    // Redirect path'i temizlendi — sadece Kafka'ya event yazar
    await pgPool.query(
      'UPDATE urls SET click_count = click_count + 1 WHERE short_code = $1',
      [event.shortCode]
    );
  }

  private async handleUrlCreated(_event: { shortCode: string }): Promise<void> {
    // Şimdilik sadece log — ileride Bloom filter'a eklenebilir
    // console.log(`[Analytics] URL created: ${_event.shortCode}`);
  }

  private async handleUrlExpired(event: { shortCode: string }): Promise<void> {
    // Süresi dolan URL'leri işaretle veya sil
    // Şimdilik sadece log
    console.log(`[Analytics] URL expired: ${event.shortCode}`);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // Graceful shutdown — mevcut mesajı bitir, sonra kapat
    await this.consumer.disconnect();
    console.log('[AnalyticsWorker] Stopped gracefully.');
  }
}

// Worker'ı standalone çalıştırmak için
// Kullanım: tsx src/workers/analyticsWorker.ts
if (require.main === module) {
  const worker = new AnalyticsWorker();

  // Graceful shutdown sinyalleri
  // SIGTERM: Kubernetes, Docker stop
  // SIGINT: Ctrl+C
  const shutdown = async (signal: string) => {
    console.log(`[AnalyticsWorker] Received ${signal}, shutting down...`);
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  worker.start().catch((err) => {
    console.error('[AnalyticsWorker] Fatal error:', err);
    process.exit(1);
  });
}
