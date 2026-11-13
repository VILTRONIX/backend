# NASA POWER preliminary source audit

Audit date: November 13, 2026. Scope: **working snapshot inspection and design preparation only**. The structural/arithmetic audit passed for this fingerprint. This is not scientific approval, dataset readiness, or authorization to ingest.

## Source verification and reproducibility

- Actual inspected file: `C:\TerraPulseData\processed\power\power_monthly_by_location.csv`.
- Application-independent path resolution: `path.join(process.env.TERRAPULSE_DATA_ROOT, 'processed', 'power', 'power_monthly_by_location.csv')`.
- The inherited shell variable was unset. The exact user-supplied root was explicitly assigned to the invoking process only; no alternate directory was guessed and `.env` was not changed.
- File existed, was readable, and was **79,518 bytes**, matching the expected size.
- SHA-256 recalculated: **`59e1e97a477f6d32767f5016da8b02dbd20b45f37ad65e33e65468f35aeff097`**, exactly matching the expected snapshot.
- Source bytes were hashed before and after the full read-only audit and remained identical.
- Actual records: **432**, excluding one header row. Exact ordered schema: **18 columns**.

Reproduce without a database connection:

```powershell
$env:TERRAPULSE_DATA_ROOT = 'C:\TerraPulseData'
node scripts/auditPowerSource.js
```

The standalone auditor prints JSON and has no commit mode, database import, source-write call, or credential loader. Missing/relative roots, unreadable files, malformed CSV, or files above the 20 MiB summary limit fail. It reuses existing pure CSV/date/number helpers without modifying MODIS code. A changed fingerprint makes the audit unsuccessful and is reported as a different working delivery; expected records are never manufactured. `passed=true` means only that this specific snapshot meets the stated structural/arithmetic expectations. The output explicitly includes `ingestionAuthorized=false` and `databaseAccessed=false`.

## Exact schema and observed data types

CSV has text fields on disk; the inferred/validated logical types below describe all parsed records. Column order and case were checked exactly. Blank and explicit NaN/null/NA/N/A tokens are counted separately from invalid numeric tokens. Neither occurred in this snapshot.

| Position | Exact column | Observed logical type | Missing values | Invalid values | Observed range/value |
| --- | --- | --- | ---: | ---: | --- |
| 1 | location_id | string | 0 | 0 | DG001, DG002, DG003, DG004 |
| 2 | latitude | finite number | 0 | 0 | 41.8914 to 42.0222 |
| 3 | longitude | finite number | 0 | 0 | -93.5283 to -93.3144 |
| 4 | year | integer | 0 | 0 | 2017 to 2025 |
| 5 | month | integer | 0 | 0 | 1 to 12 |
| 6 | month_start | YYYY-MM-DD calendar string | 0 | 0 | 2017-01-01 to 2025-12-01 |
| 7 | month_end | YYYY-MM-DD calendar string | 0 | 0 | 2017-01-31 to 2025-12-31 |
| 8 | days_expected | non-negative integer | 0 | 0 | 28 to 31 |
| 9 | days_present | non-negative integer | 0 | 0 | 28 to 31 |
| 10 | complete | Boolean, source token True/False | 0 | 0 | True: 432; False: 0 |
| 11 | T2M_mean | finite number | 0 | 0 | -10.052857142857144 to 25.838709677419356 |
| 12 | T2M_MAX_mean | finite number | 0 | 0 | -4.8689285714285715 to 32.14193548387097 |
| 13 | T2M_MIN_mean | finite number | 0 | 0 | -14.1725 to 20.25741935483871 |
| 14 | PRECTOTCORR_total | finite number | 0 | 0 | 3.71 to 243.85 |
| 15 | PRECTOTCORR_daily_mean | finite number | 0 | 0 | 0.1279310344827586 to 7.866129032258065 |
| 16 | ALLSKY_SFC_SW_DWN_total | finite number | 0 | 0 | 145.65 to 801.48 |
| 17 | ALLSKY_SFC_SW_DWN_daily_mean | finite number | 0 | 0 | 4.698387096774193 to 26.716 |
| 18 | RH2M_mean | finite number | 0 | 0 | 50.251935483870966 to 91.69321428571428 |

These are observed numeric ranges in unspecified source units. They are not unit-dependent plausibility certification or county-wide climate statistics. Infinity/non-finite/non-decimal tokens were checked and none found. The common potential fill values -999 and -9999 were also absent in every measurement column; the authoritative fill-value policy is still required. No source values were converted, rescaled, interpolated, or replaced. An additional numeric ordering check found zero rows violating `T2M_MIN_mean <= T2M_mean <= T2M_MAX_mean`; it does not establish temperature units or scientific accuracy.

## Location and calendar verification

| Location | Latitude | Longitude | Records / unique months | First month | Last month | Complete / incomplete | Expected / present location-days |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| DG001 | 41.8914 | -93.3975 | 108 / 108 | 2017-01 | 2025-12 | 108 / 0 | 3,287 / 3,287 |
| DG002 | 41.8989 | -93.5283 | 108 / 108 | 2017-01 | 2025-12 | 108 / 0 | 3,287 / 3,287 |
| DG003 | 42.0172 | -93.3144 | 108 / 108 | 2017-01 | 2025-12 | 108 / 0 | 3,287 / 3,287 |
| DG004 | 42.0222 | -93.4527 | 108 / 108 | 2017-01 | 2025-12 | 108 / 0 | 3,287 / 3,287 |

- IDs exactly match the four expected locations. All four coordinate pairs are distinct and each is constant across its 108 rows.
- Latitude/longitude are finite and lie within conventional [-90,90]/[-180,180] numeric bounds. The CSV labels its axes separately. No CRS, datum, extraction-grid identity, station identity, or authoritative location dictionary is supplied.
- All locations contain the entire 108-month calendar, in ascending order: no missing, duplicated, or unexpected location-month combinations.
- Each year/month agrees with month_start and the actual last calendar date in month_end. Month lengths, including February 2020 and February 2024, match days_expected.
- All 432 rows declare complete=True and days_present=days_expected. Expected and present counts both sum to **13,148 location-days** across four points, representing the same 3,287 calendar dates per point, not 13,148 distinct dates.
- No absent records, missing values, incomplete flags, or present/expected day mismatches were found. Declared completeness does not prove every daily parameter passed QA; raw daily records were not supplied or inspected.
- As an additional accidental-copy check, none of the six location pairs had a month where all eight measurement values were identical. Distinct values do not prove independent sampling or distinct native grid cells.

No point-in-county containment test was performed or inferred. Numeric coordinate validity and project location IDs do not establish county coverage or spatial representativeness.

## Arithmetic consistency

For each source row, compare the unmodified monthly total with `daily_mean * days_present`. Also compare using days_expected. Absolute tolerance is **1e-9 in unchanged source numeric units**, used only as a floating-point arithmetic tolerance.

| Source parameter | Rows tested / skipped | Maximum absolute difference | Mismatches above tolerance |
| --- | --- | --- | ---: |
| PRECTOTCORR | 432 / 0 | 1.4210854715202004e-14 | 0 |
| ALLSKY_SFC_SW_DWN | 432 / 0 | 5.684341886080802e-14 | 0 |

The expected-day and present-day residuals are identical because every row has equal day counts. Thus this snapshot cannot distinguish which denominator the upstream process would use for an incomplete month. Arithmetic agreement establishes neither the correct physical aggregation nor the units of either radiation/precipitation field. Daily sources, parameter-specific valid-day counts, aggregation code, fill handling, and unit conversions are needed for independent scientific validation. No derived totals or recalculated means were written anywhere.

## Units, missing variables, and scientific limitations

Unit verification status for **all eight measurement columns is unverified**. The inspected `processed/power` directory contains only the CSV; the supplied data root contains only the processed tree, and no README/JSON/Markdown sidecar was found in the delivered tree. The CSV includes neither a unit preamble nor a metadata section. Variable names, numeric ranges, previously reported UTC metadata, and generic NASA defaults cannot prove this derived file's actual units or transformations.

**WS10M is absent.** It was not added, synthesized, or inferred from any other source. The eight actual columns are retained distinctly, including both total and daily-mean fields for precipitation and shortwave radiation. The missing variable is a source-inventory limitation, not a blank cell in the existing schema.

These records are monthly extracts at **four individual point locations**. They are not exact Story County weather averages and cannot be extrapolated to all pixels, fields, or the county polygon. Requested coordinates may differ from native cell centers; this snapshot does not resolve that distinction. There is no county polygon mask, area weighting, interpolation, native-grid-resolution verification, weather-station verification, or POWER/MERRA-2 combination. The observed dates are calendar keys; source observation timezone is unverified. A future GeoJSON Point must wait for CRS/axis documentation rather than silently asserting EPSG:4326.

## Existing architecture inspected and proposed relationship

Reviewed actual Dataset, DatasetAsset, StudyArea, lifecycle/query validation, public DTOs/error envelopes, versioned routing, and MODIS model/service/import workflow.

| Existing implementation | Consequence for POWER preparation |
| --- | --- |
| Dataset in datasets; unique slug and provider/product/version identities | Reference an existing approved registry parent after its relationship is clarified; never duplicate it automatically. |
| DatasetAsset in dataset_assets; unique assetKey; hidden storageUri/metadata | A future approved processed CSV would use this model with its actual checksum/coverage. No asset is registered now. |
| StudyArea supports Polygon/MultiPolygon only | Keep point coordinates in a proposed climate document. Do not create fake StudyAreas or alter county geometry. |
| getReadiness requires active + downloaded + validated + completed | A local working file and structural audit satisfy none of the approval/lifecycle transitions by themselves. |
| Public JSON uses success/data/requestId; errors use error.code/message | Proposed climate contracts retain the envelope, bounded pagination, safe validation, and private-path redaction. |
| MODIS stores immutable, source-linked observations, checks conflicts, and commits only after approved preflight | These are patterns for a future authorized POWER workflow; no importer is implemented or executed here. |
| processedSummaryAvailability currently enforces bounding_box_aoi and false county flags | It is MODIS-specific today. Do not reuse or loosen it to mislabel POWER points as bounding boxes. Any point-summary availability extension needs separate design approval. |

**Registry discrepancy requiring a data-team decision:** checked-in `nasa-power-daily` describes ten daily CSVs at ten locations, reported coverage 2017-01-01 through 2024-12-31, project-reported UTC, and seven target parameters including WS10M. The audited working delivery is one processed monthly CSV, four locations, through December 2025, with no WS10M and unverified timezone. Registry targets are not verified presence; the mismatch is documented, not repaired. Determine whether this is a derived subset/version of that registry parent or merits a separately approved derived-product identity. Do not silently replace the daily metadata with monthly facts.

The checked-in POWER seed defaults are acquisition=reported_available, validation=pending, processing=not_started. Live Atlas state was not queried in this sprint, and no lifecycle state, availability field, model, index, or collection was changed.

Proposed design, documented only in [the API/model draft](../docs/power_api_contract_draft.md): one immutable location-month document with explicit resolution, source references/version checksum, all original calendar/count fields, eight exact-name measurement keys, per-variable unit=null/unverified metadata, original latitude/longitude with CRS unverified, pilot-context-only relationship, and explicit point spatial limitations. A proposed version-scoped unique key prevents duplicates without mixing revised snapshots. No Mongoose schema or new database collection exists for this proposal.

## Questions and dependencies for data engineering

1. Deliver the final approved CSV, its release/version identifier, authoritative checksum, generation time, and explicit approval. This fingerprint describes working data only and may change.
2. Supply original NASA POWER request/response metadata, community/parameter selection, source product versions, extraction dates, and processing code/version. Confirm source attribution and any conversion or rescaling.
3. Provide units for every exported measurement, especially the total versus daily-mean shortwave fields, plus the exact monthly aggregation formulas and incomplete-month denominator policy.
4. Define fill values, null encoding, parameter-specific valid-day counts, QA/filtering policy, and what days_present/complete actually certify. Can a row be complete while one parameter has missing daily values?
5. Provide the location dictionary and coordinate CRS/datum/axis order; are these requested points, cell centers, stations, or another representation? Confirm native grid support and point IDs' stability across deliveries.
6. Reconcile four delivered locations versus ten reported, extension from 2024 to 2025, and the monthly file's relationship to nasa-power-daily. Identify any final requested-location set or changed IDs.
7. Confirm whether WS10M is intentionally excluded, pending, or withdrawn. Do not add it to an approved serving allowlist until a real validated field exists.
8. Decide approved snapshot version selection/supersession and re-import conflict policy. Confirm point-only availability wording; no exact county claims are supported by this delivery.
9. Obtain separate user authorization before database models, indexes, asset registration, ingestion, lifecycle transitions, or climate APIs are implemented.

## Regression and scope verification

The existing backend suite was executed before changes: **131 passed, 0 failed**. Five new source-audit tests cover logical types/schema, incomplete inventories, leap years, completeness/denominators, duplicate location-months, coordinate drift, missing versus invalid values, arithmetic mismatch, explicit roots, fingerprint mismatch, and source immutability. Fixtures are temporary synthetic test records only and never sent to MongoDB.

Final `npm test` execution: **136 passed, 0 failed, 0 skipped**, including all previous 131 tests and the five new POWER source-audit tests. The actual source-audit command exited0 with matching fingerprint, all structural/arithmetic checks passing, no source changes, and databaseAccessed=false. `git diff --check` found no whitespace errors.

Before/after SHA-256 comparisons of all **62 pre-existing workspace files** found zero changes, including existing MODIS implementation/tests/reports, models, routes, registry seed data, README/package files, and private .env configuration. Existing uncommitted Sprint4 changes were already present at the start and were preserved. This sprint added only `scripts/auditPowerSource.js`, `tests/power-source-audit.test.js`, this report, and `docs/power_api_contract_draft.md`.

No live Atlas integration, seed, or import command was run during this preliminary sprint. The default tests use controlled fixtures/local connection-failure checks and require no live Atlas connection. The POWER audit itself has no database connection. No MongoDB documents, collections, indexes, DatasetAssets, or lifecycle states were written. No source file, existing model/route, MODIS functionality, or credential was modified. POWER remains a working snapshot awaiting the data team's final delivery and separate authorization.
