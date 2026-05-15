# NanoURL API Specification — v1.0

| Field    | Value                     |
|----------|---------------------------|
| Version  | 1.0.0                     |
| Status   | **Stable**                |
| Updated  | 2026-05-14                |
| Base URL | `https://api.nanourl.io`  |

---

## Table of Contents

1. [Environments](#environments)
2. [Authentication](#authentication)
3. [Rate Limiting](#rate-limiting)
4. [Error Format](#error-format)
5. [Endpoints](#endpoints)
   - [Create Short URL](#post-apiv1urls)
   - [Resolve Short URL](#get-apiv1urlsshort_code)
   - [Get URL Details](#get-apiv1urlsshort_codeinfo)
   - [Update URL](#patch-apiv1urlsshort_code)
   - [Delete URL](#delete-apiv1urlsshort_code)
   - [List User URLs](#get-apiv1urls)
   - [Get URL Analytics](#get-apiv1urlsshort_codeanalytics)
6. [Redirect Endpoint](#redirect-endpoint)

---

## Environments

| Environment | Base URL                    |
|-------------|-----------------------------|
| Development | `http://localhost:3000`     |
| Staging     | `https://staging.nanourl.io`|
| Production  | `https://api.nanourl.io`    |

---

## Authentication

Authentication is optional. Unauthenticated requests are accepted but subject to stricter rate limits and cannot access user-scoped resources.

```http
Authorization: Bearer <jwt_token>
```

JWTs are signed with RS256. Tokens expire after **1 hour**. Refresh tokens are valid for **30 days**.

---

## Rate Limiting

Rate limit headers are included on every response:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1716681600
```

| Tier        | URL Creations     | Redirects       |
|-------------|-------------------|-----------------|
| Anonymous   | 10 / minute       | Unlimited        |
| Free        | 100 / day         | Unlimited        |
| Pro         | 10,000 / day      | Unlimited        |
| Enterprise  | Unlimited         | Unlimited        |

When a rate limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header.

---

## Error Format

All errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The provided URL is not valid.",
    "details": [
      {
        "field": "url",
        "issue": "Must be a valid HTTP or HTTPS URL."
      }
    ],
    "request_id": "req_01hwz3k9p4fgx7v2"
  }
}
```

### Error Codes

| HTTP Status | Code                  | Description                                      |
|-------------|-----------------------|--------------------------------------------------|
| 400         | `VALIDATION_ERROR`    | Request body or parameters failed validation     |
| 401         | `UNAUTHORIZED`        | Missing or invalid authentication token          |
| 403         | `FORBIDDEN`           | Authenticated but not authorised for this action |
| 404         | `NOT_FOUND`           | Short code does not exist                        |
| 409         | `CONFLICT`            | Custom alias is already taken                    |
| 410         | `URL_EXPIRED`         | Short URL has passed its expiry date             |
| 422         | `UNPROCESSABLE`       | Semantically invalid request                     |
| 429         | `RATE_LIMIT_EXCEEDED` | Too many requests                                |
| 500         | `INTERNAL_ERROR`      | Unexpected server error                          |

---

## Endpoints

---

### `POST /api/v1/urls`

Create a new short URL.

**Authentication:** Optional

#### Request

```http
POST /api/v1/urls
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{
  "url": "https://example.com/very/long/path?with=parameters&and=more",
  "custom_alias": "my-brand",
  "expires_in": 86400,
  "password": null,
  "utm_source": "twitter",
  "utm_medium": "social",
  "utm_campaign": "launch-2026"
}
```

| Field           | Type      | Required | Constraints                          | Description                          |
|-----------------|-----------|----------|--------------------------------------|--------------------------------------|
| `url`           | `string`  | Yes      | Valid HTTP/HTTPS URL, max 2048 chars | The destination URL to shorten       |
| `custom_alias`  | `string`  | No       | 6–20 chars, `[a-zA-Z0-9-_]`         | Custom short code (must be unique)   |
| `expires_in`    | `integer` | No       | Seconds; min 60, max 31536000 (1yr)  | TTL from creation time               |
| `password`      | `string`  | No       | 8–72 chars                           | Password-protect the redirect        |
| `utm_source`    | `string`  | No       | Max 100 chars                        | UTM tracking parameter               |
| `utm_medium`    | `string`  | No       | Max 100 chars                        | UTM tracking parameter               |
| `utm_campaign`  | `string`  | No       | Max 100 chars                        | UTM tracking parameter               |

#### Response — `201 Created`

```json
{
  "data": {
    "short_code": "a3f9k2m",
    "short_url": "https://nanourl.io/a3f9k2m",
    "original_url": "https://example.com/very/long/path?with=parameters&and=more",
    "created_at": "2026-05-14T10:30:00Z",
    "expires_at": "2026-05-15T10:30:00Z",
    "is_password_protected": false,
    "qr_code_url": "https://api.nanourl.io/api/v1/urls/a3f9k2m/qr"
  }
}
```

---

### `GET /api/v1/urls/:short_code`

Resolve a short code to its original URL. This is the high-throughput redirect resolution endpoint — not the HTTP redirect itself (see [Redirect Endpoint](#redirect-endpoint)).

**Authentication:** Not required

#### Request

```http
GET /api/v1/urls/a3f9k2m
```

#### Response — `200 OK`

```json
{
  "data": {
    "original_url": "https://example.com/very/long/path?with=parameters&and=more",
    "expires_at": "2026-05-15T10:30:00Z"
  }
}
```

---

### `GET /api/v1/urls/:short_code/info`

Retrieve full metadata for a short URL. Requires ownership or admin role.

**Authentication:** Required

#### Response — `200 OK`

```json
{
  "data": {
    "short_code": "a3f9k2m",
    "short_url": "https://nanourl.io/a3f9k2m",
    "original_url": "https://example.com/very/long/path?with=parameters&and=more",
    "created_at": "2026-05-14T10:30:00Z",
    "expires_at": "2026-05-15T10:30:00Z",
    "click_count": 1482,
    "is_password_protected": false,
    "user_id": "usr_01hwz3k9p4fgx7v2",
    "utm": {
      "source": "twitter",
      "medium": "social",
      "campaign": "launch-2026"
    }
  }
}
```

---

### `PATCH /api/v1/urls/:short_code`

Update a short URL's destination or settings. Only the owner may update a URL.

**Authentication:** Required

#### Request

```json
{
  "url": "https://example.com/updated-destination",
  "expires_in": 172800,
  "password": "new-secret"
}
```

All fields are optional. Only provided fields are updated.

#### Response — `200 OK`

Returns the updated URL object (same shape as the `info` response).

---

### `DELETE /api/v1/urls/:short_code`

Permanently delete a short URL. This action is irreversible.

**Authentication:** Required (owner or admin)

#### Response — `204 No Content`

No response body.

---

### `GET /api/v1/urls`

List all short URLs belonging to the authenticated user.

**Authentication:** Required

#### Query Parameters

| Parameter   | Type      | Default | Description                                      |
|-------------|-----------|---------|--------------------------------------------------|
| `page`      | `integer` | `1`     | Page number (1-indexed)                          |
| `page_size` | `integer` | `20`    | Results per page (max 100)                       |
| `sort`      | `string`  | `created_at` | Sort field: `created_at`, `click_count`   |
| `order`     | `string`  | `desc`  | Sort direction: `asc`, `desc`                    |
| `search`    | `string`  | —       | Filter by original URL or alias (partial match)  |

#### Response — `200 OK`

```json
{
  "data": [
    {
      "short_code": "a3f9k2m",
      "short_url": "https://nanourl.io/a3f9k2m",
      "original_url": "https://example.com/...",
      "created_at": "2026-05-14T10:30:00Z",
      "click_count": 1482
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 143,
    "total_pages": 8
  }
}
```

---

### `GET /api/v1/urls/:short_code/analytics`

Retrieve click analytics for a short URL.

**Authentication:** Required (owner or admin)

#### Query Parameters

| Parameter  | Type     | Default    | Description                                  |
|------------|----------|------------|----------------------------------------------|
| `from`     | `string` | 30 days ago | ISO 8601 datetime (inclusive)               |
| `to`       | `string` | now        | ISO 8601 datetime (inclusive)                |
| `granularity` | `string` | `day`   | Aggregation: `hour`, `day`, `week`, `month`  |

#### Response — `200 OK`

```json
{
  "data": {
    "short_code": "a3f9k2m",
    "total_clicks": 14820,
    "unique_clicks": 9341,
    "series": [
      { "timestamp": "2026-05-13T00:00:00Z", "clicks": 482, "unique_clicks": 301 },
      { "timestamp": "2026-05-14T00:00:00Z", "clicks": 1000, "unique_clicks": 640 }
    ],
    "top_referrers": [
      { "referrer": "twitter.com", "clicks": 6200 },
      { "referrer": "direct", "clicks": 4100 }
    ],
    "top_countries": [
      { "country_code": "US", "clicks": 5400 },
      { "country_code": "DE", "clicks": 2100 }
    ],
    "devices": {
      "mobile": 8200,
      "desktop": 5900,
      "tablet": 720
    }
  }
}
```

---

## Redirect Endpoint

The redirect endpoint is served at the root domain and is optimised for maximum throughput. It is separate from the API domain.

```http
GET https://nanourl.io/:short_code
```

### Behaviour

1. Resolves the short code through the cache hierarchy (L1 → L2 → L3 → DB)
2. Returns `301 Moved Permanently` for permanent URLs (CDN-cacheable)
3. Returns `302 Found` for URLs with an expiry date (not cached by CDN)
4. Returns `404 Not Found` if the code does not exist
5. Returns `410 Gone` if the URL has expired
6. Returns `401 Unauthorized` if the URL is password-protected and no password is provided

### Password-Protected URLs

```http
GET https://nanourl.io/a3f9k2m
X-URL-Password: my-secret
```

If the password is incorrect, the response is `401 Unauthorized`.

### Response Headers

```http
HTTP/1.1 301 Moved Permanently
Location: https://example.com/very/long/path?with=parameters
Cache-Control: public, max-age=86400
X-Cache: HIT
X-Cache-Layer: L1
X-Request-ID: req_01hwz3k9p4fgx7v2
```
