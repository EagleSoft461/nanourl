# ADR-002: Database Sharding Strategy

## Status

**Accepted** — 2026-05-14

## Decision

Use **Consistent Hashing** with 64 virtual shards mapped to PostgreSQL instances.

## Shard Key Selection

```typescript
// short_code: "a3f9k2m"
const shardKey = short_code.substring(0, 2); // "a3"
const shardId = consistentHash(shardKey, 64);  // 0-63
```

## Schema per Shard
```sql
CREATE TABLE urls (
    id              BIGSERIAL PRIMARY KEY,
    short_code      VARCHAR(7) UNIQUE NOT NULL,
    original_url    TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NULL,
    click_count     BIGINT DEFAULT 0,
    user_id         UUID NULL,
    
    CONSTRAINT valid_url CHECK (LENGTH(original_url) <= 2048)
);

CREATE INDEX idx_short_code ON urls(short_code);
CREATE INDEX idx_expires_at ON urls(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_user_id ON urls(user_id) WHERE user_id IS NOT NULL;
```

## Partitioning Strategy
```sql
-- Partition by created_at for time-series cleanup
CREATE TABLE urls_2024 PARTITION OF urls
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
    
CREATE TABLE urls_2025 PARTITION OF urls
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
```

## Rebalancing Strategy

1. Add new node to hash ring
2. Migrate only affected keys (minimal disruption)
3. Update routing table
4. Verify data consistency

## Trade-offs

| Pros  | Cons | 
|----------|-------|
| Linear scalability   | Cross-shard queries complex  |
| Isolated failures  | Shard management overhead  |
| Localized hot spots  | Rebalancing requires planning   |


---

## 📄 `docs/ADR-003-caching-strategy.md`

```markdown
# ADR-003: Multi-Layer Caching Strategy

## Status

**Accepted** — 2026-05-14

## Cache Hierarchy

| Layer | Technology | Capacity | TTL | Hit Rate |
|-------|-----------|----------|-----|----------|
| L1 | Local LRU (in-process) | 10,000 entries/node | 5 min | ~60-70% |
| L2 | Redis Cluster | 100M+ entries | 1h (hot), 24h (warm) | ~25-30% |
| L3 | CDN Edge (CloudFront) | Regional | Configurable | ~5-10% |
| L4 | PostgreSQL | Persistent | Permanent | <1% |

## Cache-Aside Pattern

```typescript
async function getUrl(shortCode: string): Promise<string | null> {
  // L1: Local cache
  if (url = localCache.get(shortCode)) return url;
  
  // L2: Redis
  if (url = await redis.get(shortCode)) {
    localCache.set(shortCode, url);
    return url;
  }
  
  // Bloom filter check (prevent DB hits)
  if (!bloomFilter.contains(shortCode)) return null;
  
  // L4: Database
  url = await db.query('SELECT original_url FROM urls WHERE short_code = $1', [shortCode]);
  if (url) {
    await redis.setex(shortCode, 3600, url);
    localCache.set(shortCode, url);
  }
  return url;
}
```
## Invalidation Strategy
| Event | Action |
|----------|----------|
| URL Created  |  Write-through to L1 + L2  |
| URL Deleted | Invalidate L1 + L2 + Broadcast   |
| TTL Expired | Lazy eviction (next access) |

## Bloom Filter

- 1B capacity, 0.01% false positive rate
- Prevents cache stampede on non-existent URLs
- Rebuilt daily from database snapshot

## Cache Warming
```TypeScript
// On startup: Load top 10K URLs into Redis
async function warmCache(): Promise<void> {
  const hotUrls = await db.query(`
    SELECT short_code, original_url 
    FROM urls 
    ORDER BY click_count DESC 
    LIMIT 10000
  `);
  
  for (const url of hotUrls) {
    await redis.setex(url.short_code, 86400, url.original_url);
  }
}
```

---

## 📄 `docs/API-SPEC-v1.md`

```markdown
# API Specification v1.0

## Base URL

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:3000` |
| Production | `https://api.nanourl.io` |

## Authentication

Optional. Anonymous users have lower rate limits.

```http
Authorization: Bearer <jwt_token>
```
## Rate Limits
| Tier  | Limit | 
|----------|-------|
| Anonymous | 10 requests/minute  |
| Free  | 100 URLs/day |
| Pro  | 10,000 URLs/day  |
| Enterprise | Unlimited |

---

# Endpoints

## Create Short URL
```http
POST /api/v1/urls
Content-Type: application/json
Authorization: Bearer <token>  # Optional
```

## Request Body:
```JSON
{
  "url": "https://example.com/very/long/path?with=parameters",
  "custom_alias": "my-brand",      // Optional (6-20 chars)
  "expires_in": 86400,             // Optional, seconds
  "password": null,                // Optional, protected URL
  "utm_source": "twitter"            // Optional, tracking
}
```

## Response (201 Created):
```JSON
{
  "short_code": "a3f9k2m",
  "short_url": "https://nano.url/a3f9k2m",
  "original_url": "https://example.com/very/long/path?with=parameters",
  "expires_at": "2026-05-15T18:39:00Z",
  "created_at": "2026-05-14T18:39:00Z",
  "analytics": {
    "qr_code": "https://nano.url/qr/a3f9k2m",
    "tracking_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```
---

## Redirect (Public)
```http
GET /:shortCode
Accept: application/json  # Optional, returns metadata instead
```

## Response (301 Moved Permanently):
```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/very/long/path?with=parameters
X-Cache-Hit: HIT
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
```
---
## Get URL Analytics

```http
GET /api/v1/urls/:shortCode/analytics
Authorization: Bearer <token>
```

## Response
```JSON
{
  "short_code": "a3f9k2m",
  "total_clicks": 15420,
  "unique_clicks": 12300,
  "top_countries": ["US", "TR", "DE"],
  "top_referrers": ["twitter.com", "google.com"],
  "click_history": [
    { "date": "2026-05-14", "clicks": 1200 },
    { "date": "2026-05-13", "clicks": 980 }
  ]
}
```
---

## Delete URL
```http
DELETE /api/v1/urls/:shortCode
Authorization: Bearer <token>
```
## Response (204 No Content):
```http
HTTP/1.1 204 No Content
```