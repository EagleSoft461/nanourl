import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';
import { apiError } from '../errors';

export async function redirectHandler(
  request: FastifyRequest<{ Params: { shortCode: string } }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;

  const result = await urlService.resolveRedirect(shortCode);

  if (result.status === 'not_found') {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  if (result.status === 'expired') {
    return reply.status(410).send(apiError('URL_EXPIRED', 'Short URL has expired'));
  }

  return reply.redirect(301, result.originalUrl);
}
