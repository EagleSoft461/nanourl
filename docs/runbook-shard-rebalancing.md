# Runbook: Shard Rebalancing

| Field    | Value                        |
|----------|------------------------------|
| Version  | 1.0.0                        |
| Updated  | 2026-05-22                   |
| Relates  | ADR-002 (Database Sharding)  |

---

## Overview

NanoURL uses consistent hashing to distribute URLs across PostgreSQL shards. When a new shard is added or an existing one is removed, a subset of data must be migrated to maintain correct routing.

**Key property:** With 150 virtual nodes per physical node, adding one shard to an N-shard cluster moves approximately `1/(N+1)` of the data — not all of it.

---

## Shard Key

The shard key is the **first 2 characters of the short code** (e.g., `"ab"` for `"ab3f9k2"`).

- Base62 alphabet → 62² = 3,844 possible prefixes
- 64 virtual shards → ~60 prefixes per shard on average
- Routing is deterministic: the same short code always maps to the same shard

---

## Architecture

```
URLService
    │
    ▼
ShardedPostgresURLRepository
    │
    ▼
ShardRouter.getPool(shortCode)
    │
    ▼
ConsistentHashRing.getNode(shortCode[0..2])
    │
    ▼
pg.Pool → PostgreSQL shard
```

Cross-shard queries (list, search) use `ShardRouter.getAllPools()` and fan out with `Promise.all`.

---

## Adding a New Shard

### Step 1 — Provision the new PostgreSQL instance

```bash
# Example: new shard pg-shard-3 at postgres-3.nanourl.svc
psql -h postgres-3.nanourl.svc -U nanourl -c "CREATE DATABASE nanourl_shard3;"
psql -h postgres-3.nanourl.svc -U nanourl -d nanourl_shard3 -f migrations/001_create_urls.sql
psql -h postgres-3.nanourl.svc -U nanourl -d nanourl_shard3 -f migrations/002_add_indexes.sql
psql -h postgres-3.nanourl.svc -U nanourl -d nanourl_shard3 -f migrations/003_create_users.sql
```

### Step 2 — Identify which short codes will move

The consistent hash ring determines which keys shift to the new node. Use the following script to preview the migration scope before touching any data:

```typescript
import { ConsistentHashRing } from './src/infrastructure/sharding/consistentHash';

const before = new ConsistentHashRing(150);
before.addNode({ id: 'pg-shard-0', host: 'postgres-0.nanourl.svc', port: 5432, database: 'nanourl' });
before.addNode({ id: 'pg-shard-1', host: 'postgres-1.nanourl.svc', port: 5432, database: 'nanourl' });
before.addNode({ id: 'pg-shard-2', host: 'postgres-2.nanourl.svc', port: 5432, database: 'nanourl' });

const after = new ConsistentHashRing(150);
after.addNode({ id: 'pg-shard-0', host: 'postgres-0.nanourl.svc', port: 5432, database: 'nanourl' });
after.addNode({ id: 'pg-shard-1', host: 'postgres-1.nanourl.svc', port: 5432, database: 'nanourl' });
after.addNode({ id: 'pg-shard-2', host: 'postgres-2.nanourl.svc', port: 5432, database: 'nanourl' });
after.addNode({ id: 'pg-shard-3', host: 'postgres-3.nanourl.svc', port: 5432, database: 'nanourl' });

// Base62 alphabet — all possible 2-char prefixes
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let movedPrefixes = 0;

for (const a of BASE62) {
  for (const b of BASE62) {
    const prefix = a + b;
    const oldNode = before.getNode(prefix)?.id;
    const newNode = after.getNode(prefix)?.id;
    if (oldNode !== newNode) {
      console.log(`  ${prefix}: ${oldNode} → ${newNode}`);
      movedPrefixes++;
    }
  }
}

console.log(`\nTotal prefixes moving: ${movedPrefixes} / 3844 (${((movedPrefixes / 3844) * 100).toFixed(1)}%)`);
```

Expected output: ~25% of prefixes move when going from 3 → 4 shards.

### Step 3 — Migrate data (dual-write window)

Enable dual-write mode so new writes go to both old and new shards during migration:

```bash
# Set env on all API pods
SHARD_DUAL_WRITE=true
```

> **Note:** Dual-write is not yet implemented in `ShardRouter`. Add it before running a live migration. See the implementation note at the end of this document.

Then copy the affected rows:

```sql
-- Run on the SOURCE shard for each prefix that is moving
-- Example: moving prefix "ab" from pg-shard-0 to pg-shard-3

INSERT INTO nanourl_shard3.public.urls
SELECT * FROM urls
WHERE LEFT(short_code, 2) = 'ab'
ON CONFLICT (short_code) DO NOTHING;
```

For large datasets, use `pg_dump` with a `WHERE` clause and restore to the target:

```bash
pg_dump \
  -h postgres-0.nanourl.svc \
  -U nanourl \
  -d nanourl \
  --table=urls \
  --where="LEFT(short_code, 2) IN ('ab', 'ac', 'ad')" \
  -F c \
  -f /tmp/shard_migration.dump

pg_restore \
  -h postgres-3.nanourl.svc \
  -U nanourl \
  -d nanourl_shard3 \
  --no-owner \
  /tmp/shard_migration.dump
```

### Step 4 — Update shard configuration

Add the new node to the `ShardRouter` config and deploy:

```typescript
// src/infrastructure/sharding/shardRouter.ts (or config file)
const shardConfig: ShardConfig = {
  nodes: [
    { id: 'pg-shard-0', host: 'postgres-0.nanourl.svc', port: 5432, database: 'nanourl' },
    { id: 'pg-shard-1', host: 'postgres-1.nanourl.svc', port: 5432, database: 'nanourl' },
    { id: 'pg-shard-2', host: 'postgres-2.nanourl.svc', port: 5432, database: 'nanourl' },
    { id: 'pg-shard-3', host: 'postgres-3.nanourl.svc', port: 5432, database: 'nanourl' }, // NEW
  ],
};
```

Deploy with a rolling update — Kubernetes will restart pods one at a time, so there is no downtime.

### Step 5 — Verify and clean up

After all pods are running the new config:

1. Verify reads are hitting the correct shard (check `X-Shard-ID` response header if instrumented)
2. Run a consistency check — count rows per shard and compare with expected distribution
3. Disable dual-write: `SHARD_DUAL_WRITE=false`
4. Delete migrated rows from the source shard:

```sql
-- Run on SOURCE shard ONLY after verifying data is on the target
DELETE FROM urls WHERE LEFT(short_code, 2) IN ('ab', 'ac', 'ad');
```

---

## Removing a Shard

Removing a shard is the reverse of adding one. The key difference: **migrate data first, then remove the node from the ring.**

1. Identify which prefixes are currently on the shard being removed
2. Migrate those rows to the node that will take over (determined by the ring without the removed node)
3. Remove the node from `ShardConfig`
4. Deploy with rolling update
5. Decommission the PostgreSQL instance

---

## Cross-Shard Query Strategy

`ShardedPostgresURLRepository.list()` fans out to all shards in parallel using `Promise.all`. This works for moderate shard counts (≤ 16) but has limitations at scale:

| Approach | When to use | Trade-off |
|---|---|---|
| **Fan-out (current)** | ≤ 16 shards, moderate traffic | Simple; N × DB connections per request |
| **Scatter-gather with cursor** | > 16 shards | Lower memory; requires cursor state |
| **Dedicated read replica** | High list/search traffic | Extra infra; best consistency |
| **Elasticsearch index** | Full-text search at scale | Eventual consistency; separate sync pipeline |

For user-scoped listing (`GET /api/v1/urls` with auth), consider adding a `user_id → shard_id` mapping table on a dedicated metadata node. This avoids fan-out entirely for authenticated users.

---

## Monitoring During Rebalancing

Watch these metrics in Prometheus/Grafana during a migration:

```promql
# Error rate per shard
rate(http_requests_total{status=~"5.."}[1m])

# DB connection pool saturation
pg_pool_waiting_count

# Cache miss rate (elevated during migration)
rate(cache_hits_total[1m]) / rate(http_requests_total[1m])

# Redirect latency P99 (should stay < 10ms)
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{path="/:shortCode"}[5m]))
```

---

## Implementation Notes

### Dual-write (not yet implemented)

Before running a live migration, add dual-write support to `ShardRouter`:

```typescript
// In ShardRouter.getPool() — when SHARD_DUAL_WRITE=true
// Return a proxy pool that writes to both old and new shard
// Reads still go to the old shard until migration is complete
```

### Shard-aware cache invalidation

When a URL moves shards, its Redis cache key (`url:<shortCode>`) remains valid — the cache is shard-agnostic. No cache invalidation is needed during rebalancing.

### Short code immutability

Short codes are never updated after creation. This means the shard assignment for any given URL is permanent and determined at creation time. There is no risk of a URL "drifting" to a different shard over time.
