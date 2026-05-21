/**
 * L1 In-Process LRU Cache
 *
 * Neden L1 cache?
 * Redis ~1-2ms, bellek ~0.01ms. En sık erişilen URL'ler için
 * Redis'e bile gitmeden cevap verebiliriz.
 *
 * LRU (Least Recently Used) nedir?
 * Kapasite dolunca en az kullanılan kaydı sil.
 * Örnek: [A, B, C] kapasitesi 3, D gelince en eski A çıkar → [B, C, D]
 * Ama B'ye erişilirse B "yeni" olur → [C, D, B]
 *
 * Neden Map kullanıyoruz?
 * JavaScript Map, insertion order'ı korur.
 * En başta olan = en eski erişilen = silinecek aday.
 * Erişilince: sil + tekrar ekle → sona taşı (en yeni olur).
 * Bu O(1) LRU implementasyonu sağlar.
 *
 * TTL (Time To Live) nedir?
 * Her kaydın bir ömrü var. Süre dolunca otomatik geçersiz sayılır.
 * Neden? URL güncellenirse eski veri 5 dakikadan fazla cache'de kalmasın.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix ms
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number; // 0-1 arası
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private metrics = { hits: 0, misses: 0, evictions: 0 };

  constructor(
    private readonly capacity: number,  // Maksimum kayıt sayısı
    private readonly ttlMs: number      // Varsayılan TTL (ms)
  ) {}

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    // TTL kontrolü — süresi dolmuşsa sil
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.metrics.misses++;
      return null;
    }

    // LRU güncelleme: sil + tekrar ekle = sona taşı (en yeni)
    // Neden? Map'in sonundaki = en son erişilen = silinmeyecek
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.metrics.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    // Zaten varsa önce sil (LRU sırasını güncelle)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Kapasite doluysa en eski kaydı sil (Map'in ilk elemanı)
    if (this.cache.size >= this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.metrics.evictions++;
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
  }

  getMetrics(): CacheMetrics {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      evictions: this.metrics.evictions,
      size: this.cache.size,
      hitRate: total === 0 ? 0 : this.metrics.hits / total,
    };
  }

  resetMetrics(): void {
    this.metrics = { hits: 0, misses: 0, evictions: 0 };
  }
}

// Singleton — redirect path'inde kullanılacak L1 cache
// 10K entry, 5 dakika TTL (ADR-003'e göre)
export const urlL1Cache = new LRUCache<{
  originalUrl: string;
  expiresAt: string | null;
}>(10_000, 5 * 60 * 1000);
