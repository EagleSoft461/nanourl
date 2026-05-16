# NanoURL Roadmap

Last updated: 2026-05-16

## Current Status

NanoURL is currently an early MVP for a distributed URL shortener.

Working today:
- Fastify API server
- `POST /api/v1/urls` short URL creation
- `GET /:shortCode` redirect flow
- PostgreSQL persistence
- Redis read cache
- Snowflake-style ID generation with Base62 short codes
- Initial database migration
- Architecture/API documentation drafts
- Unit tests for the Snowflake generator

Verified:
- `npm test -- --run` passes
- `npx tsc --noEmit` passes

Known gaps:
- Request validation is not implemented yet
- Error response shape does not match `docs/API-SPEC-v1.md`
- API spec uses snake_case fields, code currently uses camelCase
- `qrCode` is returned in create response, but `/qr/:shortCode` is not implemented
- README mentions repositories, workers, Kafka, ClickHouse, Kubernetes, and benchmark scripts that are not implemented yet
- Redirect currently returns `404` for expired URLs instead of a distinct `410`
- Redis cache does not store expiry metadata, so expired URLs can be partially misrepresented from cache
- No integration tests for API, database, or Redis flows yet

## Guiding Goal

Build NanoURL from a clean MVP into a reliable, production-ready URL shortener in small, verifiable steps. Each phase should leave the project runnable, tested, and documented.

## Phase 1 - MVP Hardening

Goal: make the current core API correct, predictable, and testable.

- [x] Add request validation with Zod for create URL payloads
- [ ] Align request/response field naming with API spec or update the spec to match code
- [x] Standardize error responses across handlers
- [x] Validate custom aliases for length and allowed characters
- [x] Validate `expiresIn` min/max limits
- [x] Return `410 Gone` for expired short URLs
- [x] Avoid serving expired URLs from Redis cache
- [x] Add Fastify integration tests for create and redirect flows
- [x] Add service tests for expiry, custom aliases, and cache fallback
- [ ] Add `.env.example`

## Phase 2 - Persistence Boundary

Goal: separate business logic from storage and make the code easier to extend.

- [ ] Add `src/repositories/urlRepository.ts`
- [ ] Move direct SQL calls out of `URLService`
- [ ] Add a Redis cache abstraction for URL lookups
- [ ] Make URL creation handle generated short-code collisions defensively
- [ ] Add migration tracking or document the current migration workflow
- [ ] Add indexes needed for user-scoped listing and analytics queries

## Phase 3 - API v1 Completeness

Goal: implement the documented v1 API surface, or explicitly trim the spec.

- [ ] `GET /api/v1/urls/:shortCode` resolve endpoint
- [ ] `GET /api/v1/urls/:shortCode/info`
- [ ] `PATCH /api/v1/urls/:shortCode`
- [ ] `DELETE /api/v1/urls/:shortCode`
- [ ] `GET /api/v1/urls` list endpoint with pagination
- [ ] `GET /api/v1/urls/:shortCode/analytics`
- [ ] `GET /api/v1/urls/:shortCode/qr` or remove QR URL from create response
- [ ] Add OpenAPI spec generation or keep `docs/API-SPEC-v1.md` manually synced

## Phase 4 - Abuse Protection And Accounts

Goal: make public URL creation safer.

- [ ] Enable `@fastify/rate-limit`
- [ ] Add anonymous and authenticated rate-limit tiers
- [ ] Add request IDs and structured logs
- [ ] Add optional JWT authentication
- [ ] Add user ownership for URLs
- [ ] Add password-protected redirects if still part of the product scope
- [ ] Add URL safety checks for unsupported protocols and obvious local/private network targets

## Phase 5 - Analytics Pipeline

Goal: collect redirect events without slowing down redirects.

- [ ] Emit redirect events asynchronously
- [ ] Add Kafka producer abstraction
- [ ] Add click event schema
- [ ] Add analytics worker
- [ ] Decide whether ClickHouse is required now or later
- [ ] Implement aggregate analytics endpoint
- [ ] Add integration tests around event emission boundaries

## Phase 6 - Operations

Goal: make the app easy to run and deploy.

- [ ] Add Dockerfile
- [ ] Confirm `docker-compose.yml` starts all local dependencies cleanly
- [ ] Add health checks for API, Postgres, and Redis
- [ ] Add CI workflow for tests and type checks
- [ ] Add deployment manifests only after the runtime shape is stable
- [ ] Add basic observability: logs, metrics endpoint, and latency counters
- [ ] Add benchmark/load test script or remove README benchmark mention

## Next Recommended Step

Start with Phase 1. The highest-value first task is request validation plus standardized errors, because it stabilizes the public API before more features are added.

Suggested first implementation slice:
- Add Zod schemas for create URL input
- Return `400 VALIDATION_ERROR` for invalid payloads
- Normalize create response field names
- Add integration tests for valid URL, invalid URL, invalid alias, and duplicate alias

## Working Notes

Use this file as the shared project compass. When a task is completed, mark it checked and add a short note if the decision changed the product or architecture.
