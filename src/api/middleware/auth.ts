/**
 * Auth Middleware
 *
 * İki mod:
 *   requireAuth  → Token zorunlu. Yoksa 401 döner.
 *   optionalAuth → Token opsiyonel. Varsa decode eder, yoksa devam eder.
 *
 * Neden iki mod?
 *   POST /api/v1/urls → Anonim de oluşturabilir (ama rate limit daha düşük)
 *   DELETE /api/v1/urls/:shortCode → Sadece sahibi silebilir (zorunlu)
 *
 * Token nerede?
 *   Authorization: Bearer <access_token>
 *
 * Decode edilen kullanıcı nerede?
 *   request.user = { id, email }
 *   Handler'lardan request.user ile erişilir.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from '../../services/authService';

// TypeScript'e request.user tipini tanıt
// Neden? Fastify'ın FastifyRequest tipi user alanı içermiyor,
// biz ekliyoruz ki handler'larda tip güvenli erişebilelim.
declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7); // "Bearer " kısmını at
}

// Token zorunlu — yoksa veya geçersizse 401
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }

  try {
    const payload = authService.verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email };
  } catch {
    return reply.status(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}

// Token opsiyonel — varsa decode et, yoksa devam et
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = extractToken(request);
  if (!token) return; // Token yok, sorun değil

  try {
    const payload = authService.verifyAccessToken(token);
    request.user = { id: payload.sub, email: payload.email };
  } catch {
    // Geçersiz token — anonim olarak devam et
    // Neden hata fırlatmıyoruz? optionalAuth'ta token yanlışsa
    // kullanıcıyı reddetmek yerine anonim gibi davranıyoruz.
  }
}
