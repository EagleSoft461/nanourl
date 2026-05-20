/**
 * Kafka Producer Abstraction
 *
 * Neden interface?
 * Test'te gerçek Kafka'ya bağlanmak istemiyoruz — yavaş, kurulum gerektiriyor.
 * Interface sayesinde test'te InMemoryProducer, production'da KafkaJsProducer kullanırız.
 * Handler'lar sadece interface'i bilir, implementasyonu bilmez.
 *
 * Bu pattern'e "Dependency Inversion" denir:
 *   Yüksek seviye kod (handler) → interface'e bağımlı
 *   Düşük seviye kod (Kafka) → interface'i implement eder
 */

import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import { AnalyticsEvent, TOPICS } from '../events/eventSchema';

// Abstraction — tüm producer'ların uyması gereken sözleşme
export interface EventProducer {
  publish(event: AnalyticsEvent): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

// Gerçek implementasyon — KafkaJS kullanır
export class KafkaJsProducer implements EventProducer {
  private producer: Producer;
  private connected = false;

  constructor() {
    const kafka = new Kafka({
      clientId: 'nanourl-producer',
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      // Bağlantı hatalarında log spam'i önle
      logLevel: 1, // ERROR only
    });

    this.producer = kafka.producer({
      // Mesaj kaybını önlemek için tüm replica'ların onayını bekle
      // Neden? acks: 1 sadece leader'ın onayını bekler — leader çökerse mesaj kaybolur
      // acks: -1 (all) tüm in-sync replica'ların onayını bekler — daha güvenli
      allowAutoTopicCreation: true,
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }

  async publish(event: AnalyticsEvent): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    // Topic'i event type'tan belirle
    const topic = event.type; // 'url.created', 'url.accessed', 'url.expired'

    await this.producer.send({
      topic,
      compression: CompressionTypes.GZIP, // Ağ trafiğini azalt
      messages: [
        {
          // shortCode'u key olarak kullan
          // Neden? Aynı shortCode'a ait event'ler aynı partition'a gider
          // → sıralı işleme garantisi
          key: event.shortCode,
          value: JSON.stringify(event),
          headers: {
            eventId: event.eventId,
            version: event.version,
          },
        },
      ],
    });
  }
}

// Test implementasyonu — gerçek Kafka yok, event'leri bellekte tutar
// Neden? Test'te "şu event yayınlandı mı?" diye kontrol edebiliriz
export class InMemoryProducer implements EventProducer {
  public publishedEvents: AnalyticsEvent[] = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async publish(event: AnalyticsEvent): Promise<void> {
    this.publishedEvents.push(event);
  }

  // Test yardımcısı — belirli tipte event var mı?
  getEvents<T extends AnalyticsEvent>(type: T['type']): T[] {
    return this.publishedEvents.filter((e) => e.type === type) as T[];
  }

  clear(): void {
    this.publishedEvents = [];
  }
}

// Singleton — uygulama boyunca tek producer instance
// Test'te bu değiştirilir (dependency injection)
export let eventProducer: EventProducer = new KafkaJsProducer();

export function setEventProducer(producer: EventProducer): void {
  eventProducer = producer;
}
