# NanoURL Roadmap

Last updated: 2026-05-17

---

## Current Status

NanoURL is an early MVP for a distributed URL shortener.

**Working today:**
- Fastify HTTP server
- `POST /api/v1/urls` — short URL creation
- `GET /:shortCode` — redirect flow
- PostgreSQL persistence
- Redis read cache
- Snowflake ID + Base62 short code generation
- Zod request validation
- Standardized error response format
- `410 Gone` for expired URLs
- Basic unit and service tests

**Known gaps:**
- No repository layer — SQL lives directly in the service
- `/qr/:shortCode` endpoint missing but returned in create response
- No authentication (JWT)
- Rate limiting not active
- No Kafka / ClickHouse / analytics pipeline
- No L1 in-process cache
- No Bloom filter
- Kubernetes manifests are empty
- No integration or benchmark tests
- No CI/CD pipeline
- No `.env.example`

---

## Guiding Goal

Build NanoURL from a clean MVP into a reliable, production-ready service in small, verifiable steps. Each phase should leave the project runnable, tested, and documented.

---

## Phase 1 — MVP Hardening ✅ (Largely complete)

**Goal:** Make the current core API correct, predictable, and testable.

- [x] Zod validation for create URL request payloads
- [x] Standardized error responses across all handlers
- [x] Custom alias length and character validation
- [x] `expiresIn` min/max limit enforcement
- [x] `410 Gone` for expired short URLs
- [x] Prevent expired URLs from being served from Redis cache
- [x] Fastify integration tests for create and redirect flows
- [x] Service tests for expiry, custom aliases, and cache fallback
- [ ] Add `.env.example`
- [ ] Align response field naming with API spec (camelCase vs snake_case)

---

## Phase 2 — Persistence Boundary

**Goal:** Separate business logic from storage and make the codebase easier to extend.

- [ ] Create `src/repositories/urlRepository.ts`
- [ ] Move SQL queries out of `URLService` into the repository
- [ ] Add a Redis cache abstraction at `src/infrastructure/cache.ts`
- [ ] Add defensive retry logic for short code collisions on creation
- [ ] Add migration tracking or document the current migration workflow
- [ ] Add indexes needed for user-scoped listing and analytics queries
- [ ] Unit tests for the repository layer

---

## Phase 3 — API v1 Completeness

**Goal:** Implement the full documented v1 API surface, or explicitly trim the spec.

- [ ] `GET /api/v1/urls/:shortCode` — resolve endpoint
- [ ] `GET /api/v1/urls/:shortCode/info` — full URL metadata
- [ ] `PATCH /api/v1/urls/:shortCode` — update URL
- [ ] `DELETE /api/v1/urls/:shortCode` — delete URL
- [ ] `GET /api/v1/urls` — paginated list (page, page_size, sort, search)
- [ ] `GET /api/v1/urls/:shortCode/analytics` — basic analytics
- [ ] `GET /api/v1/urls/:shortCode/qr` — QR code endpoint, or remove QR URL from create response
- [ ] OpenAPI spec generation or keep `docs/API-SPEC-v1.md` manually synced

---

## Phase 4 — Security and Accounts

**Goal:** Make public URL creation safer and add user ownership.

- [ ] Enable `@fastify/rate-limit`
- [ ] Anonymous and authenticated rate limit tiers (per API spec)
- [ ] Request IDs and structured log format
- [ ] JWT authentication (RS256, 1h access token + 30d refresh token)
- [ ] User ownership tied to URLs
- [ ] Password-protected redirects (optional, depending on product scope)
- [ ] URL safety checks: unsupported protocols, local/private network targets
- [ ] Tests for auth middleware

---

## Phase 5 — Analytics Pipeline

**Goal:** Collect redirect events without slowing down the redirect path.

- [ ] Emit redirect events asynchronously
- [ ] `src/infrastructure/kafka.ts` — Kafka producer abstraction
- [ ] Define click event schema
- [ ] `src/workers/analyticsWorker.ts` — analytics consumer
- [ ] Decide whether ClickHouse is required now or later
- [ ] Implement aggregate analytics endpoint
- [ ] Integration tests around event emission boundaries
- [ ] `url.created`, `url.accessed`, `url.expired` Kafka topics

---

## Phase 6 — Performance Optimization

**Goal:** Implement the cache hierarchy and Bloom filter defined in the architecture ADRs.

- [ ] `src/infrastructure/localCache.ts` — L1 in-process LRU cache (10K entries, 5 min TTL)
- [ ] Bloom filter implementation (1B capacity, 0.01% false positive rate)
- [ ] Cache warming — load top 10K URLs into Redis on startup
- [ ] L1 cache invalidation via Redis pub/sub (cross-node)
- [ ] Cache layer metrics (hit rate, miss rate)
- [ ] Verify P99 < 10ms target on the redirect path
- [ ] Benchmark / load test script (`tests/benchmark/`)

---

## Phase 7 — Operational Readiness

**Goal:** Make the app easy to run, observe, and deploy.

- [ ] `Dockerfile` (multi-stage build)
- [ ] `docker-compose.yml` — clean startup of all local dependencies (PG, Redis, Kafka)
- [ ] Health checks for API, PostgreSQL, and Redis
- [ ] GitHub Actions CI workflow (tests + type check)
- [ ] Prometheus metrics endpoint (`/metrics`)
- [ ] Basic observability: structured logs, latency counters
- [ ] Kubernetes manifests (after runtime shape is stable)
- [ ] Helm chart (optional, after K8s manifests)

---

## Phase 8 — Database Sharding (Advanced)

**Goal:** Implement the sharding strategy defined in ADR-002.

> ⚠️ This phase should only be tackled when real traffic scale demands it. Premature sharding adds significant operational complexity.

- [ ] Consistent hashing ring implementation
- [ ] Shard routing layer (based on first 2 characters of short code)
- [ ] 64 virtual shards → PostgreSQL instance mapping
- [ ] Range partitioning by `created_at`
- [ ] Shard rebalancing procedure documentation
- [ ] Cross-shard query strategy (for user-scoped listing)

---

## Next Recommended Step

**Start Phase 2.** Separating the repository layer is the highest-leverage move right now — it unblocks clean testing, makes Phase 3 endpoints straightforward to add, and prevents the service from becoming a monolith.

Suggested first slice:
1. Create `src/repositories/urlRepository.ts` with `findByShortCode`, `create`, and `incrementClickCount`
2. Move SQL out of `URLService` into the repository
3. Add `src/infrastructure/cache.ts` Redis abstraction
4. Write unit tests for the repository
5. Add `.env.example`

---

## Working Notes

Use this file as the shared project compass. When a task is completed, mark it checked and add a short note if the decision changed the product or architecture.

| Phase | Status | Estimated Effort |
|-------|--------|-----------------|
| Phase 1 — MVP Hardening | ✅ Largely complete | — |
| Phase 2 — Persistence Boundary | 🔄 Up next | 1–2 days |
| Phase 3 — API v1 Completeness | ⏳ Pending | 2–3 days |
| Phase 4 — Security and Accounts | ⏳ Pending | 2–3 days |
| Phase 5 — Analytics Pipeline | ⏳ Pending | 3–4 days |
| Phase 6 — Performance Optimization | ⏳ Pending | 2–3 days |
| Phase 7 — Operational Readiness | ⏳ Pending | 2–3 days |
| Phase 8 — Database Sharding | ⏳ Advanced | 5–7 days |
