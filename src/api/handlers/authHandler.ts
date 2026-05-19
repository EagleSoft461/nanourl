import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../../services/authService';
import { apiError } from '../errors';

const authSchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
});

// POST /auth/register
export async function registerHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send(
      apiError('VALIDATION_ERROR', 'Request body failed validation',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }))
      )
    );
  }

  try {
    const user = await authService.register(parsed.data);
    return reply.status(201).send({
      data: { id: user.id, email: user.email, created_at: user.createdAt },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_ALREADY_EXISTS') {
      return reply.status(409).send(apiError('CONFLICT', 'Email already registered'));
    }
    return reply.status(500).send(apiError('INTERNAL_ERROR', 'Registration failed'));
  }
}

// POST /auth/login
export async function loginHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send(
      apiError('VALIDATION_ERROR', 'Request body failed validation',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message }))
      )
    );
  }

  try {
    const tokens = await authService.login(parsed.data);
    return reply.status(200).send({
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        token_type: 'Bearer',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
      // Kasıtlı olarak "email yok" veya "şifre yanlış" demiyoruz
      // Neden? Saldırgana hangi email'in kayıtlı olduğunu söylememek için
      return reply.status(401).send(apiError('UNAUTHORIZED', 'Invalid email or password'));
    }
    return reply.status(500).send(apiError('INTERNAL_ERROR', 'Login failed'));
  }
}

// POST /auth/refresh
export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = z.object({
    refresh_token: z.string().min(1),
  }).safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send(apiError('VALIDATION_ERROR', 'refresh_token is required'));
  }

  try {
    const tokens = await authService.refresh(parsed.data.refresh_token);
    return reply.send({
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        token_type: 'Bearer',
      },
    });
  } catch (err) {
    if (err instanceof Error &&
      (err.message === 'INVALID_REFRESH_TOKEN' || err.message === 'REFRESH_TOKEN_EXPIRED')) {
      return reply.status(401).send(apiError('UNAUTHORIZED', 'Invalid or expired refresh token'));
    }
    return reply.status(500).send(apiError('INTERNAL_ERROR', 'Token refresh failed'));
  }
}

// POST /auth/logout
export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const parsed = z.object({
    refresh_token: z.string().min(1),
  }).safeParse(request.body);

  if (!parsed.success) {
    return reply.status(400).send(apiError('VALIDATION_ERROR', 'refresh_token is required'));
  }

  await authService.logout(parsed.data.refresh_token);

  // Refresh token bulunamasa bile 204 dön
  // Neden? Logout idempotent olmalı — zaten çıkmışsa hata verme
  return reply.status(204).send();
}
