/**
 * URL Yönetim Handler'ları
 *
 * Bu dosya POST dışındaki tüm /api/v1/urls endpoint'lerini içerir:
 *   GET    /api/v1/urls                       → liste
 *   GET    /api/v1/urls/:shortCode            → resolve (redirect olmadan)
 *   GET    /api/v1/urls/:shortCode/info       → tam metadata
 *   GET    /api/v1/urls/:shortCode/analytics  → tıklama istatistikleri
 *   GET    /api/v1/urls/:shortCode/qr         → QR kod (PNG)
 *   PATCH  /api/v1/urls/:shortCode            → güncelle
 *   DELETE /api/v1/urls/:shortCode            → sil
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { urlService } from '../../services/urlService';
import { apiError } from '../errors';

// ─── Tip tanımları ────────────────────────────────────────────────────────────
// Fastify'a route parametrelerinin ve query string'in tipini bildiriyoruz.
// Böylece request.params ve request.query'de TypeScript otomatik tamamlama çalışır.

type ShortCodeParams = { shortCode: string };

type ListQueryString = {
  page?: string;
  page_size?: string;
  sort?: string;
  order?: string;
  search?: string;
};

// PATCH için Zod şeması — tüm alanlar opsiyonel (partial update)
const patchUrlSchema = z.object({
  url: z
    .string()
    .url('Must be a valid URL')
    .refine((v) => {
      try {
        const p = new URL(v).protocol;
        return p === 'http:' || p === 'https:';
      } catch {
        return false;
      }
    }, 'Must use http or https')
    .optional(),
  expires_in: z
    .number()
    .int()
    .min(60, 'Must be at least 60 seconds')
    .max(31_536_000)
    .nullable()   // null = expiry'yi kaldır
    .optional(),
});

// ─── GET /api/v1/urls ─────────────────────────────────────────────────────────
// Tüm URL'leri sayfalı listeler.
// Neden sayfalama? 1 milyon kayıt varsa hepsini tek seferde döndürmek
// hem sunucuyu hem istemciyi ezer. Sayfalama bunu parçalara böler.

export async function listUrlsHandler(
  request: FastifyRequest<{ Querystring: ListQueryString }>,
  reply: FastifyReply
) {
  const { page, page_size, sort, order, search } = request.query;

  const result = await urlService.listUrls({
    page: page ? parseInt(page, 10) : 1,
    pageSize: page_size ? parseInt(page_size, 10) : 20,
    sort,
    order,
    search,
  });

  return reply.send(result);
}

// ─── GET /api/v1/urls/:shortCode ──────────────────────────────────────────────
// Redirect yapmadan sadece original URL'yi döndürür.
// Kullanım: önizleme, link kontrolü, API entegrasyonları.

export async function resolveUrlHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;
  const url = await urlService.getInfo(shortCode);

  if (!url) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  return reply.send({
    data: {
      original_url: url.originalUrl,
      expires_at: url.expiresAt?.toISOString() ?? null,
    },
  });
}

// ─── GET /api/v1/urls/:shortCode/info ────────────────────────────────────────
// Tam metadata: click sayısı, oluşturulma tarihi, user_id vb.
// Gerçek projede authentication gerektirir — Phase 4'te eklenecek.

export async function getUrlInfoHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;
  const url = await urlService.getInfo(shortCode);

  if (!url) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  return reply.send({
    data: {
      short_code: url.shortCode,
      original_url: url.originalUrl,
      created_at: url.createdAt.toISOString(),
      expires_at: url.expiresAt?.toISOString() ?? null,
      click_count: url.clickCount,
      user_id: url.userId ?? null,
    },
  });
}

// ─── PATCH /api/v1/urls/:shortCode ───────────────────────────────────────────
// Kısmi güncelleme — sadece gönderilen alanlar değişir.
// Neden PATCH ve PUT değil?
//   PUT = tüm kaydı değiştir (gönderilmeyen alanlar silinir)
//   PATCH = sadece gönderilen alanları değiştir (daha güvenli)

export async function updateUrlHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;

  const parsed = patchUrlSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send(
      apiError(
        'VALIDATION_ERROR',
        'Request body failed validation',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }))
      )
    );
  }

  const updated = await urlService.updateUrl(shortCode, {
    url: parsed.data.url,
    expiresIn: parsed.data.expires_in,
  });

  if (!updated) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  return reply.send({
    data: {
      short_code: updated.shortCode,
      original_url: updated.originalUrl,
      created_at: updated.createdAt.toISOString(),
      expires_at: updated.expiresAt?.toISOString() ?? null,
      click_count: updated.clickCount,
    },
  });
}

// ─── DELETE /api/v1/urls/:shortCode ──────────────────────────────────────────
// URL'yi hem DB'den hem cache'den siler.
// 204 No Content döner — body yok, sadece "başarılı" sinyali.

export async function deleteUrlHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;

  // Önce var mı kontrol et
  const existing = await urlService.getInfo(shortCode);
  if (!existing) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  await urlService.deleteUrl(shortCode);

  // 204 = No Content — başarılı ama döndürülecek veri yok
  return reply.status(204).send();
}

// ─── GET /api/v1/urls/:shortCode/analytics ───────────────────────────────────
// Tıklama istatistiklerini döndürür.
//
// Şu an DB'de sadece toplam click_count var.
// Günlük breakdown, ülke, referrer gibi detaylar Phase 5'te Kafka + ClickHouse
// ile eklenecek. Şimdilik mevcut veriyi anlamlı bir formatta sunuyoruz.
//
// Neden getInfo'yu yeniden kullanıyoruz?
// click_count zaten URLRecord'da var — ayrı sorgu atmaya gerek yok.
// Bu DRY (Don't Repeat Yourself) prensibinin pratik örneği.

export async function getAnalyticsHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;
  const url = await urlService.getInfo(shortCode);

  if (!url) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  return reply.send({
    data: {
      short_code: url.shortCode,
      total_clicks: url.clickCount,
      created_at: url.createdAt.toISOString(),
      expires_at: url.expiresAt?.toISOString() ?? null,
      // Phase 5'te eklenecekler (Kafka + ClickHouse):
      // unique_clicks, top_countries, top_referrers, click_history
    },
  });
}

// ─── GET /api/v1/urls/:shortCode/qr ──────────────────────────────────────────
// Short URL için QR kod üretir ve PNG olarak döndürür.
//
// Neden Buffer döndürüyoruz, JSON değil?
// PNG binary veri — text formatında taşınamaz.
// reply.type('image/png') ile tarayıcıya "bu bir resim" diyoruz.
// Tarayıcı direkt gösterir, indirme linki olarak kullanılabilir.
//
// qrcode kütüphanesi: https://www.npmjs.com/package/qrcode
// toBuffer() → PNG Buffer üretir, async çalışır.

export async function getQrCodeHandler(
  request: FastifyRequest<{ Params: ShortCodeParams }>,
  reply: FastifyReply
) {
  const { shortCode } = request.params;
  const url = await urlService.getInfo(shortCode);

  if (!url) {
    return reply.status(404).send(apiError('NOT_FOUND', 'Short URL not found'));
  }

  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const shortUrl = `${BASE_URL}/${shortCode}`;

  // QR kod içine short URL'yi kodluyoruz (original URL değil)
  // Neden? QR tarandığında redirect akışından geçsin, analytics sayılsın.
  const buffer = await QRCode.toBuffer(shortUrl, {
    type: 'png',
    width: 300,
    margin: 2,
  });

  return reply
    .type('image/png')
    .send(buffer);
}
