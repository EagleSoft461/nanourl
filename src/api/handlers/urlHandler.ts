import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';
import { apiError } from '../errors';
import { createUrlSchema } from '../schemas/urlSchemas';
import { checkUrlSafety } from '../middleware/urlSafety';
import { optionalAuth } from '../middleware/auth';

export async function createUrlHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Token varsa kullanıcıyı tanı, yoksa anonim devam et
  await optionalAuth(request, reply);
  if (reply.sent) return;

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

  // URL güvenlik kontrolü — SSRF ve tehlikeli adresler
  const safety = checkUrlSafety(parsed.data.url);
  if (!safety.safe) {
    return reply.status(422).send(
      apiError('UNPROCESSABLE', safety.reason ?? 'URL is not allowed', [
        { field: 'url', issue: safety.reason ?? 'URL is not allowed' },
      ])
    );
  }

  try {
    const result = await urlService.createUrl({
      ...parsed.data,
      userId: request.user?.id,
    });
    return reply.status(201).send(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Custom alias already taken') {
      return reply.status(409).send(apiError('CONFLICT', error.message));
    }
    return reply.status(500).send(apiError('INTERNAL_ERROR', 'Failed to create URL'));
  }
}
