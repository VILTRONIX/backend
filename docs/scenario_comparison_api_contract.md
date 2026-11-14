# Scenario comparison API - Sprints 11-12

`GET /api/v1/scenarios/comparison` organizes the delivered Engine contract 1.0.0 data into the three existing scenario priorities. It is a read-only, database-independent evidence comparison. It does not estimate alternative management outcomes or apply preference weights. Existing catalog and preference responses are unchanged.

Sprint 12 adds the backward-compatible `data.descriptiveAnalytics` section. All existing evidence fields and request conventions are retained. Annual climate, independent MODIS resolutions, crop changes and unweighted soil summaries are documented in [Historical analytics methodology](historical_analytics_methodology.md), including formulas, units, missingness and denominators. Existing per-month MODIS statistics and source QA are reused rather than duplicated.

## Request

| Query parameter | Default | Validation |
| --- | --- | --- |
| `startYear` | `2021` | One four-digit year string, numeric value 1-9999. |
| `endYear` | `2025` | One four-digit year string, numeric value 1-9999; must be at least `startYear`. |
| `includeMerra2` | `false` | Exactly `true` or `false`, case-sensitive. |

Unknown parameters, repeated parameters, arrays, empty values, decimal years, and inverted periods return HTTP 400 with `INVALID_COMPARISON_QUERY`. An omitted year receives its own default, so `startYear=2026` alone is invalid because the default end is 2025. Existing Engine year validation is reused.

Examples:

```text
GET /api/v1/scenarios/comparison
GET /api/v1/scenarios/comparison?startYear=2022&endYear=2023&includeMerra2=true
```

Both year boundaries are inclusive. Monthly and composite records use the Engine's declared year mappings without changing their original dates. A transition is selected only when both `year_1` and `year_2` are inside the period; a one-year request consequently has no consecutive-year transitions. Static soil records are always included and receive no invented observation year. Coverage is not clipped to the request: an out-of-coverage selection has empty temporal arrays and explicit selection metadata, while soil context remains available.

The comparison assembles all selected records through the existing validated, paginated Engine service. It has no public pagination parameters. Its internal limit is 10,000 fetched records across datasets, including transitions inspected before year-pair filtering. This bounds an MVP response; the current delivery is below the limit. Existing `/engine` routes remain available for dataset-specific pagination and filters. The same configured Engine instance and existing root configuration are reused; this endpoint introduces no new environment variable.

## Successful response

HTTP 200, `Cache-Control: no-store`, and the existing envelope `{success: true, data, requestId}`. `requestId` matches `X-Request-ID`.

| `data` field | Content |
| --- | --- |
| `metadata` | Descriptive mode/status, source contract and manifest checksum, scientific status, disabled recommendation/scoring flags, and source/derived-value explanations. |
| `selectedPeriod` | Numeric `startYear` and `endYear` actually requested. |
| `currentRotation` | Unchanged `current_rotation` scenario definition plus annual grouped crops, original crop classes, and directed transition evidence. |
| `waterFirst` | Unchanged `water_first` definition plus separate POWER point series and MODIS monthly/16-day series with availability counts. |
| `soilFirst` | Unchanged `soil_first` definition plus static map-unit records, `temporalScope`, and `fieldAssignmentStatus: "not_available"`. |
| `merra2Context` | Explicit optional-context status and, when loaded, separate native-cell monthly series. |
| `datasetSelections` | Per loaded dataset: status, selected row count, temporal-selection rule, and relation to declared source coverage. |
| `datasetProvenance` | Per loaded dataset: the existing safe Engine dataset object, including field declarations/units, primary keys, nullability, coverage, grain, limitations, validation/availability information, and manifest/data/schema checksums. |
| `availableIndicators` | Per loaded dataset: fields with at least one non-null selected value, their source unit, `availableValueCount`, and `missingValueCount`. This is data availability, not scientific suitability. Identifiers/context fields are included. |
| `missingValues` | Per loaded dataset: `selectedRecordCount`, positive `nullCounts`, `allNullFields`, and `recordsWithNullValues`. Empty selections have empty null summaries, not claims of complete data. |
| `unavailableIndicators` | Unsupported outcomes with reasons, any entirely null selected fields, and requested but unavailable MERRA-2 context. |
| `scientificLimitations` | Comparison limitations plus unchanged limitations declared by each loaded source. |
| `descriptiveAnalytics` | Additive derived historical climate, vegetation, crop and soil analytics, version `1.0.0`; source references and calculation methods are documented separately. |

`metadata` includes:

```json
{
  "comparisonMode": "descriptive_evidence",
  "comparisonStatus": "available",
  "sourceContractVersion": "1.0.0",
  "scientificValidationStatus": "not_assessed",
  "scientificEvaluationStatus": "not_implemented",
  "recommendationGenerationEnabled": false,
  "scenarioScoresGenerated": false,
  "sourceManifestChecksum": "<sha256>",
  "sourceValueClassification": "Supplied source-product values, including upstream aggregates; not scenario treatment outcomes or direct field measurements.",
  "derivedDescriptiveStatistics": [
    "selected record counts",
    "null/non-null counts",
    "observation availability counts",
    "record groupings"
  ],
  "timeSeriesRepresentation": "Existing source time series; no fitted trend, rescaling or imputation."
}
```

`comparisonStatus: "available"` means the descriptive response was assembled successfully. Individual datasets may have no rows in the selected period. It does not enable scientific evaluation or change the existing catalog's foundation readiness. Every successfully loaded dataset must be structurally ready under contract 1.0.0; scientific validation remains a separate status.

## Evidence sections and grain

All `records` contain the existing Engine row objects with no removed fields, recalculated percentages, new units, imputation, or rounding. JSON-encoded MODIS QA columns remain the validated strings declared by the source schema. Preserve those strings or explicitly parse them for presentation; they are not new scenario scores.

| Section | Shape and interpretation |
| --- | --- |
| `currentRotation.annualCropDistribution` | `{datasetId, selectedRecordCount, years: [{year, records}]}` for `usda_annual`. County annual Corn/Soybeans/Other, including original `area_ha`, `area_pct`, `valid_denominator_ha`, and source labels. Code 999 is the delivered Other aggregate. |
| `currentRotation.cropClassDistribution` | Same year grouping for `usda_crop_classes`; includes source classes, pixel counts, areas, annual denominators, and unresolved `CDL_Class_*` labels. |
| `currentRotation.observedTransitions` | `{datasetId, selectedRecordCount, yearPairs: [{year_1, year_2, records}]}` for `usda_crop_transitions`. Retains each row's `transition_type`, `area_ha`, `area_pct`, and pair-specific `common_valid_area_ha`. No normalization to a starting crop or across pairs. County totals do not identify fields or multi-year farm rotation histories. |
| `waterFirst.power` | `{datasetId, selectedRecordCount, locations: [{location_id, latitude, longitude, records}]}` for `power_monthly`. Four representative points remain separate, each at calendar-month grain. Temperature fields retain C, precipitation total mm and daily mean mm/day, solar total MJ/m^2 and daily mean MJ/m^2/day, humidity %. Days expected/present and completeness are retained. No county average or water requirement is computed. |
| `waterFirst.modisMonthly` | `{datasetId, selectedRecordCount, records, observationCounts}` for `modis_monthly`. Source `month` is YYYY-MM. NDVI/EVI mean/median/std, pixel-observation counts/percentages, `observation_count`, and `total_pixel_observations` are preserved. Source monthly statistics pool quality-passing county pixel observations. |
| `waterFirst.modis16day` | Same outer shape for `modis_16day`; source `date` is YYYY-MM-DD. Includes original NDVI/EVI statistics, pixel counts/percentages, base/quality-valid counts, and usefulness distributions before/after filtering. Source composite dates are not interpolated to daily data. |
| `soilFirst.mapUnits` | `{datasetId, selectedRecordCount, records}` for `soil_map_units`. `mukey` stays a string. Surface AWC cm/cm, organic matter %, drainage, hydrologic group, slope %, texture, component coverage, provenance and root-zone AWS mm remain as supplied. These are static SSURGO map-unit attributes with no delivered field geometry/linkage. |
| `merra2Context.cells` | `[{latitude, longitude, records}]` for `merra2_context`. Monthly means remain separate at native cells: latitude 42, longitudes -93.75 and -93.125. `SPEED` m s-1, `EVAP` kg m-2 s-1, `EFLUX`/`HFLUX` W m-2 keep original signs/units. No flux integration or crop-water interpretation is added. |

MODIS `observationCounts` contains `selectedPeriods`, `ndviAvailablePeriods`, `eviAvailablePeriods`, `bothAvailablePeriods`, and `neitherAvailablePeriods`. These count selected rows by non-null means. They do not replace source observation/pixel counts, quantify scientific confidence, or fit trends. Frontends can plot the supplied time series directly.

`datasetSelections[id].status` is `available` or `no_records_in_period`. `temporalSelection` is `inclusive_year_range`, `both_transition_years_within_range`, or `not_applicable_static`. `declaredPeriodRelation` is `within_declared_coverage`, `partially_within_declared_coverage`, `outside_declared_coverage`, `static`, or `not_declared`. This describes the source's declared interval, not continuous completeness; consult null and QA information for gaps.

## Optional MERRA-2 and errors

With `includeMerra2=false`, `merra2Context` is `{requested: false, status: "not_requested"}` and this dataset is not read or included in the per-dataset maps. With `true`, it contains `requested`, `status`, `datasetId`, `selectedRecordCount`, and `cells`; status is `available` or `no_records_in_period`.

If the existing loader reports `ENGINE_DATASET_UNAVAILABLE` for optional MERRA-2, the seven required sections still return 200. Context instead has `{requested: true, status: "unavailable", datasetId, availabilityStatus, reason}` with safe Engine availability details. No context rows/provenance are fabricated; `unavailableIndicators` explains the absence. Missing, invalid, or checksum-mismatched optional files follow this availability behavior. Unexpected application errors or cross-source consistency failures do not silently degrade.

| HTTP status | Error code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_COMPARISON_QUERY` | Invalid/unsupported comparison parameter. |
| 503 | `ENGINE_DATASET_UNAVAILABLE` | A required dataset is unavailable; existing safe Engine details identify its status/reason. |
| 503 | `COMPARISON_CONTRACT_UNAVAILABLE` | Source is not structurally ready under supported contract 1.0.0. |
| 503 | `COMPARISON_SOURCE_CHANGED` | Provenance/manifest or page totals changed during assembly; retry with a stable delivery. |
| 503 | `COMPARISON_RECORD_LIMIT` | Fetched evidence exceeds the bounded response budget. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected failure through the existing sanitized error middleware. |

Errors retain the existing `{success: false, error: {code, message, details?}, requestId}` contract and do not reflect invalid submitted values, credentials, private filesystem roots, or stack traces. Existing CORS and security middleware also apply. Files are read only; MongoDB readiness does not gate this route. A required Engine dataset failure affects this response independently of `/health/ready`.

## Actual delivered-data example

The Sprint 11 HTTP response captured from the local application using the existing Engine files is [scenario_comparison_actual_response.json](../reports/scenario_comparison_actual_response.json), for `?includeMerra2=true` with default years. Sprint 12 retains those existing fields and adds analytics; see [the updated actual HTTP response](../reports/historical_analytics_actual_response.json) and [calculated outputs/verification](../reports/historical_analytics_verification.md). Request IDs belong to the captured requests. These are review samples, not production inputs or fixtures.

| Dataset | Selected records, 2021-2025 |
| --- | ---: |
| USDA grouped annual crops | 15 |
| USDA original crop classes | 156 |
| USDA transitions | 36 |
| POWER monthly | 240: 60 at each of DG001, DG002, DG003, DG004 |
| MODIS monthly | 60: 59 with non-null NDVI/EVI means |
| MODIS 16-day | 115: 105 with non-null NDVI/EVI means |
| Soil map units | 86 static records |
| MERRA-2 contextual monthly | 120: 60 at each native cell |

These are selected counts, distinct from full-source counts in `datasetProvenance`. For example, full POWER coverage begins in 2017 and MERRA-2 in June 2008.

The first actual annual crop record is:

```json
{
  "year": 2021,
  "crop_code": 1,
  "crop_name": "Corn",
  "area_ha": 57873.6,
  "area_pct": 38.953,
  "valid_denominator_ha": 148572.9,
  "source": "USDA_CDL_2021_30m"
}
```

All 86 root-zone AWS values are null, so this indicator appears in `missingValues.soil_map_units.allNullFields` and `unavailableIndicators`, and is absent from `availableIndicators.soil_map_units`. Surface AWC is not substituted for root-zone storage.

## Scientific and operational limits

The MVP exposes historical source-product evidence and simple descriptive counts/groupings. Source values may themselves be modeled, classified, or aggregated upstream; labeling everything as a direct farm measurement would be incorrect. The upstream values and the backend's descriptive statistics are explicitly distinguished. Data delivery/checksum verification is not independent source verification or scientific validation.

No alternative crop sequence, irrigation requirement, water saving, soil-health improvement, field-level inference, yield prediction, score, ranking, recommendation, preference persistence, dataset lifecycle update, or database write is introduced. Engine MODIS county pixel-center summaries remain separate from legacy MongoDB bounding-box observations. MERRA-2 is optional context, never a decision-driving score. Missing values remain null and empty selections remain empty. Existing catalog/preference APIs and scientific readiness flags retain their previous meanings.

Regression coverage includes all evidence sections, defaults/custom years, multiple POWER points, MODIS temporal selection and QA/nulls, original USDA transition denominators, static soil attribute availability, optional MERRA-2, invalid queries, pagination, bounded reads, provenance consistency, sanitized errors and unchanged existing Scenario responses. Run `npm test` for the full existing regression suite plus these comparison tests; Atlas integration scripts are separate.
