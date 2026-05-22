import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShardRouter } from '../shardRouter';

describe('ShardRouter', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default pool when sharding is disabled', () => {
    process.env.ENABLE_SHARDING = 'false';
    const router = new ShardRouter();

    const pool1 = router.getPool('abc123');
    const pool2 = router.getPool('xyz789');

    // Sharding kapalı — her key aynı pool'u almalı
    expect(pool1).toBe(pool2);
  });

  it('returns consistent pool for same short code prefix', () => {
    process.env.ENABLE_SHARDING = 'true';
    const router = new ShardRouter({
      nodes: [
        { id: 'pg-0', host: 'pg-0.db', port: 5432, database: 'nanourl' },
        { id: 'pg-1', host: 'pg-1.db', port: 5432, database: 'nanourl' },
      ],
    });

    // Aynı prefix → aynı pool
    const pool1 = router.getPool('ab1234');
    const pool2 = router.getPool('ab5678');
    expect(pool1).toBe(pool2);
  });

  it('getAllPools returns single pool when sharding is disabled', () => {
    process.env.ENABLE_SHARDING = 'false';
    const router = new ShardRouter();
    expect(router.getAllPools()).toHaveLength(1);
  });

  it('getAllPools returns all shard pools when sharding is enabled', () => {
    process.env.ENABLE_SHARDING = 'true';
    const router = new ShardRouter({
      nodes: [
        { id: 'pg-0', host: 'pg-0.db', port: 5432, database: 'nanourl' },
        { id: 'pg-1', host: 'pg-1.db', port: 5432, database: 'nanourl' },
        { id: 'pg-2', host: 'pg-2.db', port: 5432, database: 'nanourl' },
      ],
    });

    // default pool + 3 shard pool
    expect(router.getAllPools().length).toBeGreaterThanOrEqual(3);
  });

  it('getShardInfo reports correct state', () => {
    process.env.ENABLE_SHARDING = 'false';
    const router = new ShardRouter();
    const info = router.getShardInfo();

    expect(info.enabled).toBe(false);
    expect(info.nodeCount).toBeGreaterThanOrEqual(1);
  });

  it('uses first 2 chars of short code as shard key', () => {
    process.env.ENABLE_SHARDING = 'true';
    const router = new ShardRouter({
      nodes: [
        { id: 'pg-0', host: 'pg-0.db', port: 5432, database: 'nanourl' },
        { id: 'pg-1', host: 'pg-1.db', port: 5432, database: 'nanourl' },
      ],
    });

    // "ab" prefix'li tüm key'ler aynı shard'a gitmeli
    const pools = ['ab0001', 'ab0002', 'ab9999'].map((k) => router.getPool(k));
    expect(pools[0]).toBe(pools[1]);
    expect(pools[1]).toBe(pools[2]);
  });
});
