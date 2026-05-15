# ADR-001: Distributed URL Shortener Architecture

| Field    | Value                          |
|----------|--------------------------------|
| Status   | **Accepted**                   |
| Date     | 2026-05-14                     |
| Authors  | Platform Engineering Team      |
| Deciders | Engineering Lead, CTO          |

---

## Context

NanoURL must handle production-grade traffic from day one. The system requirements are:

| Metric              | Target                  |
|---------------------|-------------------------|
| URL creations       | 10M+ per day            |
| Redirect requests   | 100M+ per day           |
| Redirect latency    | P99 < 10ms              |
| Availability        | 99.99% (< 52 min/year)  |
| Short code length   | 7 characters (Base62)   |

These constraints rule out simple single-node architectures and require deliberate decisions around ID generation, data distribution, caching, and observability.

---

## Decisions

### 1. ID Generation — Snowflake + Base62 Encoding

Short codes are derived from 64-bit Snowflake IDs encoded in Base62.

**Structure of a Snowflake ID:**

```
┌─────────┬──────────────────────────┬──────────────┬──────────────────┐
│  1 bit  │       41 bits            │   10 bits    │    12 bits       │
│ unused  │  millisecond timestamp   │   node ID    │  sequence number │
└─────────┴──────────────────────────┴──────────────┴──────────────────┘
```

- **41-bit timestamp** — supports ~69 years of unique IDs from epoch
- **10-bit node ID** — up to 1,024 distributed generator nodes
- **12-bit sequence** — up to 4,096 IDs per millisecond per node

**Why not alternatives?**

| Approach     | Problem                                              |
|--------------|------------------------------------------------------|
| Random hash  | Collision risk at scale; requires uniqueness checks  |
| MD5/SHA      | Not time-sortable; longer output                     |
| Auto-increment | Sequential IDs cause database write hot-spotting  |
| UUID v4      | 36-char output; not sortable; poor DB index locality |

Snowflake IDs are time-sortable, globally unique without coordination, and encode to 7-character Base62 strings — ideal for short URLs.

---

### 2. Database — Sharded PostgreSQL

PostgreSQL is sharded across 64 virtual nodes using consistent hashing.

| Parameter       | Value                                    |
|-----------------|------------------------------------------|
| Shard key       | First 2 characters of the Base62 code   |
| Shard count     | 64 (consistent hashing ring)            |
| Replication     | 1 primary + 2 asynchronous replicas      |
| Partitioning    | Range partitioning by `created_at`       |

Consistent hashing minimises data movement when nodes are added or removed. See [ADR-002](./ADR-002-database-sharding.md) for the full sharding strategy.

**Why not alternatives?**

| Alternative  | Reason Rejected                                          |
|--------------|----------------------------------------------------------|
| MongoDB      | Sharding operationally more complex; less mature tooling |
| CockroachDB  | Higher write latency; licensing cost at scale            |
| Single PG    | Write hot-spotting; no horizontal scale path             |

---

### 3. Multi-Layer Caching

Redirects are served from the nearest available cache layer to achieve sub-10ms P99 latency.

```
Request
  │
  ├─► L1: In-process LRU cache   (10K entries, 5 min TTL)   ~60–70% hit rate
  │
  ├─► L2: Redis Cluster          (100M+ entries, 1h TTL)    ~25–30% hit rate
  │
  ├─► L3: CDN Edge (CloudFront)  (regional, configurable)   ~5–10% hit rate
  │
  └─► L4: PostgreSQL             (source of truth)          < 1% of requests
```

A Bloom filter sits in front of L4 to reject lookups for non-existent short codes without touching the database. See [ADR-003](./ADR-003-caching-strategy.md) for the full caching strategy.

---

### 4. Event-Driven Analytics — Apache Kafka

All URL lifecycle events are published to Kafka topics and consumed asynchronously. This decouples the hot redirect path from analytics writes.

| Topic           | Producer          | Consumer(s)                    |
|-----------------|-------------------|--------------------------------|
| `url.created`   | Write service     | Analytics service, audit log   |
| `url.accessed`  | Read service      | Real-time metrics, ClickHouse  |
| `url.expired`   | Cleanup worker    | Deletion service               |

---

## Consequences

**Positive**

- Horizontal scalability at every layer (API, DB, cache, analytics)
- Sub-10ms redirects achievable through layered caching
- Isolated failure domains — a shard failure affects only ~1.5% of traffic
- Real-time analytics without impacting the redirect critical path

**Negative**

- Increased operational complexity: Kafka, Redis Cluster, and K8s all require expertise
- Eventual consistency for analytics counters (click counts may lag by seconds)
- Cross-shard queries (e.g., "all URLs for user X") require scatter-gather or a secondary index

---

## Alternatives Considered

| Alternative                  | Reason Rejected                                              |
|------------------------------|--------------------------------------------------------------|
| Monolithic single-DB design  | Cannot meet latency or availability targets at target scale  |
| DynamoDB                     | Vendor lock-in; cost unpredictable at 100M redirects/day     |
| Redis as primary store       | Durability risk; persistence adds latency                    |
| Synchronous analytics writes | Adds 5–20ms to redirect path; unacceptable                   |

---

## Related Decisions

- [ADR-002: Database Sharding Strategy](./ADR-002-database-sharding.md)
- [ADR-003: Multi-Layer Caching Strategy](./ADR-003-caching-strategy.md)
