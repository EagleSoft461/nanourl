import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../index';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  verifyAccessToken: vi.fn(),
  checkHealth: vi.fn(),
}));

vi.mock('../../services/authService', () => ({
  authService: {
    register: mocks.register,
    login: mocks.login,
    refresh: mocks.refresh,
    logout: mocks.logout,
    verifyAccessToken: mocks.verifyAccessToken,
  },
}));

vi.mock('../../config/database', () => ({
  checkHealth: mocks.checkHealth,
  pgPool: {},
  redis: { on: vi.fn() },
}));

vi.mock('../../services/urlService', () => ({
  urlService: {
    createUrl: vi.fn(),
    resolveRedirect: vi.fn(),
    getInfo: vi.fn(),
    updateUrl: vi.fn(),
    deleteUrl: vi.fn(),
    listUrls: vi.fn(),
  },
}));

vi.mock('qrcode', () => ({
  default: { toBuffer: vi.fn().mockResolvedValue(Buffer.from('')) },
}));

describe('Auth routes', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.checkHealth.mockResolvedValue({ postgres: true, redis: true });
  });

  afterEach(() => { vi.clearAllMocks(); });

  // ── POST /auth/register ───────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('creates a new user and returns 201', async () => {
      const app = buildApp();
      mocks.register.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        createdAt: new Date('2026-01-01'),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'password123' },
      });
      await app.close();

      expect(res.statusCode).toBe(201);
      expect(res.json().data.email).toBe('test@example.com');
    });

    it('returns 409 when email is already taken', async () => {
      const app = buildApp();
      mocks.register.mockRejectedValue(new Error('EMAIL_ALREADY_EXISTS'));

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'taken@example.com', password: 'password123' },
      });
      await app.close();

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('CONFLICT');
    });

    it('returns 400 for invalid email', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'not-an-email', password: 'password123' },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(mocks.register).not.toHaveBeenCalled();
    });

    it('returns 400 for short password', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: 'test@example.com', password: 'short' },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /auth/login ──────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('returns tokens on valid credentials', async () => {
      const app = buildApp();
      mocks.login.mockResolvedValue({
        accessToken: 'access.token.here',
        refreshToken: 'refresh-token-here',
        expiresIn: 3600,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'password123' },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        access_token: 'access.token.here',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });

    it('returns 401 for invalid credentials', async () => {
      const app = buildApp();
      mocks.login.mockRejectedValue(new Error('INVALID_CREDENTIALS'));

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@example.com', password: 'wrongpassword' },
      });
      await app.close();

      expect(res.statusCode).toBe(401);
      // Güvenlik: "email yok" veya "şifre yanlış" denmemeli
      expect(res.json().error.message).toBe('Invalid email or password');
    });
  });

  // ── Auth middleware ───────────────────────────────────────────────────────

  describe('requireAuth middleware', () => {
    it('returns 401 when no token is provided on protected routes', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/urls/abc123',
      });
      await app.close();

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 for an invalid token', async () => {
      const app = buildApp();
      mocks.verifyAccessToken.mockImplementation(() => {
        throw new Error('INVALID_ACCESS_TOKEN');
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/urls/abc123',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });

    it('allows access with a valid token', async () => {
      const app = buildApp();
      mocks.verifyAccessToken.mockReturnValue({ sub: 'user-1', email: 'test@example.com' });

      // getInfo mock — deleteUrlHandler önce var mı kontrol eder
      const { urlService } = await import('../../services/urlService');
      vi.mocked(urlService.getInfo).mockResolvedValue({
        id: '1', shortCode: 'abc123', originalUrl: 'https://example.com',
        clickCount: 0, createdAt: new Date(), expiresAt: null,
      });
      vi.mocked(urlService.deleteUrl).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/urls/abc123',
        headers: { authorization: 'Bearer valid.token.here' },
      });
      await app.close();

      expect(res.statusCode).toBe(204);
    });
  });

  // ── URL Safety ────────────────────────────────────────────────────────────

  describe('URL safety checks on POST /api/v1/urls', () => {
    it('rejects localhost URLs', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        payload: { url: 'http://localhost/admin' },
      });
      await app.close();

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('UNPROCESSABLE');
    });

    it('rejects private IP addresses', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        payload: { url: 'http://192.168.1.1/router' },
      });
      await app.close();

      expect(res.statusCode).toBe(422);
    });

    it('rejects AWS metadata endpoint', async () => {
      const app = buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/urls',
        payload: { url: 'http://169.254.169.254/latest/meta-data/' },
      });
      await app.close();

      expect(res.statusCode).toBe(422);
    });
  });
});
