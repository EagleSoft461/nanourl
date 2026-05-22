# NanoURL Roadmap

Last updated: 2026-05-22

---

## Current Status

NanoURL is a production-ready distributed URL shortener.

**Working today:**
- Fastify HTTP server with full v1 API surface
- `POST /api/v1/urls` — short URL creation (snake_case responses per spec)
- `GET /:shortCode` — redirect flow (301/410)
- `GET|PATCH|DELETE /api/v1/urls/:shortCode` — resolve, update, delete
- `GET /api/v1/urls` — paginated list with sort and search
- `GET /api/v1/urls/:shortCode/analytics` — click analytics
- `GET /api/v1/urls/:shortCode/qr` — QR code (PNG)
- PostgreSQL persistence with repository pattern
- Redis L2 cache + in-process LRU L1 cache + Bloom filter
- Cache warming on startup, cross-node invalidation via Redis pub/sub
- Snowflake ID + Base62 short code generation
- JWT authentication (RS256, 1h access + 30d refresh tokens)
- Rate limiting (anonymous / authenticated tiers)
- URL safety checks (SSRF, private IPs, AWS metadata endpoint)
- Kafka analytics pipeline (`url.created` / `url.accessed` / `url.expired`)
- Prometheus metrics + structured pino logging
- Multi-stage Dockerfile, docker-compose full stack
- Kubernetes manifests (Deployment, Service, ConfigMap)
- GitHub Actions CI (type check + tests + Docker build)
- Consistent hashing shard router (feature-flagged, off by default)
- Range partitioning by `created_at`
- Load test script (`npm run benchmark`)

**Remaining optional items:**
- Helm chart
- Password-protected redirects
- OpenAPI spec generation
- P99 < 10ms redirect verification (run `npm run benchmark` against staging)

---

## Guiding Goal

Build NanoURL from a clean MVP into a reliable, production-ready service in small, verifiable steps. Each phase should leave the project runnable, tested, and documented.

---

## Phase 1 — MVP Hardening ✅ (Complete)

**Goal:** Make the current core API correct, predictable, and testable.

- [x] Zod validation for create URL request payloads
- [x] Standardized error responses across all handlers
- [x] Custom alias length and character validation
- [x] `expiresIn` min/max limit enforcement
- [x] `410 Gone` for expired short URLs
- [x] Prevent expired URLs from being served from Redis cache
- [x] Fastify integration tests for create and redirect flows
- [x] Service tests for expiry, custom aliases, and cache fallback
- [x] Add `.env.example`
- [x] Align response field naming with API spec (snake_case throughout)

---

## Phase 2 — Persistence Boundary ✅ (Complete)

**Goal:** Separate business logic from storage and make the codebase easier to extend.

- [x] Create `src/repositories/urlRepository.ts`
- [x] Move SQL queries out of `URLService` into the repository
- [x] Add a Redis cache abstraction at `src/infrastructure/cache/`
- [x] Add defensive retry logic for short code collisions on creation
- [x] Add migration tracking or document the current migration workflow
- [x] Add indexes needed for user-scoped listing and analytics queries
- [x] Unit tests for the repository layer

---

## Phase 3 — API v1 Completeness ✅ (Complete)

**Goal:** Implement the full documented v1 API surface, or explicitly trim the spec.

- [x] `GET /api/v1/urls/:shortCode` — resolve endpoint
- [x] `GET /api/v1/urls/:shortCode/info` — full URL metadata
- [x] `PATCH /api/v1/urls/:shortCode` — update URL
- [x] `DELETE /api/v1/urls/:shortCode` — delete URL
- [x] `GET /api/v1/urls` — paginated list (page, page_size, sort, search)
- [x] `GET /api/v1/urls/:shortCode/analytics` — basic analytics
- [x] `GET /api/v1/urls/:shortCode/qr` — QR code endpoint
- [ ] OpenAPI spec generation or keep `docs/API-SPEC-v1.md` manually synced

---

## Phase 4 — Security and Accounts ✅ (Complete)

**Goal:** Make public URL creation safer and add user ownership.

- [x] Enable `@fastify/rate-limit`
- [x] Anonymous and authenticated rate limit tiers (per API spec)
- [x] Request IDs and structured log format
- [x] JWT authentication (RS256, 1h access token + 30d refresh token)
- [x] User ownership tied to URLs
- [x] URL safety checks: unsupported protocols, local/private network targets
- [x] Tests for auth middleware
- [ ] Password-protected redirects (optional, depending on product scope)

---

## Phase 5 — Analytics Pipeline ✅ (Complete)

**Goal:** Collect redirect events without slowing down the redirect path.

- [x] Emit redirect events asynchronously
- [x] `src/infrastructure/kafka/kafkaProducer.ts` — Kafka producer abstraction
- [x] Define click event schema (`src/infrastructure/events/eventSchema.ts`)
- [x] `src/workers/analyticsWorker.ts` — analytics consumer
- [x] ClickHouse deferred — PostgreSQL sufficient for current scale
- [x] Analytics endpoint returns click_count (full breakdown in Phase 6)
- [x] Integration tests around event emission boundaries
- [x] `url.created`, `url.accessed`, `url.expired` Kafka topics

---

## Phase 6 — Performance Optimization ✅ (Complete)

**Goal:** Implement the cache hierarchy and Bloom filter defined in the architecture ADRs.

- [x] `src/infrastructure/cache/localCache.ts` — L1 in-process LRU cache (10K entries, 5 min TTL)
- [x] Bloom filter implementation (1M capacity, 0.01% false positive rate)
- [x] Cache warming — load top 10K URLs into Redis on startup
- [x] L1 cache invalidation via Redis pub/sub (cross-node)
- [x] Cache layer metrics (hit rate, miss rate) — `/metrics/cache` endpoint
- [x] Benchmark / load test script (`tests/benchmark/load-test.ts`)
- [ ] Verify P99 < 10ms target on the redirect path (run `npm run benchmark` against staging)

---

## Phase 7 — Operational Readiness ✅ (Complete)

**Goal:** Make the app easy to run, observe, and deploy.

- [x] `Dockerfile` (multi-stage build, non-root user, health check)
- [x] `docker-compose.yml` — full stack with health checks and depends_on
- [x] Health checks for API, PostgreSQL, and Redis
- [x] GitHub Actions CI workflow (tests + type check + Docker build)
- [x] Prometheus metrics endpoint (`/metrics`) with HTTP latency histograms
- [x] Structured logging via Fastify pino (JSON in production, pretty in dev)
- [x] Kubernetes manifests — Deployment, Service, ConfigMap, Secret
- [ ] Helm chart (optional, after K8s manifests)

---

## Phase 8 — Database Sharding ✅ (Complete)

**Goal:** Implement the sharding strategy defined in ADR-002.

> ⚠️ This phase should only be tackled when real traffic scale demands it. Premature sharding adds significant operational complexity.

- [x] Consistent hashing ring implementation
- [x] Shard routing layer (based on first 2 characters of short code)
- [x] 64 virtual shards → PostgreSQL instance mapping
- [x] Range partitioning by `created_at`
- [x] Shard rebalancing procedure documentation (`docs/runbook-shard-rebalancing.md`)
- [x] Cross-shard query strategy (fan-out via `Promise.all`, documented in runbook)

---

## Next Recommended Step

All planned phases are complete. The service is production-ready.

Next steps depend on real traffic data:
- Run `npm run benchmark` against staging to verify P99 < 10ms on the redirect path
- Enable sharding (`ENABLE_SHARDING=true`) only when a single PostgreSQL instance becomes the bottleneck
- Add a Helm chart if deploying to multiple environments

---

## Working Notes

Use this file as the shared project compass. When a task is completed, mark it checked and add a short note if the decision changed the product or architecture.

| Phase | Status | Estimated Effort |
|-------|--------|-----------------|
| Phase 1 — MVP Hardening | ✅ Complete | — |
| Phase 2 — Persistence Boundary | ✅ Complete | — |
| Phase 3 — API v1 Completeness | ✅ Complete | — |
| Phase 4 — Security and Accounts | ✅ Complete | — |
| Phase 5 — Analytics Pipeline | ✅ Complete | — |
| Phase 6 — Performance Optimization | ✅ Complete | — |
| Phase 7 — Operational Readiness | ✅ Complete | — |
| Phase 8 — Database Sharding | ✅ Complete | — |
