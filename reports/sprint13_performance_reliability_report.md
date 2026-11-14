# Sprint 13 - Performance Optimization and Reliability

Implemented dataset snapshot caching and independent Engine health using the existing loaders and delivered contract 1.0.0. All eight actual datasets remain available; all 1,462 records, ten Engine route shapes and eight dataset-specific filter checks passed. Scientific verification remains not_assessed. Existing comparison data, including historical analytics, matched the prior real-data response exactly.

## Exact changed files

- [README.md](../README.md) - Document the additive Engine health route.
- [docs/engine_api_contract.md](../docs/engine_api_contract.md) - Document snapshot caching, invalidation, bounds and Engine health contract.
- [docs/shared_engine_integration.md](../docs/shared_engine_integration.md) - Document shared startup/verifier configuration and process-local snapshots.
- [scripts/benchmarkEnginePerformance.js](../scripts/benchmarkEnginePerformance.js) - New read-only reproducible benchmark CLI, including uncached reference mode.
- [scripts/verifyEngineCompatibility.js](../scripts/verifyEngineCompatibility.js) - Use the same quiet dotenv/path loader as runtime.
- [src/app.js](../src/app.js) - Share one Engine instance between health, Engine routes and Scenario Comparison.
- [src/config/env.js](../src/config/env.js) - Share module-relative dotenv loading and expose Engine-only path loading.
- [src/modules/engine/engine.files.js](../src/modules/engine/engine.files.js) - Retain metadata-only fingerprint guards without closed file handles/streams.
- [src/modules/engine/engine.service.js](../src/modules/engine/engine.service.js) - Build/use fully validated snapshots, preserve query/error contracts, expose Engine health/internal counters.
- [src/modules/engine/engine.snapshot-cache.js](../src/modules/engine/engine.snapshot-cache.js) - New bounded LRU and per-dataset load/refresh coalescing.
- [src/modules/health/health.routes.js](../src/modules/health/health.routes.js) - Add GET /health/engine without changing live/ready contracts.
- [tests/engine.snapshot-cache.test.js](../tests/engine.snapshot-cache.test.js) - Twenty new cache/invalidation/concurrency/health/configuration tests.
- [reports/sprint13_performance_reliability_report.md](../reports/sprint13_performance_reliability_report.md) - This report.

## Cache architecture

- One Engine service instance is shared by the application health router, Engine API router and Scenario Comparison service. Existing loaders, restricted schema compiler, integrity checks and filtering remain authoritative.
- The manifest has a metadata-checked, coalesced discovery snapshot. Each dataset has its own in-flight load/refresh promise; unrelated datasets do not wait for another dataset's validation. Metadata health/catalog calls and paginated data calls reuse the same dataset snapshots.
- Only a complete successful schema/record/checksum/coverage/integrity validation can produce a retained snapshot. Snapshots consist of private Node V8-serialized metadata and records. Each caller independently decodes the data it uses; response mutation cannot poison the cache. No binary snapshots are written to disk.
- Cached guards are constructed outside parsing scopes and capture metadata only, avoiding retention of parsed record arrays, file handles and read streams through cache closures.
- Retained payload is bounded by 8 entries, 16 MiB serialized buffers and 100,000 total records, with LRU eviction. Internal createEngineService cache options permit bounded tuning or enabled:false reference measurements; no new environment variable, dependency or public cache-control API is introduced.
- The actual complete delivery retains 451,046 bytes of encoded metadata/records across eight entries and 1,462 records. Default comparison loads seven entries, 398,307 bytes and 1,040 source records, while returning the existing 708 selected-period records. With MERRA-2 it returns the existing 828 selected-period records.
- A dataset exceeding capture/admission budgets is not retained. Existing validated page semantics remain available through uncached scanning. Capture overflow can incur an extra validation scan; no data is truncated, partially cached or accepted without validation.
- Analytics remain derived from the existing comparison evidence on each request. No separate analytics/result cache, Redis, worker thread, alternate parser or duplicate validation framework was added.

## Invalidation and atomic publication

Every request checks the manifest metadata; cached dataset access checks the manifest, every referenced schema and every CSV/JSON/NDJSON shard. Fingerprints preserve existing canonical root/target containment plus size, mtimeMs, ctimeMs, inode and device identity. Metadata comparison performs filesystem realpath/stat operations without hashing unchanged content.

1. Unchanged fingerprints reuse the fully verified buffers without reading/parsing CSV bytes, recompiling schemas or calculating SHA-256.
2. A manifest change invalidates dependent entries and triggers a fresh manifest read/hash/adaptation/validation. A schema/data-file change invalidates that dataset before refresh.
3. Changed content undergoes the original SHA-256, schema, record, key, coverage, missingness, QA and denominator safeguards. Touching identical bytes still causes full validation.
4. All source guards are rechecked after validation and serialization. Manifest-generation identity prevents an older in-flight build from publishing over a newer delivery.
5. Publication is one synchronous cache insertion after those checks. Same-dataset concurrent callers await the shared completed refresh, never an old snapshot or an intermediate record list.
6. Missing files, checksum mismatches, invalid schemas and failed refreshes publish nothing. There is no stale-on-error fallback or permanent failure caching. Restoring valid sources permits recovery.

HTTP response envelopes, request IDs, values, provenance, query validation, pagination, Cache-Control:no-store and existing error codes remain unchanged. Cache hits still apply the existing source-specific filters and derive the exact pagination total.

## Benchmark method

Before measurements were captured immediately before implementation; after measurements used the same instrumentation, actual files and five query strings. Each endpoint ran in a fresh isolated Node process with one cold request, ten sequential warm requests, then four concurrent warm requests. Cold means process-cold; OS filesystem caches were not flushed. Loopback elapsed time includes receiving the complete response body, ending before JSON parsing. Small CSV-adapter counters and memory sampling were enabled in both runs. The benchmark database stub forbids database access.

Environment: Node 22.17.1, OpenSSL 3.0.16, Windows x64, Intel i5-10300H with eight logical CPUs and approximately 19.8 GiB RAM. Default record pagination is 20; both comparison requests use 2021-2025, with includeMerra2 absent/false or true. All timed requests returned HTTP 200. Response byte lengths before and after were identical. These samples describe this machine/data delivery, not production capacity or an SLA.

## Before/after latency

| Endpoint | Cold before ms | Cold after ms | Warm median before ms | Warm median after ms | Warm p95 before ms | Warm p95 after ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| /api/v1/engine/datasets | 175.64 | 184.29 | 92.60 | 7.10 | 110.08 | 10.06 |
| /api/v1/engine/climate/monthly | 82.10 | 86.64 | 25.13 | 5.53 | 45.20 | 7.88 |
| /api/v1/engine/vegetation/monthly | 56.11 | 56.76 | 16.12 | 5.19 | 30.34 | 10.85 |
| /api/v1/scenarios/comparison | 274.08 | 211.03 | 162.87 | 24.58 | 174.27 | 34.78 |
| /api/v1/scenarios/comparison?includeMerra2=true | 317.65 | 237.91 | 190.08 | 29.05 | 211.14 | 43.81 |

Cold catalog and individual-dataset requests retain full validation and add snapshot construction, so cold latency is not uniformly lower. Cold comparison improves because later pages reuse datasets already validated during that request. Warm comparison median improves by approximately 85%; every unchanged warm query avoids CSV parsing/validation.

## Four concurrent warm requests

| Endpoint | Median before ms | Median after ms | p95 before ms | p95 after ms | Batch wall before ms | Batch wall after ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| /api/v1/engine/datasets | 216.45 | 12.05 | 218.59 | 12.70 | 219.03 | 13.74 |
| /api/v1/engine/climate/monthly | 70.80 | 15.58 | 71.87 | 16.15 | 72.71 | 17.41 |
| /api/v1/engine/vegetation/monthly | 31.81 | 12.02 | 33.95 | 12.48 | 34.27 | 13.33 |
| /api/v1/scenarios/comparison | 410.19 | 71.24 | 429.24 | 77.87 | 432.37 | 81.35 |
| /api/v1/scenarios/comparison?includeMerra2=true | 483.02 | 85.26 | 495.97 | 92.72 | 499.62 | 98.47 |

Cold concurrent coalescing and atomic-refresh behavior are separately covered by deterministic paused-loader tests. The timed concurrency batches above ran after warming.

## Parsing and validation counts

A CSV parse is one invocation of the existing CSV adapter. Record validations count successful calls through its original record/schema/integrity callback; this measures record-level validation work, not an invented scientific validation status. All current datasets have one CSV file each. Internal dataset/schema/manifest counters also confirm unchanged hits do not repeat validation.

| Endpoint | Cold parses before/after | Cold record validations before/after | Warm parses per request before/after | Warm record validations before/after | Four concurrent parses before/after | Four concurrent record validations before/after |
| --- | --- | --- | --- | --- | --- | --- |
| /api/v1/engine/datasets | 8 / 8 | 1462 / 1462 | 8 / 0 | 1462 / 0 | 32 / 0 | 5848 / 0 |
| /api/v1/engine/climate/monthly | 1 / 1 | 432 / 432 | 1 / 0 | 432 / 0 | 4 / 0 | 1728 / 0 |
| /api/v1/engine/vegetation/monthly | 1 / 1 | 108 / 108 | 1 / 0 | 108 / 0 | 4 / 0 | 432 / 0 |
| /api/v1/scenarios/comparison | 11 / 7 | 2267 / 1040 | 11 / 0 | 2267 / 0 | 44 / 0 | 9068 / 0 |
| /api/v1/scenarios/comparison?includeMerra2=true | 13 / 8 | 3111 / 1462 | 13 / 0 | 3111 / 0 | 52 / 0 | 12444 / 0 |

After the complete cached-catalog run (15 HTTP requests), diagnostics report one manifest read/hash, eight schema validations, eight dataset validations and 1,462 record validations total. Cold plus warm plus concurrent requests together parsed each dataset only once. All ten warm samples for every endpoint had zero CSV scans, zero parsed CSV bytes and zero record validations. Four concurrent warm requests also had zero scans/validations.

## Memory and response sizes

Memory sampling includes both server and loopback client, imported libraries, buffers, serialization and runtime allocations. The observed peak is sampled, not a guaranteed instantaneous maximum. GC was forced before and after each complete endpoint workload. Cache-retention bounds do not cap total RSS, transient parser allocations, active responses or concurrent requests.

| Endpoint | Baseline RSS before/after MiB | Peak RSS before/after MiB | Post-GC heap before/after MiB | Retained snapshot bytes | HTTP body bytes before=after |
| --- | --- | --- | --- | ---: | ---: |
| /api/v1/engine/datasets | 81.21 / 81.13 | 115.55 / 109.72 | 21.90 / 22.81 | 451046 | 33010 |
| /api/v1/engine/climate/monthly | 81.46 / 81.45 | 109.82 / 99.10 | 21.76 / 24.73 | 173358 | 14135 |
| /api/v1/engine/vegetation/monthly | 80.00 / 82.54 | 98.37 / 99.35 | 21.74 / 21.61 | 39021 | 13101 |
| /api/v1/scenarios/comparison | 80.77 / 80.95 | 122.40 / 115.17 | 20.16 / 22.19 | 398307 | 468953 |
| /api/v1/scenarios/comparison?includeMerra2=true | 81.32 / 80.96 | 126.59 / 119.45 | 20.22 / 25.66 | 451046 | 494274 |

Retained heap is somewhat higher in some cached runs; retaining validated snapshots is a deliberate tradeoff, while client/library/JIT/GC noise also affects these short measurements. This is not a heap-soak/leak certification. Encoded snapshot payload, entry count and retained record count are explicitly bounded. The entire source delivery is 217,249 CSV bytes; unchanged requests no longer reread those bytes. No response compression or API payload reduction was introduced.

## Engine health contract and examples

GET /health/engine uses the same snapshots and checks seven mandatory datasets independently from optional MERRA-2. Overall readiness requires available feature/schema directories, accepted contract 1.0.0 and every mandatory dataset structurally ready. Optional MERRA-2 absence/failure is reported in optionalDatasets without making overall Engine readiness false. Global file/schema statuses refer to mandatory datasets; optional statuses are separate. Scientific verification remains not_assessed everywhere.

Healthy HTTP 200 below was captured from the isolated application using all actual delivered datasets. Its request ID belongs to that request. No paths are exposed.

```json
{
  "success": true,
  "data": {
    "status": "ready",
    "ready": true,
    "configuration": {
      "status": "available",
      "source": "engine_root",
      "featureDirectoryAvailable": true,
      "schemaDirectoryAvailable": true
    },
    "manifest": {
      "status": "available",
      "reason": null,
      "contractVersion": "1.0.0"
    },
    "contractVersion": "1.0.0",
    "mandatoryDatasets": [
      {
        "id": "power_monthly",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 432,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "modis_monthly",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 108,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "modis_16day",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 207,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "usda_annual",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 15,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "usda_crop_classes",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 156,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "usda_crop_transitions",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 36,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      },
      {
        "id": "soil_map_units",
        "optional": false,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 86,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      }
    ],
    "optionalDatasets": [
      {
        "id": "merra2_context",
        "optional": true,
        "ready": true,
        "status": "available",
        "reason": null,
        "recordCount": 422,
        "fileIntegrityStatus": "verified",
        "schemaStatus": "verified",
        "scientificVerification": "not_assessed"
      }
    ],
    "fileIntegrityStatus": "verified",
    "schemaStatus": "verified",
    "scientificVerification": "not_assessed"
  },
  "requestId": "c61105d1-6380-4cab-9988-5992bd460bda"
}
```

Missing-root HTTP 503 response example below follows the actual health details returned by the missing-root probe and the tested HTTP envelope. The request ID is a documentation placeholder. Remaining mandatory/optional entries are omitted from this excerpt; the real response always contains seven mandatory entries and one optional entry.

```json
{
  "success": false,
  "error": {
    "code": "ENGINE_NOT_READY",
    "message": "Engine is not ready.",
    "details": {
      "status": "not_ready",
      "ready": false,
      "configuration": {
        "status": "unavailable",
        "source": "engine_root",
        "featureDirectoryAvailable": false,
        "schemaDirectoryAvailable": false
      },
      "manifest": {
        "status": "missing_manifest",
        "reason": "missing_manifest",
        "contractVersion": null
      },
      "contractVersion": null,
      "mandatoryDatasets": [
        {
          "id": "power_monthly",
          "optional": false,
          "ready": false,
          "status": "missing_manifest",
          "reason": "missing_manifest",
          "recordCount": null,
          "fileIntegrityStatus": "not_verified",
          "schemaStatus": "pending",
          "scientificVerification": "not_assessed"
        }
      ],
      "optionalDatasets": [
        {
          "id": "merra2_context",
          "optional": true,
          "ready": false,
          "status": "missing_manifest",
          "reason": "missing_manifest",
          "recordCount": null,
          "fileIntegrityStatus": "not_verified",
          "schemaStatus": "pending",
          "scientificVerification": "not_assessed"
        }
      ],
      "fileIntegrityStatus": "not_verified",
      "schemaStatus": "not_verified",
      "scientificVerification": "not_assessed"
    }
  },
  "requestId": "<request-id>"
}
```

/health/live remains independent process liveness. /health/ready retains its existing MongoDB readiness contract and response shape; it is not silently broadened. Engine health is database-independent and can return 200 while database readiness returns 503. Conversely, a connected database does not make missing Engine files ready. Unit/API tests verify both directions.

## Startup configuration and reproduction

Runtime loadEnv() and verifier loadEnginePaths() now share quiet, module-relative dotenv loading and the existing path resolver. Existing process variables win over .env in both cases. Engine-only verification does not validate/connect MongoDB or print credentials. Runtime retains its existing production environment validation. TERRAPULSE_ENGINE_ROOT resolves the feature/schema directories; existing explicit independent overrides are preserved. No machine-specific path is embedded in runtime or benchmark code.

.env was not edited. Supply the actual absolute Engine root through the launching shell/service environment. The backend deliberately does not discover sibling repositories or change deployment configuration automatically.

```powershell
# Run from the Backend repository; replace the placeholder with the actual mounted Engine directory.
$env:TERRAPULSE_ENGINE_ROOT = '<absolute Engine repository directory>'
node scripts/verifyEngineCompatibility.js
node scripts/benchmarkEnginePerformance.js --no-cache
node scripts/benchmarkEnginePerformance.js
npm.cmd test
# Against a normally launched application:
Invoke-RestMethod http://localhost:5000/health/engine
```

The new benchmark CLI creates isolated GC-enabled worker processes and temporary loopback listeners, writes no source/report files, uses the shared Engine path configuration and prints JSON counters/timings/memory. --no-cache is an uncached reference mode on the current code; the before tables above are the actual pre-implementation measurements, not retrospectively estimated values. A separate run of the new cached CLI passed all five endpoints and independently confirmed zero warm/concurrent CSV parsing.

## Tests and compatibility

The complete npm test suite (invoked as npm.cmd test -- --test-reporter=spec) passed: **275 tests, 0 failed, 0 skipped**, approximately 14.05 seconds. This includes the existing 255 tests and 20 new snapshot/health/configuration tests. All mutation-based tests operate on newly generated synthetic fixtures, never on delivered Engine files, original CSVs or original schemas.

The new tests cover cache misses/hits across filters/pages/catalog calls; result mutation isolation; same-dataset coalescing; independent dataset progress; manifest replacement/removal/corruption; metadata-only schema/CSV changes; schema/output checksum mismatch; invalid changed schemas with matching updated hashes; missing sources; successful and failed atomic concurrent refresh; old manifest-generation rejection; failure repair/retry; entry/byte/record budgets and eviction; oversize fallback; uncached reference mode; invalid queries; seven mandatory/one optional health semantics; shared health/data snapshots; safe missing configuration; unchanged database health; and runtime/verifier precedence.

Real-data verification additionally passed all ten Engine endpoint shapes and all eight source-specific filters with 1,462 source records. The full default-period comparison including optional MERRA-2 and historical analytics was recursively equal to the previous captured data response. Only the new /health/engine endpoint and internal cache/diagnostic methods are additive.

## Remaining limitations

- Cache state is process-local, lost on restart and independent across replicas. It is intentionally not distributed or persisted.
- Unchanged requests still perform metadata operations. Cache page access decodes and filters the record buffer to preserve exact totals, so access is not O(page size) for larger future datasets.
- Metadata-based invalidation assumes a trusted filesystem. Changes that preserve every tracked identity/time/size field can evade it; deploy Engine artifacts read-only and replace/version releases through trusted operations.
- Cache payload/record/entry limits are not a global process-memory or request-concurrency limit. Existing whole-document CSV parsing/input limits and active-response allocations remain relevant.
- Sources that exceed capture budgets stay uncached and may require an extra validation pass. The delivered eight datasets fit comfortably.
- Manifest changes invalidate the dataset set. File changes invalidate the affected dataset; health scans all definitions to report optional failures independently. There is no stale fallback, failure TTL or permanent negative cache.
- Health/source checks are point-in-time observations; they do not certify future filesystem availability or scientific suitability.
- Higher concurrency, long-duration soak behavior, network latency, Atlas connectivity and deployment-platform limits were not certified by this local benchmark.
- No separate analytics cache, scientific calculation change, recommendation, score, MongoDB write, Engine write, dependency installation or .env change was performed.
