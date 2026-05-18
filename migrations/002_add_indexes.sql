-- Migration: 002_add_indexes.sql
-- Amaç: User-scoped sorgular ve analytics için gerekli indexleri ekle
--
-- Neden bu indexler?
--   idx_user_id      → GET /api/v1/urls (kullanıcının URL listesi) için
--   idx_click_count  → En çok tıklanan URL'leri sıralamak için (cache warming, analytics)
--   idx_created_at   → Zaman bazlı sıralama ve sayfalama için

CREATE INDEX IF NOT EXISTS idx_user_id
  ON urls (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_click_count
  ON urls (click_count DESC);

CREATE INDEX IF NOT EXISTS idx_created_at
  ON urls (created_at DESC);
