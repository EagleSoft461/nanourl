import { describe, it, expect } from 'vitest';
import { checkUrlSafety } from '../middleware/urlSafety';

describe('checkUrlSafety', () => {
  // Geçerli URL'ler
  it('allows normal https URLs', () => {
    expect(checkUrlSafety('https://example.com/path')).toEqual({ safe: true });
  });

  it('allows normal http URLs', () => {
    expect(checkUrlSafety('http://example.com')).toEqual({ safe: true });
  });

  // Protokol kontrolleri
  it('blocks file:// protocol', () => {
    const result = checkUrlSafety('file:///etc/passwd');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Unsupported protocol');
  });

  it('blocks ftp:// protocol', () => {
    expect(checkUrlSafety('ftp://files.example.com').safe).toBe(false);
  });

  // Loopback
  it('blocks localhost', () => {
    expect(checkUrlSafety('http://localhost/admin').safe).toBe(false);
  });

  it('blocks 127.0.0.1', () => {
    expect(checkUrlSafety('http://127.0.0.1:8080').safe).toBe(false);
  });

  it('blocks IPv6 loopback', () => {
    expect(checkUrlSafety('http://[::1]/secret').safe).toBe(false);
  });

  // Özel ağlar
  it('blocks 192.168.x.x', () => {
    expect(checkUrlSafety('http://192.168.1.100/router').safe).toBe(false);
  });

  it('blocks 10.x.x.x', () => {
    expect(checkUrlSafety('http://10.0.0.1/internal').safe).toBe(false);
  });

  it('blocks 172.16-31.x.x range', () => {
    expect(checkUrlSafety('http://172.16.0.1/service').safe).toBe(false);
    expect(checkUrlSafety('http://172.31.255.255/service').safe).toBe(false);
  });

  it('allows 172.15.x.x (outside private range)', () => {
    expect(checkUrlSafety('http://172.15.0.1/public').safe).toBe(true);
  });

  // Cloud metadata
  it('blocks AWS metadata endpoint', () => {
    expect(checkUrlSafety('http://169.254.169.254/latest/meta-data/').safe).toBe(false);
  });

  it('blocks GCP metadata endpoint', () => {
    expect(checkUrlSafety('http://metadata.google.internal/').safe).toBe(false);
  });
});
