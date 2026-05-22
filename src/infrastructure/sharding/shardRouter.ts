/**
 * Shard Router
 *
 * Ne yapar?
 * Short code'a bakarak hangi PostgreSQL shard'ına gidileceğini belirler.
 *
 * Shard key neden short code'un ilk 2 karakteri? (ADR-002)
 * - Deterministik: "ab" her zaman aynı shard'a gider
 * - İyi dağılım: Base62 ile 62² = 3844 farklı prefix → 64 shard'a dengeli dağılır
 * - Basit: Prefix'i almak O(1)
 *
 * Feature Flag:
 * ENABLE_SHARDING=false → tek PostgreSQL (şu an)
 * ENABLE_SHARDING=true  → consistent hashing aktif (ileride)
 *
 * Neden feature flag?
 * Kod hazır ama production'da güvenle kapalı tutulabilir.
 * Trafik gelince sadece env değişkeni değiştirilir.
 * Mevcut kod hiç etkilenmez.
 */

import { Pool } from 'pg';
import { ConsistentHashRing, ShardNode } from './consistentHash';

// Shard konfigürasyonu — env'den veya config dosyasından gelir
export interface ShardConfig {
  nodes: ShardNode[];
  virtualNodesPerPhysical?: number;
}

// Varsayılan tek node konfigürasyonu (sharding kapalıyken)
function getDefaultNode(): ShardNode {
  return {
    id: 'pg-default',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'nanourl',
  };
}

export class ShardRouter {
  private ring: ConsistentHashRing;
  private pools: Map<string, Pool> = new Map();
  private readonly shardingEnabled: boolean;
  private defaultPool: Pool;

  constructor(config?: ShardConfig) {
    this.shardingEnabled = process.env.ENABLE_SHARDING === 'true';

    this.ring = new ConsistentHashRing(
      config?.virtualNodesPerPhysical ?? 150
    );

    if (this.shardingEnabled && config?.nodes.length) {
      // Sharding aktif — tüm node'ları ring'e ekle
      for (const node of config.nodes) {
        this.ring.addNode(node);
        this.pools.set(node.id, this.createPool(node));
      }
      console.log(
        `[ShardRouter] Sharding enabled with ${config.nodes.length} nodes`
      );
    } else {
      // Sharding kapalı — tek node
      const defaultNode = getDefaultNode();
      this.ring.addNode(defaultNode);
    }

    // Varsayılan pool — sharding kapalıyken veya fallback için
    this.defaultPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'nanourl',
      password: process.env.POSTGRES_PASSWORD || 'secret123',
      database: process.env.POSTGRES_DB || 'nanourl',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  // Short code için doğru Pool'u döndür
  // Bu metod repository'nin tek bilmesi gereken şey
  getPool(shortCode: string): Pool {
    if (!this.shardingEnabled) {
      return this.defaultPool;
    }

    // Shard key: short code'un ilk 2 karakteri (ADR-002)
    const shardKey = shortCode.substring(0, 2);
    const node = this.ring.getNode(shardKey);

    if (!node) {
      console.warn('[ShardRouter] No node found, falling back to default');
      return this.defaultPool;
    }

    return this.pools.get(node.id) ?? this.defaultPool;
  }

  // Tüm shard'lara sorgu at — cross-shard queries için (list, analytics)
  // Neden gerekli? "Kullanıcının tüm URL'leri" farklı shard'larda olabilir
  getAllPools(): Pool[] {
    if (!this.shardingEnabled) {
      return [this.defaultPool];
    }
    return [this.defaultPool, ...this.pools.values()];
  }

  // Shard dağılımını göster — debug/monitoring için
  getShardInfo(): {
    enabled: boolean;
    nodeCount: number;
    distribution: Record<string, number>;
  } {
    return {
      enabled: this.shardingEnabled,
      nodeCount: this.ring.nodeCount,
      distribution: this.ring.getDistribution(),
    };
  }

  async closeAll(): Promise<void> {
    await this.defaultPool.end();
    for (const pool of this.pools.values()) {
      await pool.end();
    }
  }

  private createPool(node: ShardNode): Pool {
    return new Pool({
      host: node.host,
      port: node.port,
      user: process.env.POSTGRES_USER || 'nanourl',
      password: process.env.POSTGRES_PASSWORD || 'secret123',
      database: node.database,
      max: 10, // Shard başına daha az bağlantı
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
}

// Singleton — uygulama boyunca tek router
export const shardRouter = new ShardRouter();
