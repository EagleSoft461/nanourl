/**
 * NanoURL Load Test — autocannon tabanlı
 *
 * Çalıştırmak için:
 *   npx tsx tests/benchmark/load-test.ts
 *
 * Önkoşul: Uygulama çalışıyor olmalı (npm run dev veya docker-compose up)
 *
 * Ne ölçüyoruz?
 *   1. POST /api/v1/urls   — URL oluşturma throughput
 *   2. GET  /:shortCode    — Redirect path latency (kritik yol, P99 < 10ms hedefi)
 *   3. GET  /api/v1/urls/:shortCode — Resolve endpoint
 *
 * Hedefler (ADR-003):
 *   - Redirect P99 < 10ms (cache hit)
 *   - Create P99 < 100ms
 *   - 10K RPS redirect throughput
 */

import autocannon from 'autocannon';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Önceden oluşturulmuş bir short code — redirect testinde kullanılır
// Gerçek test öncesi bu değeri geçerli bir short code ile değiştir
const EXISTING_SHORT_CODE = process.env.TEST_SHORT_CODE || 'test01';

interface BenchmarkResult {
  name: string;
  requests: { mean: number; p99: number; total: number };
  latency: { mean: number; p50: number; p99: number; max: number };
  throughput: { mean: number };
  errors: number;
  timeouts: number;
}

function formatResult(result: autocannon.Result, name: string): BenchmarkResult {
  return {
    name,
    requests: {
      mean: Math.round(result.requests.mean),
      p99: result.requests.p99,
      total: result.requests.total,
    },
    latency: {
      mean: result.latency.mean,
      p50: result.latency.p50,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    throughput: {
      mean: Math.round(result.throughput.mean / 1024), // KB/s
    },
    errors: result.errors,
    timeouts: result.timeouts,
  };
}

function printResult(r: BenchmarkResult): void {
  const p99Status = r.latency.p99 <= 10 ? '✅' : r.latency.p99 <= 50 ? '⚠️' : '❌';
  console.log(`\n── ${r.name} ${'─'.repeat(Math.max(0, 50 - r.name.length))}`);
  console.log(`  Requests/sec  : ${r.requests.mean.toLocaleString()} avg`);
  console.log(`  Total requests: ${r.requests.total.toLocaleString()}`);
  console.log(`  Latency mean  : ${r.latency.mean.toFixed(2)}ms`);
  console.log(`  Latency P50   : ${r.latency.p50}ms`);
  console.log(`  Latency P99   : ${r.latency.p99}ms ${p99Status}`);
  console.log(`  Latency max   : ${r.latency.max}ms`);
  console.log(`  Throughput    : ${r.throughput.mean} KB/s`);
  if (r.errors > 0)    console.log(`  ⚠️  Errors    : ${r.errors}`);
  if (r.timeouts > 0)  console.log(`  ⚠️  Timeouts  : ${r.timeouts}`);
}

// ─── Benchmark 1: Redirect path ──────────────────────────────────────────────
// En kritik yol — cache hit senaryosu
async function benchmarkRedirect(): Promise<BenchmarkResult> {
  console.log(`\n🔥 Warming up redirect cache for /${EXISTING_SHORT_CODE}...`);

  // Önce cache'i ısıt
  for (let i = 0; i < 5; i++) {
    await fetch(`${BASE_URL}/${EXISTING_SHORT_CODE}`).catch(() => {});
  }

  const result = await autocannon({
    url: `${BASE_URL}/${EXISTING_SHORT_CODE}`,
    connections: 100,   // Eşzamanlı bağlantı sayısı
    duration: 15,       // Saniye
    pipelining: 1,
    method: 'GET',
    // Redirect'i takip etme — sadece ilk response'u ölç
    // Neden? Biz redirect handler'ın latency'sini ölçüyoruz, hedef sitenin değil
    followRedirects: false,
    title: 'Redirect Path',
  });

  return formatResult(result, 'GET /:shortCode (redirect)');
}

// ─── Benchmark 2: URL oluşturma ───────────────────────────────────────────────
async function benchmarkCreate(): Promise<BenchmarkResult> {
  let counter = Date.now();

  const result = await autocannon({
    url: `${BASE_URL}/api/v1/urls`,
    connections: 20,    // Create daha ağır — daha az concurrent
    duration: 15,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Her request farklı URL — unique short code üretilsin
    requests: [
      {
        method: 'POST',
        path: '/api/v1/urls',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: `https://example.com/benchmark/${counter++}`,
        }),
      },
    ],
    title: 'Create URL',
  });

  return formatResult(result, 'POST /api/v1/urls (create)');
}

// ─── Benchmark 3: Resolve endpoint ───────────────────────────────────────────
async function benchmarkResolve(): Promise<BenchmarkResult> {
  const result = await autocannon({
    url: `${BASE_URL}/api/v1/urls/${EXISTING_SHORT_CODE}`,
    connections: 50,
    duration: 15,
    method: 'GET',
    title: 'Resolve URL',
  });

  return formatResult(result, `GET /api/v1/urls/:shortCode (resolve)`);
}

// ─── Ana akış ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  NanoURL Load Test');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Short code: ${EXISTING_SHORT_CODE}`);
  console.log('═'.repeat(60));
  console.log('\n⚠️  Make sure the app is running before starting the test.');
  console.log('   docker-compose up -d  OR  npm run dev\n');

  const results: BenchmarkResult[] = [];

  try {
    results.push(await benchmarkRedirect());
    results.push(await benchmarkCreate());
    results.push(await benchmarkResolve());
  } catch (err) {
    console.error('\n❌ Benchmark failed:', err);
    console.error('   Is the server running at', BASE_URL, '?');
    process.exit(1);
  }

  // ─── Özet ──────────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(60));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(60));

  for (const r of results) {
    printResult(r);
  }

  // ─── SLA kontrolü ──────────────────────────────────────────────────────────
  console.log('\n\n── SLA Check ' + '─'.repeat(47));
  const redirectResult = results.find((r) => r.name.includes('redirect'));
  const createResult   = results.find((r) => r.name.includes('create'));

  if (redirectResult) {
    const p99 = redirectResult.latency.p99;
    const pass = p99 <= 10;
    console.log(`  Redirect P99 < 10ms : ${p99}ms ${pass ? '✅ PASS' : '❌ FAIL'}`);
  }

  if (createResult) {
    const p99 = createResult.latency.p99;
    const pass = p99 <= 100;
    console.log(`  Create   P99 < 100ms: ${p99}ms ${pass ? '✅ PASS' : '❌ FAIL'}`);
  }

  const hasErrors = results.some((r) => r.errors > 0 || r.timeouts > 0);
  if (hasErrors) {
    console.log('\n  ⚠️  Some requests failed — check server logs.');
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main();
