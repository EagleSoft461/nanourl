# NanoURL

[![CI/CD](https://github.com/EagleSoft461/nanourl/actions/workflows/ci.yml/badge.svg)](https://github.com/EagleSoft461/nanourl/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Node](https://img.shields.io/badge/Node.js-20-green?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A production-ready, distributed URL shortener built for high throughput. Handles redirect resolution through a 3-layer cache hierarchy targeting P99 < 10ms.

---

## Features

- **Full REST API** — create, resolve, update, delete, list, analytics, QR code
- **JWT authentication** — RS256, 1h access token + 30d refresh token
- **3-layer cache** — in-process LRU → Redis → PostgreSQL
- **Bloom filter** — eliminates DB lookups for non-existent short codes
- **Kafka pipeline** — async event emission for analytics (fire-and-forget)
- **Rate limiting** — anonymous and authenticated tiers
- **SSRF protection** — blocks private IPs, localhost, AWS metadata endpoint
- **Prometheus metrics** — HTTP latency histograms, cache hit/miss counters
- **Consistent hashing** — shard router ready, feature-flagged off by default
- **CI/CD** — GitHub Actions: lint → test → Docker build with layer cache

---

## Architecture

```
                        ┌─────────────────────────────────┐
                        │           Fastify API            │
                        │                                  │
                        │  Auth ─── Rate Limit ─── SSRF   │
                        └──────────────┬──────────────────┘
                                       │
                        ┌──────────────▼──────────────────┐
                        │           URLService             │
                        │                                  │
                        │  L1 LRU ──► Redis ──► Postgres  │
                        │  (0.01ms)   (1-2ms)   (5-10ms)  │
                        │       ▲                          │
                        │  Bloom Filter                    │
                        │  (skip DB if definitely missing) │
                        └──────────────┬──────────────────┘
                                       │
                   ┌───────────────────┼───────────────────┐
                   │                   │                   │
          ┌────────▼───────┐  ┌────────▼───────┐  ┌───────▼────────┐
          │   PostgreSQL   │  │     Redis      │  │     Kafka      │
          │  (shardable)   │  │  L2 cache +    │  │  url.created   │
          │  range parttn  │  │  pub/sub inval │  │  url.accessed  │
          └────────────────┘  └────────────────┘  │  url.expired   │
                                                   └───────▼────────┘
                                                   ┌───────────────┐
                                                   │ Analytics     │
                                                   │ Worker        │
                                                   └───────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript 5.3 |
| Framework | Fastify 4 |
| Database | PostgreSQL 15 (range partitioned, shard-ready) |
| Cache L1 | In-process LRU (10K entries, 5min TTL) |
| Cache L2 | Redis 7 (pub/sub invalidation) |
| Queue | Apache Kafka (KafkaJS) |
| Auth | JWT RS256 (@fastify/jwt) |
| Metrics | Prometheus (prom-client) |
| Logging | Pino (structured JSON) |
| Validation | Zod |
| Testing | Vitest (93 tests) |
| CI/CD | GitHub Actions |
| Container | Docker (multi-stage, non-root) |
| Orchestration | Kubernetes (Deployment, Service, ConfigMap) |

---

## Quick Start

**Prerequisites:** Node.js 20+, Docker

```bash
# 1. Clone
git clone https://github.com/EagleSoft461/nanourl.git
cd nanourl

# 2. Environment
cp .env.example .env

# 3. Start infrastructure (PostgreSQL, Redis, Kafka)
docker-compose up -d

# 4. Install dependencies
npm install

# 5. Run migrations
npm run migrate

# 6. Start dev server
npm run dev
# Listening on http://localhost:3000
```

---

## API Reference

### Authentication

```http
Authorization: Bearer <access_token>
```

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/auth/register` | POST | — | Register a new user |
| `/auth/login` | POST | — | Get access + refresh tokens |
| `/auth/refresh` | POST | — | Rotate tokens |
| `/auth/logout` | POST | — | Revoke refresh token |
| `/api/v1/urls` | POST | Optional | Create short URL |
| `/api/v1/urls` | GET | — | List URLs (paginated) |
| `/api/v1/urls/:code` | GET | — | Resolve short code |
| `/api/v1/urls/:code/info` | GET | — | Full metadata |
| `/api/v1/urls/:code` | PATCH | Required | Update URL |
| `/api/v1/urls/:code` | DELETE | Required | Delete URL |
| `/api/v1/urls/:code/analytics` | GET | — | Click stats |
| `/api/v1/urls/:code/qr` | GET | — | QR code (PNG) |
| `/:shortCode` | GET | — | Redirect (301/410) |
| `/health` | GET | — | Health check |
| `/metrics` | GET | — | Prometheus metrics |

### Examples

```bash
# Create a short URL
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/very/long/path", "expires_in": 86400}'

# Response 201
{
  "data": {
    "short_code": "a3f9k2m",
    "short_url": "http://localhost:3000/a3f9k2m",
    "original_url": "https://example.com/very/long/path",
    "created_at": "2026-05-22T10:00:00.000Z",
    "expires_at": "2026-05-23T10:00:00.000Z",
    "qr_code_url": "http://localhost:3000/api/v1/urls/a3f9k2m/qr"
  }
}

# Redirect
curl -v http://localhost:3000/a3f9k2m
# HTTP/1.1 301 Moved Permanently
# Location: https://example.com/very/long/path

# Health check
curl http://localhost:3000/health
# {"status":"ok","postgres":true,"redis":true}
```

### Error format

All errors follow a consistent shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body failed validation",
    "details": [{ "field": "url", "issue": "Must be a valid URL" }]
  }
}
```

---

## Project Structure

```
nanourl/
├── src/
│   ├── api/
│   │   ├── handlers/        # Route handlers
│   │   ├── middleware/       # Auth, rate limit, request ID, URL safety
│   │   └── schemas/         # Zod validation schemas
│   ├── config/              # Database, JWT, logger setup
│   ├── domain/              # Entity types and interfaces
│   ├── generators/          # Snowflake ID + Base62 encoding
│   ├── infrastructure/
│   │   ├── cache/           # LRU cache, Bloom filter, Redis provider, warming
│   │   ├── events/          # Kafka event schemas
│   │   ├── kafka/           # KafkaJS producer abstraction
│   │   ├── metrics/         # Prometheus registry
│   │   └── sharding/        # Consistent hash ring, shard router
│   ├── repositories/        # Data access layer (Postgres, sharded Postgres)
│   ├── services/            # Business logic (URLService, AuthService)
│   └── workers/             # Analytics consumer
├── migrations/              # SQL migrations (001–004)
├── tests/
│   ├── benchmark/           # autocannon load test
│   └── integration/         # End-to-end tests
├── deployments/k8s/         # Kubernetes manifests
├── docs/                    # ADRs + API spec + runbooks
├── Dockerfile               # Multi-stage build
├── docker-compose.yml       # Full local stack
└── docker-compose.staging.yml  # Staging (VPS) stack
```

---

## Testing

```bash
# Unit + integration tests (93 tests)
npm test

# Load test (requires running server)
npm run benchmark
```

The test suite covers:
- URL service (create, resolve, expiry, cache fallback)
- Auth middleware (JWT validation, protected routes)
- Repository layer (SQL mapping, edge cases)
- Bloom filter and LRU cache
- Consistent hash ring and shard router
- Kafka event emission

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_USER` | `nanourl` | PostgreSQL user |
| `POSTGRES_PASSWORD` | — | PostgreSQL password |
| `POSTGRES_DB` | `nanourl` | Database name |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker list |
| `BASE_URL` | `http://localhost:3000` | Public base URL for short links |
| `JWT_PRIVATE_KEY` | — | RS256 private key (base64) |
| `JWT_PUBLIC_KEY` | — | RS256 public key (base64) |
| `ENABLE_SHARDING` | `false` | Enable consistent hash shard routing |

---

## Deployment

### Docker Compose (local / single VPS)

```bash
docker-compose up -d
```

### Kubernetes

```bash
kubectl apply -f deployments/k8s/configmap.yml
kubectl apply -f deployments/k8s/deployment.yml
kubectl apply -f deployments/k8s/service.yml
```

### CI/CD Pipeline

Every push to `main` or `dev` runs:

```
Lint & Type Check → Unit Tests → Docker Build (layer cache)
```

Merges to `main` additionally push the image to GitHub Container Registry.

---

## Documentation

| Document | Description |
|---|---|
| [`docs/API-SPEC-v1.md`](docs/API-SPEC-v1.md) | Full API specification |
| [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) | System architecture decisions |
| [`docs/ADR-002-database-sharding.md`](docs/ADR-002-database-sharding.md) | Sharding strategy |
| [`docs/ADR-003-caching-strategy.md`](docs/ADR-003-caching-strategy.md) | Cache hierarchy design |
| [`docs/runbook-shard-rebalancing.md`](docs/runbook-shard-rebalancing.md) | Shard rebalancing procedure |
| [`ROADMAP.md`](ROADMAP.md) | Phase-by-phase build history |

---

## License

MIT
