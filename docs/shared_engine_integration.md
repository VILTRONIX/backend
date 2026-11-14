# Shared Data Engine integration ? Sprint 9

Contract `1.0.0` is supported through an in-memory adapter. The Engine manifest, schemas and CSVs remain unchanged. Earlier `terrapulse.features/1` manifests and JSON/NDJSON adapters remain supported. No MongoDB ingestion or scientific evaluation is performed.

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `TERRAPULSE_ENGINE_ROOT` | Absolute local Engine repository | Unset |
| `TERRAPULSE_FEATURES_ROOT` | Approved feature directory containing the manifest | `<ENGINE_ROOT>/data/processed/features`, or Backend equivalent |
| `TERRAPULSE_SCHEMAS_ROOT` | Approved final-contract schema directory | `<ENGINE_ROOT>/src/schemas`, or Backend equivalent |

Existing `TERRAPULSE_DATA_ROOT` keeps its meaning. Actual `.env` was not modified. Roots reject relative paths, traversal, null bytes, encoded paths, network/UNC roots and filesystem roots. Missing deliveries remain nonfatal to Express startup; malformed configuration is rejected.

Contract 1.0.0 references are repository-relative. The adapter verifies the `data/processed/features/` or `src/schemas/` prefix, then resolves the relative suffix inside its separately approved root. Realpath containment also rejects escaping symlinks/junctions. It never enables unrestricted `../`. Independent overrides support approved relocated directories. Legacy manifests retain features-root-relative schema/file behavior.

### PowerShell commands

```powershell
Set-Location -LiteralPath 'C:/Users/SaWa/Desktop/Terrapulse'
$env:TERRAPULSE_ENGINE_ROOT = 'C:/Users/SaWa/Desktop/terrapulse-engine-main'
node scripts/verifyEngineCompatibility.js
```

Optional independent overrides:

```powershell
$env:TERRAPULSE_FEATURES_ROOT = 'C:/Users/SaWa/Desktop/terrapulse-engine-main/data/processed/features'
$env:TERRAPULSE_SCHEMAS_ROOT = 'C:/Users/SaWa/Desktop/terrapulse-engine-main/src/schemas'
```

Use the existing `npm.cmd start` or development process from the configured shell. A running process does not inherit later environment changes. No user server was manually stopped/restarted. Runtime and verifier now share module-relative quiet dotenv loading and Engine path resolution; existing process variables take precedence. The verifier only consumes the resolved Engine paths, prints no credentials, creates its own temporary loopback HTTP server, and uses a database stub that forbids MongoDB access. Set `TERRAPULSE_ENGINE_ROOT` through the launching shell or deployment environment; no machine-specific discovery or `.env` edit is performed by the backend.

## Modules and consumption boundary

| Module | Responsibility |
| --- | --- |
| `src/config/features.js` | Repository/features/schema root resolution |
| `engine.contract-v1.js` | Versioned manifest translation and schema/metadata agreement |
| `engine.csv.js` | Bounded UTF-8 CSV loading and typed decoding |
| `src/utils/csv.js` | Shared pure tokenizer, reused by the existing MODIS audit utility |
| `engine.schema.js` | Delivered schema assertions and extension preservation |
| `engine.integrity.js` | Keys, missingness, coverage and contract-specific arithmetic |
| `engine.contract-query.js` | Dataset-specific final-contract filters |
| Existing Engine service/files/router | Read-only files, hashes, complete scans and existing API envelopes |

`createEngineService({engineRoot, featuresRoot, schemasRoot})` exposes `listDatasets()`, `getDataset(logicalId)` and `readDataset(logicalId, query)`. Query values use HTTP strings. Manifest/format adapters remain injectable; no record persistence is introduced. File/schema/manifest changes during a scan invalidate the response. Publication should use complete immutable versions: this is not a transactional filesystem snapshot.

## CSV and schema rules

The tokenizer supports quoted commas, escaped double quotes, embedded newlines, UTF-8/BOM, CRLF and empty cells. It rejects malformed quoting, duplicate/padded headers and inconsistent widths. The CSV adapter checks ordered header equality against the actual `x-csv` declaration and properties.

- Exact `True`/`False` use the declared boolean map; string truthiness is never used.
- Empty and `NULL` become null only in nullable properties; other null tokens fail.
- String IDs and calendar strings remain strings, including leading zeros and original date precision.
- Number tokens require finite decimal syntax. Integers must be safe integer tokens; unsafe integer-valued numbers also fail.
- No rounding, scaling, interpolation, date rewriting or replacement with zero occurs.
- Histogram JSON remains a string. Its count-object content is independently validated.

CSV and JSON documents have an 8 MiB limit each. CSV uses bounded whole-document parsing; NDJSON remains streamed in 64 KiB chunks. Other defaults: manifest 1 MiB, schema 256 KiB, record/field 1 MiB, total dataset source bytes 256 MiB, one million records, at most 32 shards and page size at most 100. Oversized input fails rather than truncating. Every required record is checked before a validated snapshot is published. Sprint 13 adds a private process-local LRU snapshot cache bounded by eight entries, 16 MiB of serialized payload and 100,000 retained records; no disk cache is created. Unchanged requests check manifest/schema/data metadata fingerprints instead of reparsing and rehashing bytes. Changes invalidate snapshots and trigger full validation; failures never fall back to stale data. See [the Engine API contract](engine_api_contract.md) and [Sprint 13 measurements](../reports/sprint13_performance_reliability_report.md).

The restricted schema checker supports delivered properties/required/types/nullability, enums/constants, bounds, lengths, nested objects/arrays, patterns and calendar-date format. `x-*` metadata is retained. Known CSV/dataset/unit/content extensions are interpreted explicitly; unknown extensions remain annotations without invented validation semantics. Unsupported standard assertions still fail closed. This is not a complete JSON Schema validator and it never fetches remote references.

## Integrity and scientific limits

Availability requires matching original-byte output/schema SHA-256 values, exact headers/widths, valid values, declared key uniqueness, counts, missingness, coverage and schema/manifest agreement. Contract-specific checks cover POWER calendars/point coverage; MODIS null/count/percentage/QA relationships and temporal coverage; crop denominators, percentages, pixel area and directed year-pair groups; static soil attributes; and separate MERRA-2 cells/monthly coverage. Crop percentages use declared tolerance; floating sums use a machine-roundoff allowance. Source values are never corrected.

Metadata exposes units, grain, structured coverage, keys, nullability, warnings, supported filters and hashes. Full schema extensions remain internal; private filesystem paths and descriptor extras are not published. Original upstream source verification is explicitly `not_independently_verified`: source originals/supporting evidence were absent in the inspected checkout. Structural success does not independently establish raster masking, scientific correctness or reconstructed monthly medians/std.

## MODIS coexistence

Legacy MongoDB observations retain bounding-box scope, `aoiKey: modis-summary-aoi-v1` and original checksums through `/api/v1/observations/vegetation`. Engine MODIS remains file-backed through `/api/v1/engine/vegetation/...`, with separate dataset names, contract version, manifest/schema/output hashes and declared county pixel-center methodology. The old importer/model/documents are not used or changed. No date-based merge occurs. Scenario scientific evaluation and recommendations remain disabled.

See [API contract](engine_api_contract.md), [availability](engine_dataset_availability.md), and [implementation report](../reports/final_engine_compatibility_implementation.md).
