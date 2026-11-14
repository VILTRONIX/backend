# Engine API ? final contract 1.0.0

Base: `/api/v1/engine`. The same ten GET endpoints, response/error envelopes, request IDs, CORS/security middleware and `Cache-Control: no-store` behavior are retained. All data access is read-only.

| Path | Logical ID | Final-contract filters |
| --- | --- | --- |
| `/datasets` | All eight | No queries |
| `/datasets/:datasetId` | Backend logical ID | No queries |
| `/climate/monthly` | `power_monthly` | `location_id`, `year`, `month` (1?12) |
| `/vegetation/monthly` | `modis_monthly` | `month` (`YYYY-MM`) |
| `/vegetation/16day` | `modis_16day` | `startDate`, `endDate` (`YYYY-MM-DD`) |
| `/crops/annual` | `usda_annual` | `year`, `crop_code` |
| `/crops/classes` | `usda_crop_classes` | `year`, `crop_code` |
| `/crops/transitions` | `usda_crop_transitions` | `year_1`, `year_2`, `transition_type` |
| `/soil/map-units` | `soil_map_units` | `mukey`; `mapUnit` alias retained |
| `/climate/merra2` | `merra2_context` | Date range, `latitude`, `longitude` |

Every record endpoint accepts `page` (default 1, maximum 10000) and `limit` (default 20, maximum 100). Filtering precedes pagination, preserving source-file/source-record order. POWER, both MODIS routes, annual/class crops and MERRA-2 also accept `year`, `startYear`, `endYear` where applicable. Year extraction from MODIS/MERRA-2 calendar strings changes no record. Exact year cannot be combined with a year range. Transitions require explicit pair filters; soil has no observation-year filter.

POWER and MERRA-2 accept inclusive date ranges with either month precision or day precision. Both bounds must use the same precision. Comparison uses the existing period label (`month_start` / first-of-month `date`), not invented daily data or interval-overlap calculations. MODIS monthly accepts month precision only; MODIS 16-day accepts day precision only. Dates must be real calendar values and start must not follow end.

`mukey` stays a string with leading zeros; conflicting `mukey`/`mapUnit` values fail. Crop codes are positive safe integers. Supplied transition years must be four digits and consecutive when both are present. Coordinates must be finite decimals within latitude/longitude bounds. Transition labels compare exactly, including spaces around the arrow. Filters are ANDed. Unknown keys/operators, repeated arrays/objects, invalid values and inappropriate filters return 400 `INVALID_ENGINE_QUERY`.

## Example requests

```text
/api/v1/engine/climate/monthly?location_id=DG001&year=2020&month=2
/api/v1/engine/vegetation/monthly?month=2019-02
/api/v1/engine/vegetation/16day?startDate=2020-01-01&endDate=2020-12-31
/api/v1/engine/crops/annual?year=2021&crop_code=1
/api/v1/engine/crops/transitions?year_1=2021&year_2=2022&transition_type=Corn%20-%3E%20Soybeans
/api/v1/engine/soil/map-units?mukey=<actual-string-key>
/api/v1/engine/climate/merra2?startDate=2020-01&endDate=2020-12&latitude=42&longitude=-93.75
```

## Responses and metadata

Record success: `{success: true, data: {dataset, items, pagination: {page, limit, total, totalPages}}, requestId}`. IDs match `X-Request-ID`. Numeric/boolean CSV cells follow actual schema types. Identifier/date/JSON-content strings remain strings. Empty/NULL values become null only in nullable properties. No rounding, rescaling, imputation or conversion of dates/histograms occurs. JSON numbers do not retain lexical formatting such as trailing zeros; hashes identify original bytes.

`GET /datasets` returns `data.manifest` plus all eight definitions in `data.items`. Final delivery metadata identifies `sourceContractVersion: "1.0.0"`, `finalContractAgreement: "supported"`, and internal `adapterProfile: "terrapulse.features/1"`. The earlier normalization contract remains supported without being misidentified as the final Engine version.

`GET /datasets/:datasetId` returns one known definition, including unavailable ones. `datasetId` remains the backend logical ID; `engineDatasetId` separately identifies the original dataset name. Metadata includes expected source/provider/purpose/optionality, availability reason, separate file/schema/record/scientific verification, structured county/coverage/grain/key/nullability information, field types/units/descriptions, CSV declarations, supported filters, schema warnings and source transformation/checksum information.

Success provenance includes manifest SHA-256 and per-file ID/format/output SHA-256/schema SHA-256/count. `originalSourceVerification` is `not_independently_verified`. Full schema extensions remain internal. Public metadata omits raw source/schema/evidence paths, configured roots, private extras and parser/filesystem errors. Unknown `x-*` metadata remains an annotation, not an invented assertion; unsupported standard assertions still fail closed.

| Condition | HTTP / code |
| --- | --- |
| Known unavailable metadata | 200, explicit status/reason |
| Unknown logical ID | 404 `ENGINE_DATASET_NOT_FOUND` |
| Invalid/unsupported query | 400 `INVALID_ENGINE_QUERY` |
| Unavailable/failed record source | 503 `ENGINE_DATASET_UNAVAILABLE` |

Record error: `{success: false, error: {code, message, details: {datasetId, status, reason, optional, verification}}, requestId}`. Safe reasons distinguish contracts, references, missing files/schemas, hash/header/type/key/count/missingness/coverage/arithmetic failures, limits and source changes. Invalid raw inputs are not reflected. Empty source files fail; zero filter matches from a valid source return an empty page.

## Scientific and backward compatibility

`structurallyReady` never means scientific readiness. `verification.scientific` remains `not_assessed`. The backend does not independently reproduce source originals, exact raster masking or monthly medians/std. MERRA-2 remains optional. Existing health, registry, study-area, Scenario and `/api/v1/observations/vegetation` behavior remains separate. Engine MODIS is file-backed with independent contract/hash/methodology provenance; no records are merged by date or written to MongoDB. No score or recommendation endpoint was added.

See [configuration and architecture](shared_engine_integration.md) and [availability results](engine_dataset_availability.md).

## Sprint 13 snapshots and source changes

The record/catalog response contracts, pagination, filters, original values, request IDs, `Cache-Control: no-store` and scientific statuses are unchanged. The application, Engine health and Scenario Comparison share one Engine service instance.

Completely validated datasets are retained as private Node V8 buffers. Callers receive independently decoded metadata/records, so mutating one result cannot change later requests. Same-dataset concurrent loads/refreshes share a promise; different datasets load independently. The parsed manifest also has a shared metadata-checked discovery snapshot.

Every access checks canonical roots/targets and file identity, size, modification time and change time for the manifest, referenced schemas and all source shards. Unchanged metadata avoids new SHA-256 calculation, schema compilation and record validation. A detected manifest change clears dependent snapshots. A schema/data change invalidates that dataset; full SHA-256/schema/record/integrity validation runs before atomic publication. Errors are never retained as valid snapshots, and no stale fallback is served. Existing path-containment and checksum safeguards remain active.

Default retained-cache bounds are eight entries, 16 MiB of binary payload and 100,000 records. Entries use LRU eviction. These are cache-retention bounds, not a total process RSS limit; loader/input limits and transient request allocations still apply. A dataset exceeding snapshot capture/admission limits remains readable through uncached validation rather than weakening validation or changing page semantics. Capture-overflow fallback may require an extra validation scan. Trusted read-only Engine mounts remain required because metadata-preserving tampering is outside metadata-based invalidation guarantees.

Internal `createEngineService({cache: {enabled, maxEntries, maxBytes, maxRecords}})` options allow bounded tuning or uncached reference measurements. No public query or new environment variable controls the cache. `getCacheStats()` is internal diagnostics used by tests/benchmarking; it contains counters and retention sizes, with no paths. It is not a new HTTP endpoint. Analytics continue to calculate from the existing validated comparison evidence and have no independent result cache.

## GET /health/engine

This additive, MongoDB-independent endpoint uses `Cache-Control: no-store`. Existing `/health/live` and `/health/ready` contracts are unchanged; the latter continues to represent database readiness.

Ready response: HTTP 200 with `{success: true, data: <engine health>, requestId}`. Not ready: HTTP 503 with `{success: false, error: {code: "ENGINE_NOT_READY", message: "Engine is not ready.", details: <engine health>}, requestId}`. Request IDs match `X-Request-ID`. No configured roots, file references, credentials or raw filesystem errors are exposed.

| Engine health field | Meaning |
| --- | --- |
| `status`, `ready` | `ready`/true or `not_ready`/false. Requires existing feature/schema directories, supported contract 1.0.0 and all seven mandatory datasets structurally ready. |
| `configuration` | `available`/`unavailable` status, safe source enum (`engine_root`, `independent_roots`, `backend_defaults`) and feature/schema directory-availability booleans. No paths. |
| `manifest` | Safe status/reason and accepted contract version, or null when no supported manifest is available. |
| `contractVersion` | Accepted source version, currently `1.0.0`, or null. |
| `mandatoryDatasets` | Seven entries, each with ID, optional=false, ready flag, status/reason, verified record count or null, file integrity, schema and scientific statuses. |
| `optionalDatasets` | The MERRA-2 entry with the same fields and optional=true. Missing/invalid optional MERRA-2 does not fail overall readiness. |
| `fileIntegrityStatus` | `verified` when every mandatory dataset completed validation; otherwise `not_verified`. Per-dataset failures distinguish failed versus not-yet-verified integrity. |
| `schemaStatus` | `verified` when all mandatory schemas verified; otherwise `not_verified`. Individual entries retain verified/failed/pending schema status. |
| `scientificVerification` | Always `not_assessed`; structural readiness does not enable scientific evaluation or recommendations. |

The healthy delivered source counts are POWER 432, monthly MODIS 108, 16-day MODIS 207, annual grouped crops 15, crop classes 156, transitions 36, soil map units 86, and optional MERRA-2 422. Engine health checks source metadata on each call and benefits from the same validated snapshots as data routes. See [Sprint 13 report](../reports/sprint13_performance_reliability_report.md) for actual HTTP examples and before/after measurements.
