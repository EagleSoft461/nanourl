import { describe, it, expect } from 'vitest';
import { BloomFilter } from '../bloomFilter';

describe('BloomFilter', () => {
  it('returns true for added items (no false negatives)', () => {
    const filter = new BloomFilter(1000, 0.01);

    filter.add('abc123');
    filter.add('xyz789');

    // Eklenen her şey "var" dönmeli — false negative imkansız
    expect(filter.mightContain('abc123')).toBe(true);
    expect(filter.mightContain('xyz789')).toBe(true);
  });

  it('returns false for items that were never added', () => {
    const filter = new BloomFilter(1000, 0.01);

    filter.add('abc123');

    // Eklenmemiş şey "yok" dönmeli (false positive olabilir ama düşük ihtimal)
    expect(filter.mightContain('definitely-not-added-xyzxyz')).toBe(false);
  });

  it('tracks item count', () => {
    const filter = new BloomFilter(1000, 0.01);

    filter.add('a');
    filter.add('b');
    filter.add('c');

    expect(filter.count).toBe(3);
  });

  it('clears all entries', () => {
    const filter = new BloomFilter(1000, 0.01);

    filter.add('abc123');
    filter.clear();

    // Clear sonrası eklenen şey bile "yok" dönmeli
    expect(filter.mightContain('abc123')).toBe(false);
    expect(filter.count).toBe(0);
  });

  it('false positive rate stays within bounds for expected capacity', () => {
    const capacity = 10_000;
    const targetRate = 0.01; // %1
    const filter = new BloomFilter(capacity, targetRate);

    // Kapasiteyi doldur
    for (let i = 0; i < capacity; i++) {
      filter.add(`url-${i}`);
    }

    // Tahmini false positive rate hedefin 2 katını geçmemeli
    expect(filter.falsePositiveRate).toBeLessThan(targetRate * 2);
  });
});
