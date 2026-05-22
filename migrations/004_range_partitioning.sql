-- Migration: 004_range_partitioning.sql
-- Amaç: urls tablosunu created_at'a göre range partition'a hazırla
--
-- Range Partitioning nedir?
-- Büyük tabloyu zaman dilimine göre böl.
-- 2025 verisi ayrı dosyada, 2026 verisi ayrı dosyada.
-- "2026 Mayıs'taki URL'ler" sorgusu sadece 2026 partition'ını tarar.
--
-- Neden önemli?
-- 100M URL varsa full table scan çok yavaş.
-- Partition pruning ile sadece ilgili bölüm taranır.
--
-- NOT: Bu migration mevcut tabloyu partition'lı hale DÖNÜŞTÜRMEZ.
-- Yeni bir partition'lı tablo oluşturur.
-- Production'da veri migrasyonu ayrıca yapılmalı.
-- Şimdilik yeni kurulumlar için partition'lı tablo tanımı.

-- Partition'lı ana tablo (yeni kurulumlar için)
CREATE TABLE IF NOT EXISTS urls_partitioned (
  id            BIGSERIAL,
  short_code    VARCHAR(20) NOT NULL,
  original_url  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at    TIMESTAMPTZ NULL,
  click_count   BIGINT DEFAULT 0,
  user_id       UUID NULL,
  custom_alias  BOOLEAN DEFAULT FALSE,

  CONSTRAINT valid_url CHECK (LENGTH(original_url) <= 2048),
  -- Partition key (created_at) PRIMARY KEY'in parçası olmalı
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- 2025 partition
CREATE TABLE IF NOT EXISTS urls_2025
  PARTITION OF urls_partitioned
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- 2026 partition
CREATE TABLE IF NOT EXISTS urls_2026
  PARTITION OF urls_partitioned
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- 2027 partition (önceden oluştur — yıl sonunda hazır olsun)
CREATE TABLE IF NOT EXISTS urls_2027
  PARTITION OF urls_partitioned
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- Her partition'da short_code index'i
CREATE INDEX IF NOT EXISTS idx_urls_2025_short_code ON urls_2025(short_code);
CREATE INDEX IF NOT EXISTS idx_urls_2026_short_code ON urls_2026(short_code);
CREATE INDEX IF NOT EXISTS idx_urls_2027_short_code ON urls_2027(short_code);

-- Expires_at index'leri (süresi dolan URL'leri temizlemek için)
CREATE INDEX IF NOT EXISTS idx_urls_2025_expires_at
  ON urls_2025(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_urls_2026_expires_at
  ON urls_2026(expires_at) WHERE expires_at IS NOT NULL;
