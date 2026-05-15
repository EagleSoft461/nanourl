# NanoURL - Distributed URL Shortener

[![Build Status](https://img.shields.io/github/actions/workflow/status/yourusername/nanourl/ci.yml?branch=main&style=flat-square)](https://github.com/yourusername/nanourl/actions)
[![Coverage](https://img.shields.io/codecov/c/github/yourusername/nanourl?style=flat-square)](https://codecov.io/gh/yourusername/nanourl)
[![License](https://img.shields.io/github/license/yourusername/nanourl?style=flat-square&color=blue)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-20+-green?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue?style=flat-square&logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-red?style=flat-square&logo=redis)](https://redis.io)
[![Kafka](https://img.shields.io/badge/Kafka-3.0+-black?style=flat-square&logo=apachekafka)](https://kafka.apache.org)

High-performance, scalable URL shortener built with Node.js, TypeScript, PostgreSQL, Redis, and Kafka.

## Architecture
Client -> CDN -> Load Balancer -> API Gateway -> [Write Service / Read Service]
|              |
PostgreSQL      Redis Cluster
(Sharded)       (Multi-layer)
|
Kafka -> ClickHouse (Analytics)
## Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Installation

```bash
# 1. Clone & install
git clone https://github.com/yourusername/nanourl.git
cd nanourl
npm install

# 2. Start infrastructure
docker-compose up -d

# 3. Run migrations
npm run migrate

# 4. Start dev server
npm run dev
```
# Project Structure

```bash
nanourl/
├── docs/                    # Architecture Decision Records (ADR)
├── src/
│   ├── config/              # Database & environment config
│   ├── domain/              # Entity types & interfaces
│   ├── services/            # Business logic
│   ├── repositories/        # Data access layer
│   ├── generators/          # Snowflake ID + Base62
│   ├── api/                 # HTTP handlers & middleware
│   ├── infrastructure/      # Kafka, ClickHouse, etc.
│   └── workers/             # Background jobs (cleanup)
├── migrations/              # Database migrations
├── deployments/             # K8s manifests & Helm charts
└── tests/                   # Integration & benchmark tests
```
# Tech Stack
Layer	Technology
Runtime	Node.js 20 + TypeScript
Framework	Fastify
Database	PostgreSQL 15 (Sharded)
Cache	Redis Cluster
Queue	Apache Kafka
Analytics	ClickHouse
Monitoring	Prometheus + Grafana
Deployment	Kubernetes + Helm

## Quick Test

```bash
# Health check
curl http://localhost:3000/health
# {"status":"ok","postgres":true,"redis":true}

# Create short URL
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
# {"shortCode":"nafi1cUNP2","shortUrl":"http://localhost:3000/nafi1cUNP2"}

# Redirect
curl -v http://localhost:3000/nafi1cUNP2
# 301 -&gt; https://example.com
```

# Documentation

- Architecture Decision Records
- API Specification
- Deployment Guide

# Testing
 ```bash
 # Unit tests
npm test

# Load testing
npm run benchmark
 ```

# License
MIT