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
import { checkHealth } from './config/database';

const PORT = parseInt(process.env.PORT || '3000', 10);

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  // ── Sağlık kontrolü ──────────────────────────────────────────────────────
  app.get('/health', async (_, reply) => {
    const health = await checkHealth();
    return reply.send({ status: 'ok', ...health });
  });

  // ── URL API ──────────────────────────────────────────────────────────────
  // Dikkat: spesifik route'lar genel olanlardan ÖNCE tanımlanmalı.
  // Fastify route'ları tanımlanma sırasına göre eşleştirir.
  // Örnek: /api/v1/urls/abc123/info, /api/v1/urls/:shortCode/info ile eşleşmeli,
  //        /api/v1/urls/:shortCode ile değil.

  app.post('/api/v1/urls', createUrlHandler);
  app.get('/api/v1/urls', listUrlsHandler);
  app.get('/api/v1/urls/:shortCode', resolveUrlHandler);
  app.get('/api/v1/urls/:shortCode/info', getUrlInfoHandler);
  app.get('/api/v1/urls/:shortCode/analytics', getAnalyticsHandler);
  app.get('/api/v1/urls/:shortCode/qr', getQrCodeHandler);
  app.patch('/api/v1/urls/:shortCode', updateUrlHandler);
  app.delete('/api/v1/urls/:shortCode', deleteUrlHandler);

  // ── Redirect (root level) ────────────────────────────────────────────────
  // Bu en sona gelir — /api/v1/... ile başlamayanları yakalar.
  // Neden? /:shortCode her şeyi yakalar, API route'larını ezmesin diye.
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
