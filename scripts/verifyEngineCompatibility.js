import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { loadEnginePaths } from '../src/config/env.js';
import { ENGINE_DATASETS } from '../src/modules/engine/engine.registry.js';

// Runtime and verifier share module-relative dotenv loading and path resolution.
// No credentials are printed, MongoDB is never connected, and sources remain read-only.
export async function verifyEngineCompatibility(paths = loadEnginePaths()) {
  const database = {
    isReady: () => false,
    getStatus: () => ({ configured: false, ready: false, status: 'unconfigured', name: null }),
    getConnection() { throw new Error('MongoDB is not used by Engine verification.'); },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const app = createApp({ config: { ...paths, nodeEnv: 'test', clientOrigins: [] }, database, logger });
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/engine`;
  const endpoints = [], filters = [];
  async function get(route, expected = 200) {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    assert.equal(response.status, expected);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(body.success, expected === 200);
    return { status: response.status, body };
  }
  try {
    const catalog = await get('/datasets'); endpoints.push({ route: '/datasets', status: catalog.status });
    assert.equal(catalog.body.data.manifest.sourceContractVersion, '1.0.0');
    assert.ok(catalog.body.data.items.filter((entry) => !entry.optional).every((entry) => entry.structurallyReady));
    const detail = await get('/datasets/power_monthly'); endpoints.push({ route: '/datasets/power_monthly', status: detail.status });
    for (const definition of ENGINE_DATASETS) {
      const available = catalog.body.data.items.find((entry) => entry.id === definition.id);
      const expected = available.structurallyReady ? 200 : 503;
      const result = await get(definition.route + '?limit=2', expected);
      endpoints.push({ route: definition.route, status: result.status });
      if (expected !== 200) { assert.equal(definition.optional, true); continue; }
      const data = result.body.data, row = data.items[0];
      assert.equal(data.pagination.total, available.recordCount);
      assert.ok(data.items.length > 0 && data.items.length <= 2);
      assert.equal(data.dataset.verification.scientific, 'not_assessed');
      let query;
      switch (definition.id) {
        case 'power_monthly': query = { location_id: row.location_id, year: row.year, month: row.month }; break;
        case 'modis_monthly': query = { month: row.month }; break;
        case 'modis_16day': query = { startDate: row.date, endDate: row.date }; break;
        case 'usda_annual': case 'usda_crop_classes': query = { year: row.year, crop_code: row.crop_code }; break;
        case 'usda_crop_transitions': query = { year_1: row.year_1, year_2: row.year_2, transition_type: row.transition_type }; break;
        case 'soil_map_units': query = { mukey: row.mukey }; break;
        case 'merra2_context': query = { startDate: row.date, endDate: row.date, latitude: row.latitude, longitude: row.longitude }; break;
      }
      const filtered = await get(definition.route + '?' + new URLSearchParams(query));
      assert.equal(filtered.body.data.pagination.total, 1);
      assert.deepEqual(filtered.body.data.items[0], row);
      filters.push({ datasetId: definition.id, status: filtered.status, matches: filtered.body.data.pagination.total });
    }
    return { manifest: catalog.body.data.manifest,
      datasets: catalog.body.data.items.map(({ id, status, recordCount, verification }) => ({ id, status, recordCount, verification })),
      endpoints, filters, mongodbUsed: false };
  } finally {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyEngineCompatibility().then((result) => console.log(JSON.stringify(result, null, 2))).catch(() => {
    console.error('Read-only Engine compatibility verification failed. Check configured roots and dataset availability.'); process.exitCode = 1;
  });
}
