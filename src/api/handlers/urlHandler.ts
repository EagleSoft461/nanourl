import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';
import { apiError } from '../errors';
import { createUrlSchema } from '../schemas/urlSchemas';

export async function createUrlHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = createUrlSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send(
      apiError(
        'VALIDATION_ERROR',
        'Request body failed validation',
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          issue: issue.message,
        }))
      )
    );
  }

  try {
    const result = await urlService.createUrl(parsed.data);
    return reply.status(201).send(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Custom alias already taken') {
      return reply.status(409).send(apiError('CONFLICT', error.message));
    }
    return reply.status(500).send(apiError('INTERNAL_ERROR', 'Failed to create URL'));
  }
}
