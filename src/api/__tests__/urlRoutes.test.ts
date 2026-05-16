import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../index';

const mocks = vi.hoisted(() => ({
  createUrl: vi.fn(),
  resolveRedirect: vi.fn(),
  checkHealth: vi.fn(),
}));

vi.mock('../../services/urlService', () => ({
  urlService: {
    createUrl: mocks.createUrl,
    resolveRedirect: mocks.resolveRedirect,
  },
}));

vi.mock('../../config/database', () => ({
  checkHealth: mocks.checkHealth,
}));

describe('URL routes', () => {
  beforeEach(() => {
    mocks.createUrl.mockReset();
    mocks.resolveRedirect.mockReset();
    mocks.checkHealth.mockResolvedValue({ postgres: true, redis: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a short URL from a valid payload', async () => {
    const app = buildApp();
    mocks.createUrl.mockResolvedValue({
      shortCode: 'custom1',
      shortUrl: 'http://localhost:3000/custom1',
      originalUrl: 'https://example.com',
      expiresAt: '2026-05-17T00:00:00.000Z',
      createdAt: '2026-05-16T00:00:00.000Z',
      qrCode: 'http://localhost:3000/qr/custom1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      payload: {
        url: 'https://example.com',
        custom_alias: 'custom1',
        expires_in: 3600,
      },
    });

    await app.close();

    expect(response.statusCode).toBe(201);
    expect(mocks.createUrl).toHaveBeenCalledWith({
      url: 'https://example.com',
      customAlias: 'custom1',
      expiresIn: 3600,
      password: undefined,
      utmSource: undefined,
    });
    expect(response.json()).toMatchObject({
      shortCode: 'custom1',
      originalUrl: 'https://example.com',
    });
  });

  it('rejects invalid URLs before calling the service', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      payload: { url: 'ftp://example.com/file' },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body failed validation',
      },
    });
  });

  it('rejects invalid custom aliases', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      payload: {
        url: 'https://example.com',
        customAlias: 'bad!',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(response.json().error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'customAlias' }),
      ])
    );
  });

  it('rejects invalid expiry values', async () => {
    const app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      payload: {
        url: 'https://example.com',
        expiresIn: 30,
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(mocks.createUrl).not.toHaveBeenCalled();
    expect(response.json().error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'expiresIn' }),
      ])
    );
  });

  it('returns conflict when a custom alias is already taken', async () => {
    const app = buildApp();
    mocks.createUrl.mockRejectedValue(new Error('Custom alias already taken'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/urls',
      payload: {
        url: 'https://example.com',
        customAlias: 'custom1',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Custom alias already taken',
      },
    });
  });

  it('uses the standard error shape for missing redirects', async () => {
    const app = buildApp();
    mocks.resolveRedirect.mockResolvedValue({ status: 'not_found' });

    const response = await app.inject({
      method: 'GET',
      url: '/missing1',
    });

    await app.close();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Short URL not found',
      },
    });
  });

  it('returns gone for expired redirects', async () => {
    const app = buildApp();
    mocks.resolveRedirect.mockResolvedValue({ status: 'expired' });

    const response = await app.inject({
      method: 'GET',
      url: '/expired1',
    });

    await app.close();

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({
      error: {
        code: 'URL_EXPIRED',
        message: 'Short URL has expired',
      },
    });
  });
});
