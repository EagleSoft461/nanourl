/**
 * JWT Konfigürasyonu
 *
 * RS256 algoritması kullanıyoruz.
 *
 * Neden RS256, HS256 değil?
 * HS256 = tek anahtar (hem imzalar hem doğrular) — paylaşmak tehlikeli
 * RS256 = iki anahtar:
 *   Private key → sadece bu sunucuda, token imzalar
 *   Public key  → herkesle paylaşılabilir, token doğrular
 *
 * Örnek senaryo: Birden fazla mikroservis varsa,
 * her servis public key ile token doğrulayabilir,
 * ama sadece auth servisi token üretebilir.
 *
 * Development'ta: Sabit key pair (env'de yoksa)
 * Production'da:  JWT_PRIVATE_KEY ve JWT_PUBLIC_KEY env değişkenleri
 */

// Development için sabit RSA key pair
// UYARI: Bu key'leri production'da KULLANMA — sadece geliştirme içindir
const DEV_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA2a2rwplBQLF29amygykEMmYz0+Kcj3bKBp29P2rFj7rQKGMH
xnCxBMhJFGFMCOBFBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBMBM
-----END RSA PRIVATE KEY-----`;

export interface JWTConfig {
  privateKey: string;
  publicKey: string;
  accessTokenTTL: string;   // '1h', '15m' gibi
  refreshTokenTTL: string;  // '30d', '7d' gibi
}

export function getJWTConfig(): JWTConfig {
  const privateKey = process.env.JWT_PRIVATE_KEY;
  const publicKey = process.env.JWT_PUBLIC_KEY;

  if (!privateKey || !publicKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production'
      );
    }
    // Development'ta uyarı ver ama devam et
    // Gerçek key pair generate etmek için:
    //   openssl genrsa -out private.pem 2048
    //   openssl rsa -in private.pem -pubout -out public.pem
    console.warn(
      '[JWT] WARNING: Using placeholder keys. Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY env vars.'
    );
  }

  return {
    privateKey: privateKey || 'dev-secret-not-for-production',
    publicKey: publicKey || 'dev-secret-not-for-production',
    accessTokenTTL: process.env.JWT_ACCESS_TTL || '1h',
    refreshTokenTTL: process.env.JWT_REFRESH_TTL || '30d',
  };
}

export interface JWTPayload {
  sub: string;    // user ID (subject — JWT standardı)
  email: string;
  iat?: number;   // issued at (JWT standardı, otomatik eklenir)
  exp?: number;   // expiry (JWT standardı, otomatik eklenir)
}
