/**
 * Bloom Filter
 *
 * Ne yapar?
 * "Bu short code hiç var oldu mu?" sorusunu DB'ye sormadan cevaplar.
 *
 * Nasıl çalışır?
 * 1. Bit array (büyük bir 0/1 dizisi) ve k adet hash fonksiyonu var
 * 2. Eleman eklenince: k hash hesapla → o pozisyonları 1 yap
 * 3. Sorgu gelince: k hash hesapla → hepsi 1 mi?
 *    - Herhangi biri 0 → "KESİNLİKLE YOK" (false negative imkansız)
 *    - Hepsi 1 → "BELKI VAR" (false positive mümkün)
 *
 * Neden önemli?
 * Birisi rastgele short code'lar denerse (enumeration saldırısı),
 * her biri DB'ye gider. Bloom filter "yok" diyerek DB'yi korur.
 *
 * Trade-off:
 * - False positive rate: %0.01 (1000'de 1 yanlış "var" diyebilir)
 * - False negative: İMKANSIZ (var olan bir şeyi "yok" demez)
 * - Silme desteklenmez (bit'i 0 yapamazsın — başka elemanı etkiler)
 *
 * Bu implementasyon:
 * - Production'da Redis bit array kullanılır (ADR-003)
 * - Burada in-memory — test ve geliştirme için yeterli
 * - Günlük DB snapshot'tan rebuild edilir
 */

export class BloomFilter {
  private bits: Uint8Array;
  private readonly size: number;
  private readonly hashCount: number;
  private itemCount = 0;

  /**
   * @param capacity    Beklenen eleman sayısı
   * @param errorRate   Kabul edilebilir false positive oranı (0.0001 = %0.01)
   */
  constructor(capacity: number = 1_000_000, errorRate: number = 0.0001) {
    // Optimal bit array boyutu formülü:
    // m = -(n * ln(p)) / (ln(2)^2)
    // n = capacity, p = errorRate
    this.size = Math.ceil(
      -(capacity * Math.log(errorRate)) / (Math.log(2) ** 2)
    );

    // Optimal hash fonksiyon sayısı:
    // k = (m/n) * ln(2)
    this.hashCount = Math.max(
      1,
      Math.round((this.size / capacity) * Math.log(2))
    );

    // Uint8Array: her eleman 8 bit → size/8 byte bellek
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  add(item: string): void {
    for (const position of this.getPositions(item)) {
      // Bit'i 1 yap: hangi byte'ta (>>3) ve o byte'ın hangi biti (1 << (pos & 7))
      this.bits[position >> 3] |= 1 << (position & 7);
    }
    this.itemCount++;
  }

  mightContain(item: string): boolean {
    for (const position of this.getPositions(item)) {
      // Herhangi bir bit 0 ise → KESİNLİKLE YOK
      if ((this.bits[position >> 3] & (1 << (position & 7))) === 0) {
        return false;
      }
    }
    // Hepsi 1 → BELKI VAR
    return true;
  }

  // Kaç eleman eklendi?
  get count(): number {
    return this.itemCount;
  }

  // Tahmini false positive oranı (mevcut dolulukta)
  get falsePositiveRate(): number {
    return Math.pow(
      1 - Math.exp(-this.hashCount * this.itemCount / this.size),
      this.hashCount
    );
  }

  clear(): void {
    this.bits.fill(0);
    this.itemCount = 0;
  }

  // Double hashing — k farklı pozisyon üret
  // Neden double hashing? k adet bağımsız hash fonksiyonu yerine
  // 2 hash'ten k hash türetmek daha verimli
  private *getPositions(item: string): Generator<number> {
    const h1 = this.hash1(item);
    const h2 = this.hash2(item);

    for (let i = 0; i < this.hashCount; i++) {
      // (h1 + i * h2) mod size — her i için farklı pozisyon
      yield Math.abs((h1 + i * h2) % this.size);
    }
  }

  // FNV-1a hash — hızlı, iyi dağılım
  private hash1(str: string): number {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619); // FNV prime
      hash >>>= 0; // 32-bit unsigned
    }
    return hash;
  }

  // djb2 hash — farklı dağılım için ikinci hash
  private hash2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(hash, 33) ^ str.charCodeAt(i);
      hash >>>= 0;
    }
    return hash || 1; // 0 olmamalı (double hashing'de sorun çıkarır)
  }
}

// Singleton — uygulama boyunca tek Bloom filter
// 1M kapasiteli başlıyoruz (production'da 1B olacak)
export const urlBloomFilter = new BloomFilter(1_000_000, 0.0001);
