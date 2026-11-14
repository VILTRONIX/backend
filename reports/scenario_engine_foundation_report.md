# TerraPulse Sprint 7 — Scenario Engine Foundation

Date: 13 November 2026.

## Implemented functionality

- `src/modules/scenarios/scenario.catalog.js`: three strategy definitions, independent response copies, and explicit foundation readiness.
- `src/modules/scenarios/scenario.validation.js`: reusable `validatePreferenceWeights()` plus `validatePreferenceRequest()` for the HTTP envelope. Validation is independent of scientific data and MongoDB.
- `src/modules/scenarios/scenario.routes.js`: catalog and stateless preference validation endpoints, using the existing JSON envelopes, request IDs, middleware, and `AppError` handling.
- `src/routes/index.js`: mounts the scenario router alongside the existing routes. No existing endpoint contract was changed.

The catalog contains `current_rotation` (current corn-soybean baseline), `water_first`, and `soil_first`. Both alternatives remain strategies with undefined crop sequences. Every definition includes the required ID, name, description, type, objective, evaluation status, and scientific evidence status. Evaluation is `not_implemented`; scientific evidence is `pending_verification`.

## API endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/v1/scenarios` | Three definitions in `data.items`, with capability readiness in `data.readiness`. |
| `POST /api/v1/scenarios/preferences/validate` | Validates `weights`; returns `valid`, `originalWeights`, `normalizedWeights`, and capability readiness. |

Both routes operate without MongoDB. They do not change `/health/ready`, which continues to reflect database readiness. No user/profile architecture exists, so no preferences are persisted. No comparison or recommendation route was added.

## Preference validation examples

Submit an object containing exactly `weights`, with exactly `water`, `soilHealth`, and `productivity`. Each must be a finite number in the inclusive range 0–100. Decimals are supported; totals need not equal 100. At least one weight must be positive.

| Submitted weights: water / soilHealth / productivity | Outcome |
| --- | --- |
| 50 / 30 / 20 | Valid; normalized to 0.5 / 0.3 / 0.2; original values preserved. |
| 5 / 3 / 2 | Valid; same normalized relative importance as 50 / 30 / 20. |
| 1 / 1 / 1 | Valid; approximately one third each, summing to one within floating-point precision. |
| 0 / 100 / 0 | Valid; normalized to 0 / 1 / 0. |
| 0 / 0 / 0 | HTTP 400 `INVALID_PREFERENCES`; detail code `ALL_ZERO`. |
| -1 / 30 / 20 | HTTP 400; `OUT_OF_RANGE` for `weights.water`. |
| 101 / 30 / 20 | HTTP 400; `OUT_OF_RANGE` for `weights.water`. |
| Missing productivity | HTTP 400; `REQUIRED` for `weights.productivity`. |
| String `"50"` for water | HTTP 400; `INVALID_TYPE` for `weights.water`; no numeric coercion. |
| Additional weight criterion | HTTP 400; `UNSUPPORTED_CRITERIA`; unknown names/values are not reflected. |

Errors follow the existing `{success: false, error: {code, message, details}, requestId}` structure, with `details.errors` containing sanitized `field`, `code`, and `message` entries. Shared parser, payload-limit, and CORS errors retain their existing error codes. Successful preference responses use `Cache-Control: no-store`.

## Test results

| Command | Result |
| --- | --- |
| `node --test --test-reporter=spec` | **156 passed, 0 failed, 0 skipped**; includes the existing 136 tests and 20 new scenario tests. |
| `node --test --test-reporter=spec integration/study-areas.check.js integration/datasets.check.js integration/modis.check.js` | **3 passed, 0 failed, 0 skipped**. All existing live suites ran as read-only checks. |
| `git diff --check` | Passed; no whitespace errors. |

New tests are in `tests/scenario.catalog.test.js`, `tests/scenario.validation.test.js`, and `tests/scenario.api.test.js`. They cover the catalog and readiness, response-copy isolation, original-weight preservation, normalization accuracy, fractional/boundary weights, each missing criterion, invalid types and ranges, all-zero rejection, exact allowed keys, safe errors, response envelopes, request IDs, shared middleware, database independence, statelessness, and absent comparison/recommendation routes.

The live MODIS suite verified 315 complete source rows, two assets, existing indexes, existing lifecycle assertions, and unchanged before/after hashes for the relevant collections. The registry suite checked existing dataset/asset APIs, lifecycle filter parity, and preserved documents. The study-area suite checked official county geometry, indexes, API behavior, and read-only intersections. These successful checks establish regression coverage; they do not validate scenario science.

## Documentation

- `docs/scenario_engine_architecture.md`: implemented module boundaries, strategy meanings, preference semantics, capability readiness, future evaluation responsibilities, explainability requirements, and unresolved dependencies.
- `docs/scenario_api_contract.md`: exact request/response examples, accepted criteria/ranges, error codes, middleware behavior, statelessness, and current limitations.

The future explainability design requires metric name/value/unit, source, observation period, spatial scope, calculation method, evidence reference, quality/confidence basis, and limitations. It is an information checklist, not an assumed Data Engine output schema. No scientific adapter, scoring method, model, or placeholder result was implemented.

## Remaining scientific dependencies

1. Final, versioned Data Engineering contracts and verified outputs for applicable MODIS, POWER, and MERRA-2 inputs, including units, periods, footprints, missingness, quality, and provenance.
2. Scientifically defined water, soil-health, and productivity metrics with evidence that the available sources support those metrics at the intended scale.
3. Reviewed alternative interventions/crop sequences and baseline/counterfactual methodology. Strategy names alone cannot define modeled outcomes.
4. Approved methods for temporal/spatial alignment, transformations, uncertainty, weighting, trade-offs, comparison validation, and release criteria.

Existing MODIS bounding-box summaries do not establish exact Story County statistics or intervention effects. NDVI/EVI are not automatically yield or soil-health measurements. Dataset lifecycle readiness remains separate from scientific evaluation readiness. SMAP is out of scope.

## Preservation and scientific integrity

No fabricated agricultural measurements, alternative crop sequences, scenario scores, rankings, superiority claims, or recommendation results were generated. Only preference arithmetic was added.

No MODIS data, NASA POWER data, MERRA-2 data, Dataset lifecycle states, database documents, collections, indexes, or `.env` values were changed. No ingestion or seed command ran. No dependency was added. Existing untracked frontend documentation and the prior Atlas diagnostic report were left untouched. No existing application process was manually stopped or restarted.

Scientific evaluation remains unavailable and recommendation generation remains disabled. The completed foundation is ready for catalog/preference integration, not validated agricultural decision-making.
