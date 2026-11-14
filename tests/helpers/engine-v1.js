import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FINAL_DATASET_IDS } from '../../src/modules/engine/engine.contract-v1.js';

const TEST_ROOT = fileURLToPath(new URL('../.tmp-engine/', import.meta.url));
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = () => ({ type: 'string', 'x-unit': null });
const integer = () => ({ type: 'integer', 'x-unit': null });
const number = () => ({ type: 'number', 'x-unit': 'synthetic-unit' });
const date = () => ({ ...text(), format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const nullable = (definition) => ({ ...definition, type: [definition.type, 'null'] });
export function csvCell(value) {
  const raw = value === null ? 'NULL' : value === true ? 'True' : value === false ? 'False' : String(value);
  return /[",\r\n]/.test(raw) ? '"' + raw.replaceAll('"', '""') + '"' : raw;
}
export function csvBytes(headers, rows) {
  return headers.join(',') + '\r\n' + rows.map((row) => headers.map((field) => csvCell(row[field])).join(',')).join('\r\n') + '\r\n';
}

export async function finalFixture(t) {
  await mkdir(TEST_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ROOT, 'synthetic-'));
  t.after(async () => {
    const target = path.resolve(root), relative = path.relative(path.resolve(TEST_ROOT), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(target).startsWith('synthetic-')) throw new Error('Unsafe test cleanup target.');
    await rm(target, { recursive: true, force: true });
  });
  const manifest = { phase: 'SYNTHETIC_TEST_ONLY', contract_version: '1.0.0', county_scope: { name: 'SYNTHETIC TEST DATA ONLY', geoid: '19169' }, datasets: [], unavailable_datasets: [] };
  const definitions = {};
  function add(name, properties, rows, coverage, extra = {}) {
    properties = structuredClone(properties);
    const entry = { dataset_name: name, path: `data/processed/features/${name}.csv`, schema_path: `src/schemas/${name}.schema.json`,
      source_path: `data/synthetic-originals/${name}.csv`, primary_key: extra.key, temporal_grain: 'SYNTHETIC TEST ONLY', spatial_grain: 'SYNTHETIC TEST ONLY',
      optional: name === 'merra2_monthly_context_features', row_count: rows.length, coverage,
      nullable_fields: Object.keys(properties).filter((field) => Array.isArray(properties[field].type)),
      provenance: { source_path: `data/synthetic-originals/${name}.csv`, evidence_paths: [], transformation: 'SYNTHETIC TEST ONLY; no real data.' } };
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'SYNTHETIC TEST DATA ONLY', type: 'object', additionalProperties: false,
      required: Object.keys(properties), properties,
      'x-csv': { encoding: 'utf-8', delimiter: ',', ordered_columns: Object.keys(properties), null_tokens: ['', 'NULL'], boolean_tokens: { True: true, False: false }, decode_before_json_schema_validation: true },
      'x-dataset': { ...structuredClone(entry), county_scope: structuredClone(manifest.county_scope), warnings: ['SYNTHETIC TEST DATA ONLY'],
        validation: { expected_row_count: rows.length, coverage: structuredClone(coverage),
          expected_missing_counts: Object.fromEntries(Object.keys(properties).map((field) => [field, rows.filter((row) => row[field] === null).length])), ...extra.validation } } };
    manifest.datasets.push(entry); definitions[name] = { entry, schema, rows };
  }
  const power = [];
  for (const location_id of ['synthetic-A', 'synthetic-B']) for (const month of [1, 2]) power.push({ location_id, latitude: 1, longitude: 2, year: 2020, month,
    month_start: `2020-0${month}-01`, month_end: `2020-0${month}-${month === 1 ? 31 : 29}`,
    days_expected: month === 1 ? 31 : 29, days_present: month === 1 ? 31 : 29, complete: true, sample_value: 1.25 });
  add('nasa_power_monthly_features', { location_id: { ...text(), enum: ['synthetic-A', 'synthetic-B'] }, latitude: number(), longitude: number(), year: integer(), month: integer(),
    month_start: date(), month_end: date(), days_expected: integer(), days_present: integer(), complete: { type: 'boolean', 'x-unit': null }, sample_value: number() },
  power, { start: '2020-01', end: '2020-02', months_per_point: 2 }, { key: ['location_id', 'year', 'month'] });
  const vegetationProperties = {}, vegetation = (missing) => {
    const row = {};
    for (const prefix of ['ndvi', 'evi']) {
      for (const stat of ['mean', 'median', 'std']) row[`${prefix}_${stat}`] = missing ? null : 0.1;
      row[`${prefix}_valid_pixel_count`] = missing ? 0 : 5; row[`${prefix}_valid_pixel_percentage`] = missing ? 0 : 50;
    }
    return row;
  };
  for (const prefix of ['ndvi', 'evi']) {
    for (const stat of ['mean', 'median', 'std']) vegetationProperties[`${prefix}_${stat}`] = nullable(number());
    vegetationProperties[`${prefix}_valid_pixel_count`] = integer(); vegetationProperties[`${prefix}_valid_pixel_percentage`] = number();
  }
  add('modis_monthly_features', { month: { ...text(), pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }, observation_count: integer(), total_pixel_observations: integer(), ...vegetationProperties },
    [false, true].map((missing, index) => ({ month: `2020-0${index + 1}`, observation_count: 1, total_pixel_observations: 10, ...vegetation(missing) })),
    { start: '2020-01', end: '2020-02' }, { key: ['month'] });
  add('modis_16day_features', { date: date(), ...vegetationProperties, total_pixel_count: { ...integer(), const: 10 }, base_valid_pixel_count: integer(), quality_valid_pixel_count: integer(),
    vi_usefulness_distribution_before_filter: { ...text(), 'x-content': 'json-count-object' }, vi_usefulness_distribution_after_filter: { ...text(), 'x-content': 'json-count-object' } },
  [false, true].map((missing, index) => ({ date: `${2020 + index}-01-01`, ...vegetation(missing), total_pixel_count: 10, base_valid_pixel_count: 10, quality_valid_pixel_count: missing ? 0 : 5,
    vi_usefulness_distribution_before_filter: '{"0":10}', vi_usefulness_distribution_after_filter: missing ? '{}' : '{"0":5}' })),
  { start: '2020-01-01', end: '2021-01-01', observations_per_year: 1 }, { key: ['date'] });
  for (const [name, codes] of [['crop_annual_features', [1, 5, 999]], ['crop_class_annual_features', [1, 5, 2]]]) {
    const properties = { year: integer(), crop_code: integer(), crop_name: text(), ...(name.includes('class') ? { pixel_count: integer() } : {}),
      area_ha: number(), area_pct: number(), valid_denominator_ha: number(), source: text() };
    add(name, properties, codes.map((crop_code) => ({ year: 2020, crop_code, crop_name: 'SYNTHETIC TEST ONLY', pixel_count: 1, area_ha: 0.09, area_pct: 33.3333,
      valid_denominator_ha: 0.27, source: 'SYNTHETIC TEST ONLY' })), { start_year: 2020, end_year: 2020 },
    { key: ['year', 'crop_code'], validation: { denominator_ha_by_period: { 2020: '0.27' }, percentage_tolerance_percentage_points: '0.000050001' } });
  }
  const transitions = ['Corn', 'Soybeans', 'Other'].flatMap((a) => ['Corn', 'Soybeans', 'Other'].map((b) => ({ year_1: 2020, year_2: 2021,
    transition_type: `${a} -> ${b}`, area_ha: 0.09, area_pct: 11.1111, common_valid_area_ha: 0.81 })));
  add('crop_transition_features', { year_1: integer(), year_2: integer(), transition_type: text(), area_ha: number(), area_pct: number(), common_valid_area_ha: number() }, transitions,
    { year_pairs: [[2020, 2021]] }, { key: ['year_1', 'year_2', 'transition_type'], validation: { denominator_ha_by_period: { '2020->2021': '0.81' }, percentage_tolerance_percentage_points: '0.000050001' } });
  add('soil_mapunit_features', { mukey: { ...text(), pattern: '^\\d+$' }, musym: text(), muname: text(), dominant_texture: nullable(text()), root_zone_aws_0_150cm_mm: nullable(number()) },
    [{ mukey: '001', musym: 'synthetic-a', muname: 'Synthetic "quoted", map unit', dominant_texture: 'synthetic', root_zone_aws_0_150cm_mm: null },
      { mukey: '002', musym: 'synthetic-b', muname: 'Synthetic, map unit B', dominant_texture: null, root_zone_aws_0_150cm_mm: null }], { kind: 'static' }, { key: ['mukey'] });
  add('merra2_monthly_context_features', { date: date(), latitude: { ...number(), const: 42 }, longitude: { ...number(), enum: [-93.75, -93.125] }, SPEED: number(), EVAP: number(), EFLUX: number(), HFLUX: number() },
    [-93.75, -93.125].flatMap((longitude) => [1, 2].map((month) => ({ date: `2020-0${month}-01`, latitude: 42, longitude, SPEED: 1, EVAP: 1e-6, EFLUX: -1, HFLUX: -2 }))),
    { start: '2020-01', end: '2020-02', months_per_cell: 2 }, { key: ['date', 'latitude', 'longitude'] });
  const publish = async () => {
    for (const { entry, schema, rows } of Object.values(definitions)) {
      await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true }); await mkdir(path.dirname(path.join(root, entry.schema_path)), { recursive: true });
      const csv = csvBytes(schema['x-csv'].ordered_columns, rows), json = JSON.stringify(schema);
      await writeFile(path.join(root, entry.path), csv); await writeFile(path.join(root, entry.schema_path), json);
      entry.output_sha256 = hash(csv); entry.source_sha256 = hash(csv); entry.schema_sha256 = hash(json);
    }
    await writeFile(path.join(root, 'data/processed/features/feature_manifest.json'), JSON.stringify(manifest));
  };
  await publish();
  return { root, manifest, definitions, publish, writeManifest: () => writeFile(path.join(root, 'data/processed/features/feature_manifest.json'), JSON.stringify(manifest)),
    forLogicalId: (id) => definitions[Object.keys(FINAL_DATASET_IDS).find((name) => FINAL_DATASET_IDS[name] === id)] };
}
