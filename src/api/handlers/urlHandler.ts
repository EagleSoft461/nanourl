import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';
import { CreateURLRequest } from '../../domain/url';

export async function createUrlHandler(
  request: FastifyRequest<{ Body: CreateURLRequest }>,
  reply: FastifyReply
) {
  try {
    const result = await urlService.createUrl(request.body);
    return reply.status(201).send(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Custom alias already taken') {
      return reply.status(409).send({ error: 'CONFLICT', message: error.message });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create URL' });
  }
}