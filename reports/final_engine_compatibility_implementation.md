# TerraPulse Sprint 9 — Final Engine Compatibility Implementation

Date: 14 November 2026, Africa/Cairo.

## Outcome

Implemented actual contract `1.0.0` support without changing the Engine repository or ingesting into MongoDB. All eight delivered CSV datasets are structurally available through the existing logical IDs. All ten Engine endpoint shapes returned HTTP 200 against actual files, and source-specific filters selected the expected individual records. Scientific validation remains `not_assessed` and recommendations remain disabled.

The implementation reads the actual manifest and referenced schemas, translates descriptors in memory, and preserves the older JSON/NDJSON profile. It does not recreate production schemas, rewrite CSVs, or substitute synthetic fixtures for project data.

## Files created in this sprint

| File | Purpose |
| --- | --- |
| `src/utils/csv.js` | Shared pure CSV tokenizer extracted from the existing MODIS audit implementation; bounded options added. |
| `src/modules/engine/engine.csv.js` | CSV declarations, bounded read, header checks and typed decoding. |
| `src/modules/engine/engine.contract-v1.js` | Actual manifest adapter, explicit eight-dataset mapping, schema agreement and public metadata. |
| `src/modules/engine/engine.contract-query.js` | Final-contract source-specific filters with existing pagination conventions. |
| `src/modules/engine/engine.integrity.js` | Composite keys, missingness, coverage and declared contract arithmetic checks. |
| `scripts/verifyEngineCompatibility.js` | Read-only HTTP verifier using an isolated server and a database stub. |
| `tests/engine.csv.test.js` | Tokenizer, decoding, schema patterns/extensions and histogram string tests. |
| `tests/engine.final-contract.test.js` | Final manifest, integrity, failure cases, roots, filters and optional-data tests. |
| `tests/engine.final-api.test.js` | All ten routes, safe errors, source filters, Scenario compatibility and no-MongoDB verification. |
| `tests/helpers/engine-v1.js` | Isolated synthetic contract generator under the Backend test directory. |
| `tests/fixtures/engine-v1/README.md` | Explicit synthetic-only labeling and preservation boundaries. |
| `reports/final_engine_compatibility_implementation.md` | This report. |

## Files modified relative to the start of Sprint 9

- `src/config/features.js`: separate Engine/features/schema roots with backward-compatible feature defaults.
- `src/config/env.js`: exposes resolved root configuration; actual dotenv precedence retained.
- `src/routes/index.js`: passes all three root options to the existing Engine service.
- `src/modules/engine/engine.service.js`: selects the final adapter, schema root, expected hashes, complete integrity checks, safe metadata and final-contract queries.
- `src/modules/engine/engine.loaders.js`: registers CSV and its bounded document limit; JSON/NDJSON preserved.
- `src/modules/engine/engine.schema.js`: enforces patterns, preserves extensions and validates known histogram string contents.
- `src/modules/engine/engine.manifest.js`: shares the existing public-text validation helper.
- `src/modules/engine/engine.registry.js`: soil source now identifies the audited USDA SSURGO family.
- `scripts/auditModisSource.js`: imports/re-exports the shared tokenizer; its source-specific audit behavior remains covered by existing tests. Its CLI was not run as an audit/ingestion task.
- `tests/env.test.js`: expected configuration includes separate root options.
- `tests/engine.schema.test.js`: valid patterns are supported; malformed pattern remains a rejection case.
- `.gitignore`: ignores only backend-generated synthetic temporary fixture directories.
- `.env.example`: documents optional root configuration; actual `.env` untouched.
- `docs/shared_engine_integration.md`, `docs/engine_dataset_availability.md`, `docs/engine_api_contract.md`: updated implementation, exact configuration, source filters, verification results and scientific limits.

Earlier uncommitted/untracked work was preserved, including Scenario implementation, frontend guidance and historical reports. `src/app.js` already had Engine-service injection from Sprint 8; it was not changed in this sprint. Existing vegetation/importer, Study Area and Dataset modules were not modified.

## Actual CSV adapter

The shared tokenizer implements quoted commas, escaped quotes, quoted newlines, empty cells, UTF-8/BOM and CRLF, with unique unpadded headers and exact widths. It is not a split-on-comma implementation. Actual soil names containing commas and MODIS quoted JSON cells are read correctly.

The adapter reads the actual `x-csv` declarations and property types. Exact `True` and `False` become booleans; empty/`NULL` become null only in nullable fields. Non-nullable nulls fail. String identifiers and calendar strings retain their original representation. Numbers require finite decimal syntax and safe integer values; no rounding, scaling, missing-to-zero conversion or silent coercion occurs. JSON-count histogram columns remain strings and receive separate content checks.

CSV is whole-document parsed under an 8 MiB cap; the actual combined delivery is 217,249 bytes. Record/field bounds, one-million-record cap, 256 MiB dataset source bound and existing page maximum 100 remain enforced. NDJSON still streams, and previous JSON/NDJSON tests pass. No dependency was installed or added.

## Manifest, paths and schema compatibility

The adapter explicitly maps the eight `dataset_name` values to the established backend IDs, retaining authoritative upstream names and contract/hash identity. Unsupported versions fail closed. The manifest is never rewritten.

Separate root settings preserve `TERRAPULSE_FEATURES_ROOT` semantics and do not repurpose `TERRAPULSE_DATA_ROOT`. Known repository-relative output/schema prefixes are resolved inside independently approved directories. Absolute/traversing/encoded references, wrong prefixes and escaping links are rejected. Missing delivery remains nonfatal to Express startup. Legacy profile schema references retain their original features-root-relative behavior.

Original schema extensions are retained internally. Known `x-dataset`, `x-csv`, `x-unit`, `x-content`, properties, required/types/nullability, enums/constants, bounds, pattern and date format are supported. Unknown extensions remain metadata instead of automatically invalidating schemas; unsupported standard assertions still fail closed. This is explicit support for the delivered vocabulary, not a complete general-purpose JSON Schema implementation.

Before availability, every required file/schema and record is checked, including records outside the requested page/filter. Checks include output/schema SHA-256 against the manifest, ordered headers, widths, required fields/types, declared composite key uniqueness, expected count/missingness/coverage and schema/manifest agreement. POWER point calendars, MODIS count/percentage/QA relationships, crop denominators/tolerances/pixel area/transitions, static soil coverage and MERRA-2 cell/month coverage receive contract-specific checks. No source value is corrected.

## Actual eight-dataset results

| Logical ID | Actual Engine dataset | Records | File/schema/records | Scientific |
| --- | --- | ---: | --- | --- |
| `power_monthly` | `nasa_power_monthly_features` | 432 | verified / available | not_assessed |
| `modis_monthly` | `modis_monthly_features` | 108 | verified / available | not_assessed |
| `modis_16day` | `modis_16day_features` | 207 | verified / available | not_assessed |
| `usda_annual` | `crop_annual_features` | 15 | verified / available | not_assessed |
| `usda_crop_classes` | `crop_class_annual_features` | 156 | verified / available | not_assessed |
| `usda_crop_transitions` | `crop_transition_features` | 36 | verified / available | not_assessed |
| `soil_map_units` | `soil_mapunit_features` | 86 | verified / available | not_assessed |
| `merra2_context` | `merra2_monthly_context_features` | 422 | verified / available; optional | not_assessed |

Total: 1,462 original records. All eight actual schema/output hashes matched their declarations. Optional MERRA-2 file/descriptor absence is covered by tests and does not block the required datasets.

## Actual HTTP verification

The standalone verifier starts an owned loopback server with the real `createApp()` routing and actual Engine roots. Its database stub refuses connection access. It returned 200 for:

| Path under `/api/v1/engine` | Verification |
| --- | --- |
| `/datasets` | All eight actual availability definitions |
| `/datasets/power_monthly` | Actual metadata route shape |
| `/climate/monthly` | Actual POWER records and location/year/month selection |
| `/vegetation/monthly` | Actual MODIS monthly records and month selection |
| `/vegetation/16day` | Actual composite records and inclusive date range |
| `/crops/annual` | Actual grouped crops and year/code selection |
| `/crops/classes` | Actual class rows and year/code selection |
| `/crops/transitions` | Actual year-pair/directed-label selection |
| `/soil/map-units` | Actual soil rows and string map-unit lookup |
| `/climate/merra2` | Actual context rows and cell/date selection |

Each source-specific actual filter selected exactly one expected record. Request-ID/envelope behavior, pagination totals, and scientific-unassessed metadata were verified. Record objects were not rewritten. No existing application process was manually stopped/restarted, and no new root setting was persisted to actual `.env`. New routes were verified in an isolated instance, not claimed deployed to a previously started process.

## Tests and regression results

`npm.cmd test -- --test-reporter=spec`: **221 passed, 0 failed, 0 skipped** (192 existing tests plus 29 new tests). The final dot-reporter rerun also exited successfully after the final soil source-label update.

New tests cover version/mapping, quoted comma/escaped quote/UTF-8 handling, booleans, both null tokens, string/date preservation, histogram strings/content, invalid/unsafe numbers, wrong counts/hashes/headers/widths/keys/coverage, schemas, root/link confinement, filters, pagination, optional MERRA-2 absence and HTTP errors. All synthetic files remain isolated in backend-owned temporary test directories; they are never production fallbacks or MongoDB records.

Existing local regressions cover Study Areas, registry/lifecycle behavior, original MODIS models/import-validation/API logic, health, shared middleware and Scenario catalog/preferences. No Atlas integration suite or live project database command was run. The pre-existing npm suite exercises in-memory seed stubs and invokes the ingestion CLI only with an empty data root to assert immediate rejection; no project ingestion/seed task received real inputs or an Atlas connection. The deliberate local connection-failure test remains a failed loopback probe, not an Atlas connection.

`git diff --check` passed. Protected-file comparisons found all 54 baseline files unchanged: all 33 Engine files, actual `.env`, backend seed references and existing vegetation/Study Area/Dataset module files. Engine directory membership also matched: no file was added or removed.

## Exact PowerShell commands

Commands for local tests and repeatable read-only verification:

```powershell
Set-Location -LiteralPath 'C:\Users\SaWa\Desktop\Terrapulse'
npm.cmd test -- --test-reporter=spec
$env:TERRAPULSE_ENGINE_ROOT = 'C:\Users\SaWa\Desktop\terrapulse-engine-main'
node scripts/verifyEngineCompatibility.js
```

Optional explicit directory overrides, preserving the same root boundaries:

```powershell
$env:TERRAPULSE_FEATURES_ROOT = 'C:\Users\SaWa\Desktop\terrapulse-engine-main\data\processed\features'
$env:TERRAPULSE_SCHEMAS_ROOT = 'C:\Users\SaWa\Desktop\terrapulse-engine-main\src\schemas'
```

For normal application startup in that configured shell, use the existing `npm.cmd start` or development process. This normal-start command was not used to replace the user's running server. Process variables are not edits to `.env`; an already-running server needs its normal reload/restart to receive them. `TERRAPULSE_DATA_ROOT` and database credentials remain unchanged.

## Remaining limits and scientific status

- Original upstream source CSVs and supporting evidence documents were missing from the inspected checkout. Delivered hashes and structure are verified, but public metadata correctly reports original-source verification `not_independently_verified`.
- The backend does not independently reconstruct raster masks, raw pixel monthly medians/std, field boundaries, crop-specific effects or scientific methodology. Free-text upstream validation claims are not a scientific certification.
- CSV loading is bounded rather than streaming. Larger future deliveries require an explicitly reviewed limit/adapter change. Standard schema assertions beyond the implemented profile remain unsupported; unknown extensions have no invented semantics.
- JavaScript numbers preserve the observed source numeric values without explicit rounding, but numeric JSON does not preserve lexical formatting such as trailing zeros and arithmetic remains floating-point.
- Existing MongoDB MODIS data is bounding-box AOI data. New Engine MODIS remains separately file-backed with final-contract dataset/hash/grain provenance. No old importer use, date-based merge, schema migration, observation overwrite or registry lifecycle update occurs.
- Root-zone AWS remains null for all 86 soil units; missing MODIS measurements and unresolved crop class labels remain unchanged. Optional MERRA-2 remains supporting context, with original signs/units preserved.
- Scenario scientific evaluation and recommendations remain disabled. No scores, crop sequences, water estimates, soil improvements, productivity predictions or superiority claims were generated. SMAP is not introduced.

## Preservation confirmations

No Engine file, CSV, manifest or schema was modified, added, removed or overwritten. No Engine processing script was executed. Actual `.env` and credentials were untouched; no dependencies were installed.

No live MongoDB/Atlas records were written, deleted or changed. No collections were cleared, no delete/drop operation was issued, and no Dataset lifecycle state was modified. Existing MODIS observations and Study Areas were not altered. All implementation files and permanent changes are confined to the Backend repository.
