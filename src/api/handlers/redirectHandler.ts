import { FastifyRequest, FastifyReply } from 'fastify';
import { urlService } from '../../services/urlService';
import { apiError } from '../errors';
import { eventProducer } from '../../infrastructure/kafka/kafkaProducer';
import { createUrlAccessedEvent } from '../../infrastructure/events/eventSchema';

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

  // Fire and forget — Kafka'ya event yayınla, kullanıcıyı beklettirme
  //
  // Neden fire and forget?
  // Kafka yazma işlemi ~1-5ms sürer. Redirect path'inde bu kabul edilemez.
  // .catch() ile hata sessizce loglanır — Kafka down olsa bile redirect çalışır.
  // Analytics gecikmeli güncellenir ama redirect hiç etkilenmez.
  eventProducer
    .publish(
      createUrlAccessedEvent({
        shortCode,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? '',
        referer: (request.headers['referer'] as string) ?? null,
      })
    )
    .catch((err) => {
      // Kafka hatası redirect'i durdurmamalı — sadece logla
      request.log.error({ err, shortCode }, 'Failed to publish url.accessed event');
    });

  return reply.redirect(301, result.originalUrl);
}
