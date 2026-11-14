import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createApp } from '../src/app.js';
import { loadEnginePaths } from '../src/config/env.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { FORMAT_ADAPTERS } from '../src/modules/engine/engine.loaders.js';

export const BENCHMARK_ENDPOINTS = Object.freeze([
  '/api/v1/engine/datasets', '/api/v1/engine/climate/monthly', '/api/v1/engine/vegetation/monthly',
  '/api/v1/scenarios/comparison', '/api/v1/scenarios/comparison?includeMerra2=true',
]);
const difference = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, a[key] - b[key]]));
function statistics(samples) {
  const values = samples.map((sample) => sample.ms).sort((a, b) => a - b), middle = Math.floor(values.length / 2);
  return { n: values.length, min: values[0], median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    p95: values[Math.ceil(values.length * 0.95) - 1], max: values.at(-1) };
}

// Explicit local HTTP only, no source writes, dotenv changes, or MongoDB connection.
export async function benchmarkEndpoint(endpoint, paths = loadEnginePaths(), enabled = true) {
  if (!BENCHMARK_ENDPOINTS.includes(endpoint) || !global.gc) throw new Error('Use the benchmark CLI with its isolated GC-enabled workers.');
  const work = { scans: 0, rows: 0, validatedRows: 0, bytes: 0 }, peak = { rss: 0, heapUsed: 0, external: 0 };
  const mark = () => { const memory = process.memoryUsage(); for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], memory[key]); };
  const engineService = createEngineService({ ...paths, cache: { enabled }, adapters: { ...FORMAT_ADAPTERS,
    csv: async (source, onRecord, limits, context) => {
      work.scans += 1; work.bytes += source.size;
      const result = await FORMAT_ADAPTERS.csv(source, (row) => { work.rows += 1; onRecord(row); work.validatedRows += 1; }, limits, context);
      mark(); return result;
    } } });
  const database = { isReady: () => false, getStatus: () => ({ configured: false, ready: false, status: 'unconfigured' }),
    getConnection() { throw new Error('MongoDB is not used by Engine benchmarking.'); } };
  const app = createApp({ config: { ...paths, nodeEnv: 'test', clientOrigins: [] }, database, engineService,
    logger: { info() {}, warn() {}, error() {} } });
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  global.gc(); const baseline = process.memoryUsage(); mark(); const sampler = setInterval(mark, 5);
  async function request() {
    const before = { ...work }, start = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { signal: AbortSignal.timeout(30000) });
    const text = await response.text(), ms = performance.now() - start;
    assert.equal(response.status, 200, 'Engine benchmark requires available datasets.');
    assert.equal(JSON.parse(text).success, true); mark();
    return { ms, bytes: Buffer.byteLength(text), encoding: response.headers.get('content-encoding') ?? 'identity', work: difference(work, before) };
  }
  try {
    const cold = await request(), warm = [];
    for (let index = 0; index < 10; index += 1) warm.push(await request());
    const before = { ...work }, start = performance.now();
    const concurrent = await Promise.all(Array.from({ length: 4 }, request));
    const wallMs = performance.now() - start, concurrentWork = difference(work, before);
    clearInterval(sampler); mark(); global.gc(); const afterGC = process.memoryUsage();
    return { endpoint, cacheEnabled: enabled, cold, warm: statistics(warm), warmWorkEach: warm.map((sample) => sample.work),
      concurrency4: { ...statistics(concurrent), wallMs, work: concurrentWork },
      memory: { baseline, observedPeak: peak, afterGC }, totalWork: work, cache: engineService.getCacheStats() };
  } finally {
    clearInterval(sampler); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--worker') {
      console.log(JSON.stringify(await benchmarkEndpoint(process.argv[3], loadEnginePaths(), !process.argv.includes('--no-cache'))));
    } else {
      if (process.argv.slice(2).some((argument) => argument !== '--no-cache')) throw new Error('Unsupported benchmark option.');
      loadEnginePaths(); // Same dotenv precedence as runtime and compatibility verification.
      for (const endpoint of BENCHMARK_ENDPOINTS) {
        const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', endpoint,
          ...(process.argv.includes('--no-cache') ? ['--no-cache'] : [])], {
          cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
        });
        if (result.status !== 0) throw new Error('Isolated benchmark failed.');
        process.stdout.write(result.stdout);
      }
    }
  } catch {
    console.error('Engine benchmark failed. Check Engine path configuration and dataset availability.'); process.exitCode = 1;
  }
}
