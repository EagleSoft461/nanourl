import Fastify from 'fastify';
import { createUrlHandler } from './api/handlers/urlHandler';
import { redirectHandler } from './api/handlers/redirectHandler';
import {
  listUrlsHandler,
  resolveUrlHandler,
  getUrlInfoHandler,
  updateUrlHandler,
  deleteUrlHandler,
  getAnalyticsHandler,
  getQrCodeHandler,
} from './api/handlers/urlManagementHandler';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
} from './api/handlers/authHandler';
import { requireAuth } from './api/middleware/auth';
import { registerRateLimit } from './api/middleware/rateLimiter';
import { registerRequestId } from './api/middleware/requestId';
import { checkHealth } from './config/database';

const PORT = parseInt(process.env.PORT || '3000', 10);

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  // ── Middleware ────────────────────────────────────────────────────────────
  // Request ID — her isteğe benzersiz ID atar, X-Request-ID header'ı ekler
  registerRequestId(app);

  // Rate limiting — Redis'te sayaç tutar, limit aşılınca 429 döner
  // Test ortamında devre dışı — testler rate limit'e takılmasın
  if (process.env.NODE_ENV !== 'test') {
    registerRateLimit(app);
  }

  // ── Sağlık kontrolü ──────────────────────────────────────────────────────
  app.get('/health', async (_, reply) => {
    const health = await checkHealth();
    return reply.send({ status: 'ok', ...health });
  });

  // ── Auth endpoint'leri ───────────────────────────────────────────────────
  app.post('/auth/register', registerHandler);
  app.post('/auth/login', loginHandler);
  app.post('/auth/refresh', refreshHandler);
  app.post('/auth/logout', logoutHandler);

  // ── URL API ──────────────────────────────────────────────────────────────
  // Spesifik route'lar genel olanlardan ÖNCE tanımlanmalı.

  app.post('/api/v1/urls', createUrlHandler);
  app.get('/api/v1/urls', listUrlsHandler);
  app.get('/api/v1/urls/:shortCode', resolveUrlHandler);
  app.get('/api/v1/urls/:shortCode/info', getUrlInfoHandler);
  app.get('/api/v1/urls/:shortCode/analytics', getAnalyticsHandler);
  app.get('/api/v1/urls/:shortCode/qr', getQrCodeHandler);

  // PATCH ve DELETE — auth zorunlu (preHandler ile)
  // Neden preHandler? Route çalışmadan önce token kontrolü yapar.
  // Token geçersizse handler hiç çalışmaz.
  // as any: preHandler eklenince Fastify'ın tip çıkarımı bozuluyor,
  // handler'ın kendi generic tipi zaten doğru — cast güvenli.
  app.patch('/api/v1/urls/:shortCode', { preHandler: requireAuth }, updateUrlHandler as any);
  app.delete('/api/v1/urls/:shortCode', { preHandler: requireAuth }, deleteUrlHandler as any);

  // ── Redirect (root level) ────────────────────────────────────────────────
  app.get('/:shortCode', redirectHandler);

  return app;
}

async function start() {
  const app = buildApp();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log('Server running on http://localhost:' + PORT);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}
