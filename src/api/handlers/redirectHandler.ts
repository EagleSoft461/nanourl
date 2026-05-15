import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';

export async function redirectHandler(
  request: FastifyRequest<{ Params: { shortCode: string } }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;

  const originalUrl = await urlService.getRedirectUrl(shortCode);

  if (!originalUrl) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: 'Short URL not found or expired' });
  }

  return reply.redirect(301, originalUrl);
}