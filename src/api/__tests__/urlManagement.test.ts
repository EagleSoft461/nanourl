import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../index';

const mocks = vi.hoisted(() => ({
  createUrl: vi.fn(),
  resolveRedirect: vi.fn(),
  getInfo: vi.fn(),
  updateUrl: vi.fn(),
  deleteUrl: vi.fn(),
  listUrls: vi.fn(),
  checkHealth: vi.fn(),
  qrToBuffer: vi.fn(),
}));

vi.mock('../../services/urlService', () => ({
  urlService: {
    createUrl: mocks.createUrl,
    resolveRedirect: mocks.resolveRedirect,
    getInfo: mocks.getInfo,
    updateUrl: mocks.updateUrl,
    deleteUrl: mocks.deleteUrl,
    listUrls: mocks.listUrls,
  },
}));

vi.mock('../../config/database', () => ({
  checkHealth: mocks.checkHealth,
  pgPool: {},
  redis: { on: vi.fn() },
}));

// qrcode kütüphanesini mock'la — gerçek PNG üretmeye gerek yok
vi.mock('qrcode', () => ({
  default: { toBuffer: mocks.qrToBuffer },
}));

const BASE_RECORD = {
  id: '1',
  shortCode: 'abc123',
  originalUrl: 'https://example.com',
  clickCount: 5,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  userId: null,
};

describe('URL Management routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.checkHealth.mockResolvedValue({ postgres: true, redis: true });
    mocks.qrToBuffer.mockResolvedValue(Buffer.from('fake-png'));
  });

  afterEach(() => vi.clearAllMocks());

  // ── GET /api/v1/urls ──────────────────────────────────────────────────────

  describe('GET /api/v1/urls', () => {
    it('returns a paginated list of URLs', async () => {
      const app = buildApp();
      mocks.listUrls.mockResolvedValue({
        data: [BASE_RECORD],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls' });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        pagination: { page: 1, totalItems: 1 },
      });
      expect(mocks.listUrls).toHaveBeenCalledWith({
        page: 1, pageSize: 20, sort: undefined, order: undefined, search: undefined,
      });
    });

    it('passes query string params to the service', async () => {
      const app = buildApp();
      mocks.listUrls.mockResolvedValue({
        data: [],
        pagination: { page: 2, pageSize: 5, totalItems: 0, totalPages: 0 },
      });

      await app.inject({
        method: 'GET',
        url: '/api/v1/urls?page=2&page_size=5&sort=click_count&order=asc&search=example',
      });
      await app.close();

      expect(mocks.listUrls).toHaveBeenCalledWith({
        page: 2, pageSize: 5, sort: 'click_count', order: 'asc', search: 'example',
      });
    });
  });

  // ── GET /api/v1/urls/:shortCode ───────────────────────────────────────────

  describe('GET /api/v1/urls/:shortCode', () => {
    it('returns original_url and expires_at for an existing URL', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(BASE_RECORD);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/abc123' });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: { original_url: 'https://example.com', expires_at: null },
      });
    });

    it('returns 404 for a missing short code', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/missing1' });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  // ── GET /api/v1/urls/:shortCode/info ─────────────────────────────────────

  describe('GET /api/v1/urls/:shortCode/info', () => {
    it('returns full metadata for an existing URL', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(BASE_RECORD);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/abc123/info' });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        short_code: 'abc123',
        original_url: 'https://example.com',
        click_count: 5,
      });
    });
  });

  // ── PATCH /api/v1/urls/:shortCode ─────────────────────────────────────────

  describe('PATCH /api/v1/urls/:shortCode', () => {
    it('updates the URL and returns the updated record', async () => {
      const app = buildApp();
      const updated = { ...BASE_RECORD, originalUrl: 'https://updated.com' };
      mocks.updateUrl.mockResolvedValue(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/urls/abc123',
        payload: { url: 'https://updated.com' },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().data.original_url).toBe('https://updated.com');
    });

    it('returns 400 for an invalid URL in the body', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/urls/abc123',
        payload: { url: 'not-a-url' },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when the short code does not exist', async () => {
      const app = buildApp();
      mocks.updateUrl.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/urls/missing1',
        payload: { url: 'https://example.com' },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/v1/urls/:shortCode ────────────────────────────────────────

  describe('DELETE /api/v1/urls/:shortCode', () => {
    it('deletes an existing URL and returns 204', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(BASE_RECORD);
      mocks.deleteUrl.mockResolvedValue(undefined);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/urls/abc123' });
      await app.close();

      expect(res.statusCode).toBe(204);
      expect(mocks.deleteUrl).toHaveBeenCalledWith('abc123');
    });

    it('returns 404 when the short code does not exist', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: '/api/v1/urls/missing1' });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(mocks.deleteUrl).not.toHaveBeenCalled();
    });
  });

  // ── GET /api/v1/urls/:shortCode/analytics ─────────────────────────────────

  describe('GET /api/v1/urls/:shortCode/analytics', () => {
    it('returns click stats for an existing URL', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue({ ...BASE_RECORD, clickCount: 42 });

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/abc123/analytics' });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        data: {
          short_code: 'abc123',
          total_clicks: 42,
        },
      });
    });

    it('returns 404 for a missing short code', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/missing1/analytics' });
      await app.close();

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /api/v1/urls/:shortCode/qr ────────────────────────────────────────

  describe('GET /api/v1/urls/:shortCode/qr', () => {
    it('returns a PNG buffer with correct Content-Type', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(BASE_RECORD);
      const fakeBuffer = Buffer.from('fake-png-data');
      mocks.qrToBuffer.mockResolvedValue(fakeBuffer);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/abc123/qr' });
      await app.close();

      expect(res.statusCode).toBe(200);
      // Content-Type image/png olmalı — JSON değil
      expect(res.headers['content-type']).toContain('image/png');
      // QR kütüphanesi short URL ile çağrılmalı
      expect(mocks.qrToBuffer).toHaveBeenCalledWith(
        expect.stringContaining('abc123'),
        expect.any(Object)
      );
    });

    it('returns 404 for a missing short code', async () => {
      const app = buildApp();
      mocks.getInfo.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/api/v1/urls/missing1/qr' });
      await app.close();

      expect(res.statusCode).toBe(404);
      expect(mocks.qrToBuffer).not.toHaveBeenCalled();
    });
  });
});
