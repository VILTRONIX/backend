# TerraPulse Sprint 8 — Shared Data Engine Integration Layer

Date: 14 November 2026, Africa/Cairo.

## Outcome

Implemented a read-only file integration module with configurable roots, a replaceable manifest adapter, eight logical dataset definitions, two format adapters, restricted schema/record validation, bounded pagination/filtering, source provenance, and ten namespaced GET routes.

**Actual Engine delivery remains unavailable.** Inspection found no configured features-root override, no default features directory, no real `feature_manifest.json`, and no individual Engine schemas. The actual-config service reports all eight datasets as `missing_manifest`, with `structurallyReady: false` and scientific verification `not_assessed`. An actual-config record read returned 503 `ENGINE_DATASET_UNAVAILABLE`; the backend created no output directory or substitute files.

The `terrapulse.features/1` manifest envelope is a provisional backend adapter interface verified with explicitly synthetic fixtures, not an assumed final Data Engineering schema. Unknown manifests fail closed. Final-contract agreement remains pending. No agricultural evaluation or recommendation was added.

## Actual files created

| File | Purpose |
| --- | --- |
| `src/config/features.js` | Dedicated features-root configuration and validation. |
| `src/modules/engine/engine.registry.js` | Expected dataset definitions, metadata requirements, route mapping. |
| `src/modules/engine/engine.files.js` | Read-only resolution/opening, containment, bounded documents, hashes/change detection. |
| `src/modules/engine/engine.manifest.js` | Provisional manifest/descriptor and public metadata validation. |
| `src/modules/engine/engine.schema.js` | Restricted record-schema validation and declared filter verification. |
| `src/modules/engine/engine.loaders.js` | JSON/NDJSON adapters and resource controls. |
| `src/modules/engine/engine.query.js` | Pagination and semantic filter validation. |
| `src/modules/engine/engine.service.js` | Discovery, availability, metadata, fully validated paginated reads. |
| `src/modules/engine/engine.routes.js` | Ten read-only Engine endpoints. |
| `tests/engine.config.test.js` | Root/default/override/traversal checks. |
| `tests/engine.schema.test.js` | Supported schema constraints and fail-closed behavior. |
| `tests/engine.service.test.js` | Discovery, loading, filtering, unavailable states, containment, limits, preservation. |
| `tests/engine.api.test.js` | All endpoints, envelopes/errors, offline behavior, existing Scenario compatibility. |
| `tests/helpers/engine.js` | Isolated synthetic fixture copies and guarded temporary-directory cleanup. |
| `tests/fixtures/engine/README.md` | Explicit synthetic-data warning and scope. |
| `tests/fixtures/engine/feature_manifest.json` | Synthetic provisional manifest fixture. |
| `tests/fixtures/engine/record.schema.json` | Synthetic arbitrary-field record schema. |
| `tests/fixtures/engine/samples.json` | Synthetic JSON array fixture. |
| `tests/fixtures/engine/samples.ndjson` | Equivalent synthetic streaming fixture. |
| `docs/shared_engine_integration.md` | Architecture, configuration, interfaces, safety, schema/format scope, dependencies. |
| `docs/engine_dataset_availability.md` | Eight expected datasets, actual absence, statuses, delivery steps. |
| `docs/engine_api_contract.md` | Endpoints, query/error contracts, normalized descriptor profile. |
| `reports/shared_engine_backend_implementation.md` | This implementation and verification report. |

## Actual files modified in Sprint 8

| File | Change |
| --- | --- |
| `.env.example` | Comment documenting the optional `TERRAPULSE_FEATURES_ROOT`; no actual credential/configuration value changed. |
| `src/config/env.js` | Resolves the dedicated variable into `config.featuresRoot`. |
| `src/app.js` | Passes optional injected Engine service to the API router. |
| `src/routes/index.js` | Mounts `/engine` alongside existing modules; preserves Sprint 7 scenario registration. |
| `tests/env.test.js` | Updates expected default configuration for the new root property. |

Prior untracked frontend/scenario documentation, scenario modules/tests, and previous reports were preserved. Existing MongoDB connection, models, Dataset lifecycle, vegetation, and ingestion implementation were not changed. No dependencies or lockfile changes were needed.

## Implemented loader and validation capabilities

- Dedicated `TERRAPULSE_FEATURES_ROOT`; module-relative default `data/processed/features`; existing `TERRAPULSE_DATA_ROOT` untouched.
- Lazy discovery: absence does not prevent Express startup. Bad configured root syntax is rejected without exposing the value.
- Reads only the specified manifest filename. Dataset/schema filenames and formats come from validated descriptors, not unverified constants or extension guesses.
- Each logical definition retains expected purpose/source/optionality; actual manifest metadata and upstream dataset ID are reported separately.
- Multi-file datasets support up to 32 required shards, each with its own declared format and schema. Every required file and record must pass.
- Supported formats: bounded UTF-8 JSON arrays (`json`) and streaming UTF-8 JSON objects per line (`ndjson`). Other formats, including CSV and Parquet, report `unsupported_format` until reviewed adapters exist.
- Structural schema profile supports explicit types/nullability, required properties, closed object records, nested properties/items, enums/constants, numeric bounds, string/array lengths, and asserted calendar dates. Unsupported schemas/keywords/dialects/references fail closed; this is not a full JSON Schema implementation.
- Checks required metadata, declared mapping types, object records, finite values, mapped dates/years/map-unit values, empty files, invalid encoding/JSON, and configured resource bounds. Structural verification never implies scientific approval.
- Inclusive date/year filters and exact map-unit lookup use only manifest-declared top-level fields. No column name, scientific variable, unit, or metric is inferred.
- Filtering precedes pagination; invalid records beyond the page/filter still block results. At most 100 matching records are returned. NDJSON does not accumulate full datasets; JSON has an 8 MiB parsing limit. Source bytes per logical dataset are capped at 256 MiB by default.
- No persistent cache: each request verifies actual current files. Original-byte manifest/file/schema SHA-256 references and source record counts provide provenance.
- Root-confined references reject traversal, drive/ADS/network/encoded paths, and escaping links. Source/manifest/schema changes during a dataset scan invalidate the response. The service neither locks nor rewrites sources; complete immutable publication versions remain an upstream requirement.
- Public responses omit raw paths, configured roots, descriptor extras, and raw parser/filesystem errors. Metadata provenance and limitations are preserved through a whitelist.

Service interfaces are `listDatasets()`, `getDataset(logicalId)`, and `readDataset(logicalId, query)`, with injectable manifest/format adapters. They provide a future Scenario consumption boundary without adding scientific calculations. File, schema, record, and scientific states are distinct.

## Implemented endpoints

All paths below are prefixed by `/api/v1/engine` and use GET:

| Path | Definition |
| --- | --- |
| `/datasets` | Eight expected definitions and availability. |
| `/datasets/:datasetId` | Logical dataset metadata and verification. |
| `/climate/monthly` | `power_monthly` |
| `/vegetation/monthly` | `modis_monthly` |
| `/vegetation/16day` | `modis_16day` |
| `/crops/annual` | `usda_annual` |
| `/crops/classes` | `usda_crop_classes` |
| `/crops/transitions` | `usda_crop_transitions` |
| `/soil/map-units` | `soil_map_units` |
| `/climate/merra2` | Optional `merra2_context` |

Unavailable known datasets have honest metadata responses (200) and unavailable record errors (503). Optional MERRA-2 absence affects only its own availability. Unknown logical IDs return 404; invalid/undeclared filters return 400. Existing JSON envelopes, request IDs, CORS, and safe error handling are retained. No existing MODIS endpoint was replaced.

## Tests and actual results

| Verification | Actual result |
| --- | --- |
| Final full local suite through npm test | **192 passed, 0 failed, 0 skipped**; 156 pre-existing tests plus 36 new Engine tests. |
| Existing Atlas dataset suite | **1 passed**; registry/assets APIs, real indexes, lifecycle filter parity, and unchanged existing dataset/study-area documents. |
| Existing Atlas MODIS suite | **1 passed**; verified 315 complete source rows, two assets, null handling, real indexes, existing lifecycle, and unchanged before/after collection hashes. |
| Existing Atlas Study Areas suite | **1 passed**; official county geometry, real indexes, APIs, intersections, and unchanged county record. |
| Existing running application health | `/health/live` **200**; `/health/ready` **200**. |
| Actual configured Engine discovery/read | Eight `missing_manifest` definitions; record read **503**; default output directory remains absent. |
| Protected-file fingerprint comparison | Six files checked; all before/after SHA-256 values match; none unavailable. Includes actual `.env`, three seed reference files, and both original external MODIS CSVs. Private paths/values/hashes are omitted. |
| Whitespace verification | `git diff --check` passed. Git's LF/CRLF notices are informational. |

The 36 new tests cover required availability/error cases, optional absence, valid and invalid records/schemas/metadata/manifests, all eight record routes, pagination, inclusive mapped filters, exact soil lookup, multiple required shards, unknown formats, invalid query types/operators, lexical and realpath traversal protection, source/schema/manifest changes, UTF-8/CRLF/chunk boundaries, size/count limits, and fixture-byte preservation. Synthetic arbitrary fields are confined to `tests/fixtures/engine` and isolated temporary copies. No synthetic records were inserted into MongoDB.

All pre-existing Scenario tests pass. New offline Engine API tests also confirm Scenario catalog and preference normalization remain functional with no database or manifest. Other existing local tests cover health, error middleware, Dataset Registry, study-area APIs, vegetation APIs, validation, and controlled connection failures.

The live integration files were inspected before running. They issue reads, validation, index inspection, and read-only aggregation; they do not call the ingestion commit function, seed operations, or index creation. Existing local tests exercise seed functions against in-memory fakes and the ingestion CLI's missing-root fail-fast path; no ingestion/seed task was run against actual data.

### Exact final verification commands

Executed from the repository in Windows PowerShell (`npm.cmd` is the Windows npm launcher):

```powershell
npm.cmd test -- --test-reporter=spec
node --test --test-reporter=spec integration/study-areas.check.js integration/datasets.check.js integration/modis.check.js
git diff --check
```

Earlier targeted Engine checks and a full dot-reporter run also passed. The final full run above passed after the final source refinements. Local Node tests required child-process execution outside the process sandbox; they completed without installing packages.

For normal application startup, use the existing `npm start` or `npm run dev`. No application process was manually stopped/restarted by this sprint. New route behavior was verified through real HTTP requests to `createApp()` instances in the integration fixtures; existing-process health was checked separately.

## Missing Engine dependencies and next steps

Final delivery is still needed: actual manifest structure, individual schemas, dataset identifiers, paths, real formats/sizes, field definitions/units, temporal/spatial scope, map-unit identity, null/quality conventions, source provenance/limitations, and publication/version guarantees. The soil provider remains unknown rather than invented. Additional format/schema support must follow review of those artifacts.

The default adapter does not assume or parse an unknown final contract. Agree/adapt the descriptors, test against approved real read-only outputs, and independently review scientific suitability before enabling any Scenario evaluation. Current source-family expectations do not establish the presence or correctness of particular scientific variables. SMAP is excluded.

## Preservation and scientific integrity

No Data Engineering source file, original dataset, Engine output, MongoDB record, collection, index, Study Area, existing MODIS observation, Dataset lifecycle state, or actual `.env` value was modified. No unapproved data was ingested. The file module contains no database operations or filesystem write calls. The new fixtures are explicitly synthetic test mechanics, never production fallbacks.

No crop rotation sequence, agricultural score, water-use estimate, soil-health improvement, productivity prediction, superiority claim, or recommendation was generated. Existing Scenario scientific evaluation remains unavailable and recommendation generation remains disabled.
