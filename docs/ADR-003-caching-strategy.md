# ADR-003: Multi-Layer Caching Strategy

| Field    | Value                          |
|----------|--------------------------------|
| Status   | **Accepted**                   |
| Date     | 2026-05-14                     |
| Authors  | Platform Engineering Team      |
| Deciders | Engineering Lead               |

---

## Context

Redirect requests account for ~90% of total traffic (100M+ per day). Serving every redirect from PostgreSQL is not feasible — even a well-tuned database cannot sustain this read volume at sub-10ms P99 latency.

A layered caching strategy is required to absorb the vast majority of reads before they reach the database, while keeping the cache coherent with the source of truth.

---

## Decision

Implement a four-layer cache hierarchy using the **cache-aside** pattern, with a Bloom filter to eliminate database lookups for non-existent short codes.

---

## Cache Hierarchy

| Layer | Technology              | Capacity              | TTL                        | Expected Hit Rate |
|-------|-------------------------|-----------------------|----------------------------|-------------------|
| L1    | In-process LRU          | 10,000 entries / node | 5 minutes                  | 60–70%            |
| L2    | Redis Cluster           | 100M+ entries         | 1h (hot) / 24h (warm)      | 25–30%            |
| L3    | CDN Edge (CloudFront)   | Regional              | Configurable per route     | 5–10%             |
| L4    | PostgreSQL              | Persistent            | Permanent (source of truth)| < 1%              |

The combined hit rate across L1–L3 targets **> 99%**, meaning fewer than 1 in 100 redirect requests touches the database.

---

## Cache-Aside Lookup Flow

```typescript
async function resolveUrl(shortCode: string): Promise<string | null> {
  // L1: In-process LRU cache (zero network overhead)
  const l1Hit = localCache.get(shortCode);
  if (l1Hit) return l1Hit;

  // L2: Redis Cluster
  const l2Hit = await redis.get(`url:${shortCode}`);
  if (l2Hit) {
    localCache.set(shortCode, l2Hit);
    return l2Hit;
  }

  // Bloom filter: reject lookups for codes that have never existed
  // Prevents cache stampede and unnecessary DB reads
  if (!bloomFilter.mightContain(shortCode)) {
    return null; // Definitive miss — no DB query needed
  }

  // L4: PostgreSQL (last resort)
  const row = await db.queryOne(
    'SELECT original_url FROM urls WHERE short_code = $1',
    [shortCode]
  );

  if (row) {
    // Populate both cache layers on DB hit
    await redis.setex(`url:${shortCode}`, 3600, row.original_url);
    localCache.set(shortCode, row.original_url);
  }

  return row?.original_url ?? null;
}
```

---

## Cache Invalidation

| Event          | Action                                                              |
|----------------|---------------------------------------------------------------------|
| URL created    | Write-through to L1 and L2; add to Bloom filter                    |
| URL deleted    | Invalidate L1 and L2; publish `url.invalidated` event to all nodes |
| URL expired    | Lazy eviction on next access; TTL handles L2 expiry automatically  |
| Node restart   | L1 rebuilt via cache warming on startup                            |

L1 invalidation across nodes is handled via a Redis pub/sub channel (`cache.invalidate`). Each API node subscribes and evicts the affected key from its local LRU on receipt.

---

## Bloom Filter

A Bloom filter prevents the database from being queried for short codes that do not exist — a common attack vector (random code enumeration).

| Parameter         | Value                        |
|-------------------|------------------------------|
| Capacity          | 1 billion entries            |
| False positive rate | 0.01%                      |
| Memory footprint  | ~1.8 GB                      |
| Rebuild frequency | Daily (from DB snapshot)     |
| Storage           | Redis (serialised bit array) |

A false positive (Bloom filter says "exists" but DB returns nothing) results in one unnecessary DB query — acceptable at 0.01% rate. A false negative is impossible by design.

---

## Cache Warming

On service startup, the top 10,000 most-accessed URLs are pre-loaded into Redis to avoid a cold-start latency spike.

```typescript
async function warmCache(): Promise<void> {
  const hotUrls = await db.query<{ short_code: string; original_url: string }>(`
    SELECT short_code, original_url
    FROM urls
    ORDER BY click_count DESC
    LIMIT 10000
  `);

  const pipeline = redis.pipeline();
  for (const { short_code, original_url } of hotUrls) {
    pipeline.setex(`url:${short_code}`, 86400, original_url);
  }
  await pipeline.exec();
}
```

Warming is performed in a single Redis pipeline to minimise startup time.

---

## Trade-offs

| Dimension          | Pro                                                  | Con                                                    |
|--------------------|------------------------------------------------------|--------------------------------------------------------|
| Latency            | Sub-millisecond L1 hits; < 2ms L2 hits               | —                                                      |
| Consistency        | —                                                    | L1 may serve stale data for up to 5 minutes            |
| Complexity         | —                                                    | Invalidation across distributed L1 caches is non-trivial |
| Cost               | Dramatically reduces DB read load                    | Redis Cluster has non-trivial infrastructure cost      |
| Resilience         | L2 and L4 remain available if L1 is cold             | Redis outage degrades to DB-only reads                 |

---

## Alternatives Considered

| Alternative                  | Reason Rejected                                                    |
|------------------------------|--------------------------------------------------------------------|
| Single Redis layer only      | L1 eliminates network round-trip for hottest keys; measurable gain |
| Write-through cache          | Adds latency to the write path; not justified for URL creation     |
| Memcached instead of Redis   | Redis supports pub/sub (needed for invalidation) and persistence   |
| No Bloom filter              | Non-existent code lookups would hit DB on every request            |

---

## Related Decisions

- [ADR-001: System Architecture](./ADR-001-architecture.md)
- [ADR-002: Database Sharding Strategy](./ADR-002-database-sharding.md)
