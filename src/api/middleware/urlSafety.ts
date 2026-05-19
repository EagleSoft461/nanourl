/**
 * URL Safety Checks
 *
 * Hangi URL'leri engelliyoruz?
 *
 * 1. Desteklenmeyen protokoller
 *    file://, ftp://, javascript:// → sadece http/https kabul
 *
 * 2. Loopback adresleri (localhost saldırısı)
 *    http://localhost/admin
 *    http://127.0.0.1/secret
 *    http://[::1]/internal
 *
 * 3. Özel ağ adresleri (iç ağ saldırısı — SSRF)
 *    http://192.168.1.1/router-admin
 *    http://10.0.0.1/internal-api
 *    http://172.16.0.1/service
 *
 * 4. Cloud metadata endpoint'leri (kritik!)
 *    http://169.254.169.254/latest/meta-data/  ← AWS metadata
 *    http://metadata.google.internal/           ← GCP metadata
 *    Bu endpoint'ler cloud sunucusunun kimlik bilgilerini döndürür!
 *
 * Neden bu önemli?
 * Saldırgan http://169.254.169.254/latest/meta-data/iam/security-credentials/
 * adresini kısaltırsa, birisi o linke tıkladığında sunucu bu adrese istek atar
 * ve AWS kimlik bilgilerini sızdırabilir.
 */

// Tehlikeli hostname pattern'leri
const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata.google',
];

// Tehlikeli IP aralıkları (CIDR notasyonu yerine prefix kontrolü)
const BLOCKED_IP_PREFIXES = [
  '127.',       // Loopback
  '0.',         // Bu ağ
  '10.',        // Özel ağ (RFC 1918)
  '169.254.',   // Link-local (AWS/GCP metadata!)
  '192.168.',   // Özel ağ (RFC 1918)
];

// 172.16.0.0/12 aralığı — 172.16.x.x - 172.31.x.x
function is172PrivateRange(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d+)\./);
  if (!match) return false;
  const second = parseInt(match[1], 10);
  return second >= 16 && second <= 31;
}

function isIPv6Loopback(hostname: string): boolean {
  // ::1, [::1], 0:0:0:0:0:0:0:1
  const cleaned = hostname.replace(/^\[|\]$/g, '');
  return cleaned === '::1' || cleaned === '0:0:0:0:0:0:0:1';
}

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

export function checkUrlSafety(rawUrl: string): SafetyCheckResult {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'Invalid URL format' };
  }

  // 1. Protokol kontrolü
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      safe: false,
      reason: `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Blocked hostname'ler
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { safe: false, reason: `Hostname not allowed: ${hostname}` };
  }

  // 3. IPv6 loopback
  if (isIPv6Loopback(hostname)) {
    return { safe: false, reason: 'IPv6 loopback addresses are not allowed' };
  }

  // 4. Tehlikeli IP prefix'leri
  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return {
        safe: false,
        reason: `Private or reserved IP range not allowed: ${hostname}`,
      };
    }
  }

  // 5. 172.16-31 aralığı
  if (is172PrivateRange(hostname)) {
    return {
      safe: false,
      reason: `Private IP range not allowed: ${hostname}`,
    };
  }

  return { safe: true };
}
