# MODIS ingestion and vegetation API verification

Date: November 13, 2026. Status: **PASS** within the approved processed-summary scope.

This report records actual source reads, a non-writing database preflight, two executed Atlas imports, complete stored-value read-back, and live HTTP checks. No synthetic observations were saved. No source files, private credentials, original StudyArea documents, or unrelated Dataset records were changed. No new dependencies were installed; runtime verified with Node 22.17.1 / npm 10.9.2.

## Approved sources and fingerprints

Files are resolved beneath `process.env.TERRAPULSE_DATA_ROOT`; no absolute data-root path is hardcoded in application code or returned by the importer/API. The caller supplied the approved Windows root to the process environment. Both files existed and were readable. Paths below are relative to that private root.

| Source | Bytes | Rows | Columns | First / last period |
| --- | ---: | ---: | ---: | --- |
| `processed/modis/modis_16day_aoi_summary.csv` | 51,686 | 207 | 16 | 2017-01-01 / 2025-12-19 |
| `processed/modis/modis_monthly_aoi_summary.csv` | 17,695 | 108 | 13 | 2017-01 / 2025-12 |

SHA-256 values recalculated from original bytes and matched the approved delivery:

```text
16day  0a2bb581122774e5e6bc69319e1d3758e37c98947f362677098133748719edc7
monthly f411afa54c2d8fee70251958fb73ec50c86dd2cb95325670ead7f9a323579465
```

The exact ordered header arrays are pinned in `src/modules/vegetation/vegetation.constants.js`; schemas and full source quality statistics are also recorded in the earlier [source audit](modis_backend_source_audit.md). Source checksums remained identical through both imports and the final read-only integration check.

## Complete source-to-document mapping

Every field present in either CSV is preserved. Columns absent from a resolution are omitted, rather than synthesized from the other resolution. Six measurement fields accept null; all count/percentage fields are numeric. Histogram fields are parsed JSON objects with non-negative integer counts.

| CSV field | Stored field | Interpretation |
| --- | --- | --- |
| date | periodKey; observationDate | Exact YYYY-MM-DD key; UTC-midnight calendar representation (16day only). |
| month | month; periodKey; observationDate | Exact YYYY-MM retained; first day at UTC midnight (monthly only). |
| ndvi_mean | ndviMean | Original decoded number or null. |
| ndvi_median | ndviMedian | Original number or null, never recalculated. |
| ndvi_std | ndviStd | Original number or null, never recalculated. |
| ndvi_valid_pixel_count | ndviValidPixelCount | Original non-negative integer. |
| ndvi_valid_pixel_percentage | ndviValidPixelPercentage | Original percentage in [0,100]. |
| evi_mean | eviMean | Original decoded number or null. |
| evi_median | eviMedian | Original number or null, never recalculated. |
| evi_std | eviStd | Original number or null, never recalculated. |
| evi_valid_pixel_count | eviValidPixelCount | Original non-negative integer. |
| evi_valid_pixel_percentage | eviValidPixelPercentage | Original percentage in [0,100]. |
| total_pixel_count | totalPixelCount | 16day only. |
| base_valid_pixel_count | baseValidPixelCount | 16day only. |
| quality_valid_pixel_count | qualityValidPixelCount | 16day only. |
| vi_usefulness_distribution_before_filter | viUsefulnessDistributionBeforeFilter | 16day only; complete parsed QA histogram. |
| vi_usefulness_distribution_after_filter | viUsefulnessDistributionAfterFilter | 16day only; complete parsed QA histogram. |
| observation_count | observationCount | Monthly only; original source composite count. |
| total_pixel_observations | totalPixelObservations | Monthly only; repeated pixel-observations. |

Additional provenance fields include the existing dataset/pilot/asset references, `areaGeoid=19169`, opaque `aoiKey=modis-summary-aoi-v1`, resolution, missingDataStatus, source basename/checksum, processingMetadata, importedAt, and internal contentHash. Date storage does not assert a source observation timezone. ImportedAt is preserved on re-import; no update timestamp is added to immutable observations. Internal content hashes verify canonical source values and provenance; they are not public fields.

## Dry-run and source reconciliation

Actual dry-run output (before any writes):

```json
{
  "phase": "dry-run",
  "passed": true,
  "transactionSupport": true,
  "counts": {
    "sourceObservations": 315,
    "newObservations": 315,
    "existingObservations": 0,
    "newAssets": 2,
    "existingAssets": 0,
    "updates": 0
  },
  "spatialScope": "bounding_box_aoi",
  "countyMaskApplied": false,
  "exactCountyStatistics": false,
  "countyCoverageStatus": "unverified",
  "studyAreaRelationship": "pilot_context_only",
  "lifecycleBefore": {
    "acquisition": "request_completed",
    "validation": "pending",
    "processing": "not_started"
  }
}
```

All 315 rows parsed and validated: exact ordered schemas, fingerprints, calendar dates/months, numeric finiteness, non-negative integer counts, percentages and denominators, QA structures/histogram totals/subsets, null consistency, expected date ranges and row counts, and duplicate/order/gap checks. No duplicate periods or missing calendar months were found. All 108 monthly observation counts sum to 207 (99 months contain two source observations and nine contain one).

Independent weighted monthly means reconciled using valid-pixel weights. Maximum absolute differences were **1.1102230246251565e-16 NDVI** and **2.220446049250313e-16 EVI**, below 1e-9 tolerance. Monthly counts and pooled valid-pixel counts matched exactly: 7,778,025 total pixel-observations and 5,919,724 valid pixel-observations for each variable across the complete period. These are repeated observations, not unique spatial pixels. The importer explicitly disables the historical audit's pooled-standard-deviation check; monthly median/std are copied directly without recalculation.

No observation is invented or discarded. Eighteen composite rows retain all six null measurements and zero quality-valid pixels. The existing monthly rows `2019-02` and `2021-01` retain all six null measurements. Other zero counts/percentages remain zero. Empty/NaN measurement markers normalize to null; other invalid numeric values stop validation. No interpolation or additional scale factor is applied.

## Actual imports and registered assets

The command's default execution is a dry-run. Explicit `--commit` repeats preflight and validates existing records before any writes. Transaction support was verified using Atlas's server metadata. Required collection/index setup is explicit and may survive as empty infrastructure if a later transaction fails. Asset/observation upserts, read-back verification, and MODIS lifecycle changes execute together in a majority-write MongoDB transaction; no non-transaction fallback exists.

| Executed import | Previously stored observations / assets | Newly inserted observations / assets | Final observations / assets | Lifecycle updated |
| --- | --- | --- | --- | --- |
| First | 0 / 0 | 315 / 2 | 315 / 2 | Yes |
| Second | 315 / 2 | 0 / 0 | 315 / 2 | No |

Final resolution counts: **207 16day**, **108 monthly**, **315 total**, no duplicate compound identities. Both imports completed with exit code 0 and `commit-and-read-back.passed=true`. All 315 stored source rows and provenance fields matched the originals on full read-back, not merely a sample. Existing different values stop import and report record/field identities without overwriting values or leaking private storage paths. Upserts use immutable `$setOnInsert`; transaction retries repeat conflict checks.

Exactly two processed `CSV` DatasetAssets were registered against `nasa-modis-mod13q1-061`:

| Asset ID | assetKey | Filename | Bytes | Date coverage |
| --- | --- | --- | ---: | --- |
| 6af7430bf919f90724884ff5 | modis-summary-aoi-v1:16day | modis_16day_aoi_summary.csv | 51,686 | 2017-01-01 through 2025-12-19 |
| 6af7430bf919f90724884ff7 | modis-summary-aoi-v1:monthly | modis_monthly_aoi_summary.csv | 17,695 | 2017-01 through 2025-12 |

Each stores its matching checksum above, variables NDVI/EVI, exact source headers, resolution, spatial flags, actual coverage, processed/validated/completed metadata, private local storage reference, and unknown source timezone/CRS. No raw NetCDF asset was registered. Public asset DTOs omit storageUri and private metadata.

## Actual MongoDB collections and indexes

Observations use `vegetation_observations`; assets use existing `dataset_assets`; lifecycle/summary availability use existing `datasets`. Existing `study_areas` is referenced only as pilot context and was not updated. Direct `listIndexes()` reads verified:

| Collection | Index name | Actual key definition | Unique |
| --- | --- | --- | --- |
| vegetation_observations | _id_ | `{ _id: 1 }` | MongoDB identity |
| vegetation_observations | vegetation_source_period_unique | `{ datasetId: 1, aoiKey: 1, resolution: 1, periodKey: 1 }` | true |
| vegetation_observations | vegetation_area_resolution_date | `{ studyAreaId: 1, resolution: 1, observationDate: 1 }` | false |
| vegetation_observations | vegetation_geoid_resolution_period | `{ areaGeoid: 1, resolution: 1, periodKey: 1 }` | false |
| dataset_assets | _id_ | `{ _id: 1 }` | MongoDB identity |
| dataset_assets | dataset_asset_key_unique | `{ assetKey: 1 }` | true |
| dataset_assets | dataset_asset_dataset_type | `{ datasetId: 1, assetType: 1, _id: 1 }` | false |

Existing Dataset and StudyArea unique/geospatial indexes were also verified by their unchanged opt-in integration suites. No indexes were dropped.

## Lifecycle, scientific scope, and preservation

Only MODIS validation/processing and processed-summary availability changed. Acquisition remained `request_completed`; validation changed pending -> validated; processing changed not_started -> completed. Descriptions/evidence explicitly scope completion to the approved processed summaries, not raw satellite processing. Overall dataset readiness remains false with blocker `acquisition_not_downloaded`. Existing county spatial coverage remains `unknown`; separate summary availability is `available` with county coverage explicitly `unverified`.

Every stored observation and vegetation success response includes:

```json
{
  "spatialScope": "bounding_box_aoi",
  "countyMaskApplied": false,
  "exactCountyStatistics": false,
  "countyCoverageStatus": "unverified",
  "studyAreaRelationship": "pilot_context_only"
}
```

Story County ID `6af71070cca3d14ecfec0aed` / GEOID `19169` is pilot context only. No footprint is inferred, no county polygon is reused as an AOI mask, and no exact spatial containment is asserted. NASA product MOD13Q1.061, native 250 m resolution, already decoded dimensionless indices, Pixel Reliability = 0 / MODLAND QA bits 0-1 = 0 are preserved as user-provided processing provenance. Raw QA, raw product availability, CRS, scaling history, and exact AOI geometry remain independently unverified. These area summaries cannot render pixel-level maps.

Canonical document SHA-256 comparisons proved original data preservation before/after ingestion:

| Protected data | Same hash before and after |
| --- | --- |
| Complete StudyArea collection | 8386542f9bbdf40f2432926af41022e5a9bbb2bb44e4df6e00ce715e77256a1d |
| Other seven complete Dataset documents | f559de8d3fa0f53010985773a5dfaf7b40cfd0b946ccd9e4646a0ff15f32211d |
| MODIS identity/acquisition/spatial+temporal coverage/source/variables/createdAt/active flag | 1ced6693dbc1a1bded271a61a055e7bb0d7a8846d38ad84ac22d58ac9af9ce01 |

Complete collection hashes also matched before and after the second import, including IDs, timestamps, source QA, private asset metadata/storage references, and lifecycle fields:

```text
datasets                0f1f9e7f001104e116cf1ecc4c35edc327e192597d513265b7715701c6ac9489
vegetation_observations 76204f6a78c8c927e79a0fbf069cadd2cab39af98542e2f5666b0ad71168ad37
dataset_assets          a663ff262e0a18a0fdacf893c3b8abae8e02f0e02d4e8f0b4324fc175153abe9
```

## API contracts and test results

All three routes use the existing success/error envelope and request IDs:

- `GET /api/v1/observations/vegetation`: areaId/geoid/resolution, inclusive startDate/endDate, bounded page/limit, stable period ordering, source measurements/counts/QA/null status, metadata.
- `GET /api/v1/observations/vegetation/summary`: explicitly required resolution; record/valid/missing counts, selected period range, missing periods, pixel coverage, source metadata, limitations. Unweighted averages/min/max are labeled as statistics across period-level means, not pixel extrema. Nulls are ignored; no-data/empty selections return null statistics.
- `GET /api/v1/observations/vegetation/:date`: exact YYYY-MM-DD lookup for default16day or YYYY-MM with resolution=monthly; monthly key retained.

Full query rules, commands, limitations, and examples are in the [README](../README.md#modis-ingestion-and-vegetation-apis-sprint-4). Every vegetation success includes NASA/product/native resolution, temporal resolution, area-summary scope, all spatial flags, missing-data limitations, and rasterRenderingSupported=false. Public payload checks verified no private storage URI, internal contentHash/evidence, filesystem path, or credentials were exposed.

Executed verification:

| Command | Actual result |
| --- | --- |
| npm test | 131 passed, 0 failed; earlier 117 regression tests preserved. |
| npm run test:integration | 1 passed, 0 failed; real inside/outside/boundary intersection and county indexes. |
| npm run test:datasets:integration | 1 passed, 0 failed; registry APIs/indexes, truthful post-import lifecycle, readiness parity, preservation. |
| npm run test:modis:integration | 1 passed, 0 failed; all 315 source values, exactly2 assets, no duplicates, index definitions, source provenance, API pagination/filter/date/summary/errors/nulls, unchanged read-only collection hashes. |
| npm run ingest:modis:dry-run | Passed all source/database gates, no writes. |
| npm run ingest:modis (twice) | First315/2 inserts, second0/0 inserts; all values and stored hashes verified. |
| git diff --check / Git exclusions | No whitespace errors; .env/CSV/NetCDF/raster files excluded, no source CSVs or .env tracked. |

Restricted test-worker launches initially returned Windows `spawn EPERM`; affected commands were rerun successfully with worker permission. A new integration assertion initially mistook HTTPS `s:/` for a Windows drive path; its pattern was corrected and the complete check then passed. These were execution/test-check issues, not failed or partial database imports.

## Re-import and remaining limitations

Set `TERRAPULSE_DATA_ROOT` to the approved accessible root and keep the existing private Atlas connection configured. Run `npm run ingest:modis:dry-run`, then `npm run ingest:modis` only for this approved delivery. Unchanged deliveries are safe to repeat and preserve existing IDs/timestamps. Source hash/size/schema/value or index conflicts must be reviewed; no force overwrite or cleanup/delete mode exists. Atlas transactions and sufficient collection/index permissions are required. Full live verification uses `npm run test:modis:integration` with the same data root.

No remaining blocker for the approved summary scope. Remaining scientific/product limitations are exact county masking/unknown AOI geometry, raw NetCDF/QA verification, unknown source CRS/timezone, missing winter observations, and no pixel-level rendering. There is no ingestion API, authentication, raster pipeline, rotation scoring, or agricultural formula in this sprint. Other dataset modules remain unimplemented beyond their existing registry entries.
