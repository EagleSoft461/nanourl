/**
 * Migration Runner
 *
 * Nasıl çalışır?
 * 1. `schema_migrations` tablosu yoksa oluşturur (migration geçmişi burada tutulur)
 * 2. `migrations/` klasöründeki .sql dosyalarını sırayla okur
 * 3. Daha önce çalışmış olanları atlar (idempotent)
 * 4. Yeni olanları çalıştırır ve `schema_migrations`'a kaydeder
 *
 * Neden bu yaklaşım?
 * - Her çalıştırmada tüm SQL'i tekrar çalıştırmak yerine sadece yenileri çalışır
 * - Hangi migration'ların ne zaman çalıştığını takip edebilirsin
 * - Flyway / Liquibase gibi araçların yaptığı şeyin basit versiyonu
 */

import { pgPool } from '../src/config/database';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(): Promise<void> {
  // Bu tablo migration geçmişini tutar
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(255) PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pgPool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return new Set(result.rows.map((r) => r.version));
}

async function runMigration(filename: string, sql: string): Promise<void> {
  // Her migration bir transaction içinde çalışır
  // Eğer SQL hata verirse transaction rollback olur — DB yarım kalmaz
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`  ✓ ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  console.log('Running migrations...\n');

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  // .sql dosyalarını alfabetik sıraya göre al (001_, 002_, ... sırası önemli)
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    process.exit(0);
  }

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  – ${file} (already applied, skipping)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await runMigration(file, sql);
    ran++;
  }

  console.log(`\nDone. ${ran} migration(s) applied.`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
