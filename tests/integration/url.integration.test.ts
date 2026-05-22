import request from 'supertest';
import { buildApp } from '../../src/index';
import { describe, test, beforeAll, afterAll, expect, vi } from 'vitest';

// Integration testleri gerçek DB/Redis bağlantısı gerektirdiğinden
// bu testler CI ortamında çalışmak üzere tasarlanmıştır.
// Yerel ortamda docker-compose up ile altyapıyı başlatın.

vi.mock('../../src/services/urlService', () => ({
  urlService: {
    createUrl: vi.fn().mockResolvedValue({
      shortCode: 'abc123',
      shortUrl: 'http://localhost:3000/abc123',
      originalUrl: 'https://google.com',
      expiresAt: null,
      createdAt: new Date().toISOString(),
      qrCode: 'http://localhost:3000/qr/abc123',
    }),
    resolveRedirect: vi.fn().mockResolvedValue({
      status: 'found',
      originalUrl: 'https://google.com',
    }),
  },
}));

vi.mock('../../src/config/database', () => ({
  checkHealth: vi.fn().mockResolvedValue({ postgres: true, redis: true }),
  pgPool: {},
  redis: {},
}));

describe('NanoURL Integration Tests', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('URL Creation', () => {
    test('should create a short URL successfully', async () => {
      const response = await request(app.server)
        .post('/api/v1/urls')
        .send({
          url: 'https://google.com',
          customAlias: 'abc123',
        });

      expect(response.status).toBe(201);
      expect(response.body).toBeDefined();
      expect(response.body.data.short_code).toBe('abc123');
    });
  });

  describe('URL Redirect', () => {
    test('should redirect to original URL', async () => {
      const response = await request(app.server).get('/abc123');

      expect(response.status).toBe(301);
      expect(response.headers.location).toBe('https://google.com');
    });
  });
});
