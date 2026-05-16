import Fastify from 'fastify';
import { createUrlHandler } from './api/handlers/urlHandler';
import { redirectHandler } from './api/handlers/redirectHandler';
import { checkHealth } from './config/database';

const PORT = parseInt(process.env.PORT || '3000', 10);

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.post('/api/v1/urls', createUrlHandler);
  app.get('/:shortCode', redirectHandler);
  app.get('/health', async (_, reply) => {
    const health = await checkHealth();
    return reply.send({ status: 'ok', ...health });
  });

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
