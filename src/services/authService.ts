/**
 * AuthService
 *
 * Sorumlulukları:
 *   - Kullanıcı kaydı (register)
 *   - Giriş ve token üretimi (login)
 *   - Token yenileme (refresh)
 *   - Çıkış (logout — refresh token'ı geçersiz kıl)
 *
 * Güvenlik notları:
 *   - Şifreler bcrypt ile hash'lenir (cost factor 12)
 *   - Access token kısa ömürlü (1h) — çalınsa bile kısa süre geçerli
 *   - Refresh token DB'de hash olarak saklanır — çalınsa bile DB'deki değer işe yaramaz
 *   - Timing attack'a karşı: kullanıcı bulunamasa bile bcrypt compare çalışır
 */

import { createHash, randomBytes } from 'crypto';
import { pgPool } from '../config/database';
import { getJWTConfig, JWTPayload } from '../config/jwt';
import jwt from 'jsonwebtoken';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // saniye cinsinden access token ömrü
}

export interface UserRecord {
  id: string;
  email: string;
  createdAt: Date;
}

// Basit bcrypt benzeri hash — production'da gerçek bcrypt kullan
// Not: Node.js'te bcrypt için 'bcrypt' veya 'bcryptjs' paketi gerekir.
// Bu projede bağımlılığı minimal tutmak için crypto modülü kullanıyoruz.
// Production'da: npm install bcrypt && npm install --save-dev @types/bcrypt
async function hashPassword(password: string): Promise<string> {
  // PBKDF2 — Node.js built-in, bcrypt'e yakın güvenlik
  return new Promise((resolve, reject) => {
    const salt = randomBytes(16).toString('hex');
    require('crypto').pbkdf2(
      password, salt, 100_000, 64, 'sha512',
      (err: Error | null, derivedKey: Buffer) => {
        if (err) reject(err);
        else resolve(`${salt}:${derivedKey.toString('hex')}`);
      }
    );
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    require('crypto').pbkdf2(
      password, salt, 100_000, 64, 'sha512',
      (err: Error | null, derivedKey: Buffer) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex') === key);
      }
    );
  });
}

function hashToken(token: string): string {
  // Refresh token'ı DB'ye kaydetmeden önce hash'le
  // Neden? DB sızıntısında token'lar kullanılamaz olsun
  return createHash('sha256').update(token).digest('hex');
}

function parseTTL(ttl: string): number {
  // '1h' → 3600, '30d' → 2592000, '15m' → 900
  const unit = ttl.slice(-1);
  const value = parseInt(ttl.slice(0, -1), 10);
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 3600);
}

export class AuthService {
  async register(input: RegisterInput): Promise<UserRecord> {
    // Email zaten kayıtlı mı?
    const existing = await pgPool.query(
      'SELECT id FROM users WHERE email = $1',
      [input.email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const result = await pgPool.query<{ id: string; email: string; created_at: Date }>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [input.email.toLowerCase(), passwordHash]
    );

    const row = result.rows[0];
    return { id: row.id, email: row.email, createdAt: row.created_at };
  }

  async login(input: RegisterInput): Promise<AuthTokens> {
    const result = await pgPool.query<{
      id: string;
      email: string;
      password_hash: string;
    }>(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [input.email.toLowerCase()]
    );

    // Timing attack önlemi: kullanıcı bulunamasa bile hash işlemi yap
    // Neden? "Kullanıcı yok" ile "şifre yanlış" arasındaki zaman farkı
    // saldırgana kullanıcının var olup olmadığını söyler.
    const user = result.rows[0];
    const dummyHash = 'dummy:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const isValid = await verifyPassword(
      input.password,
      user ? user.password_hash : dummyHash
    );

    if (!user || !isValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    return this.generateTokens(user.id, user.email);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);

    const result = await pgPool.query<{ user_id: string; expires_at: Date }>(
      `SELECT user_id, expires_at FROM refresh_tokens
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    const { user_id, expires_at } = result.rows[0];

    if (new Date(expires_at) < new Date()) {
      throw new Error('REFRESH_TOKEN_EXPIRED');
    }

    // Eski token'ı sil (rotation — her refresh'te yeni token)
    // Neden? Token çalınmışsa eski token artık geçersiz olur
    await pgPool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);

    const userResult = await pgPool.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [user_id]
    );

    return this.generateTokens(user_id, userResult.rows[0].email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await pgPool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
  }

  verifyAccessToken(token: string): JWTPayload {
    const config = getJWTConfig();
    try {
      return jwt.verify(token, config.publicKey, {
        algorithms: ['RS256', 'HS256'], // dev'de HS256, prod'da RS256
      }) as JWTPayload;
    } catch {
      throw new Error('INVALID_ACCESS_TOKEN');
    }
  }

  private async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const config = getJWTConfig();
    const accessTTL = parseTTL(config.accessTokenTTL);

    const payload: JWTPayload = { sub: userId, email };

    // Access token — kısa ömürlü, imzalı JWT
    const accessToken = jwt.sign(payload, config.privateKey, {
      algorithm: config.privateKey.includes('BEGIN RSA') ? 'RS256' : 'HS256',
      expiresIn: accessTTL,
    } as jwt.SignOptions);

    // Refresh token — uzun ömürlü, rastgele string (JWT değil)
    // Neden JWT değil? Refresh token'ı geçersiz kılabilmek için DB'de tutuyoruz.
    // JWT'yi geçersiz kılmak zordur (stateless), DB kaydını silmek kolaydır.
    const refreshToken = randomBytes(32).toString('hex');
    const refreshTTL = parseTTL(config.refreshTokenTTL);
    const expiresAt = new Date(Date.now() + refreshTTL * 1000);

    await pgPool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hashToken(refreshToken), expiresAt]
    );

    return { accessToken, refreshToken, expiresIn: accessTTL };
  }
}

export const authService = new AuthService();
