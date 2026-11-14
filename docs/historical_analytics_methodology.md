# Historical Analytics - Sprint 12

## API and reuse

```text
GET /api/v1/scenarios/comparison
GET /api/v1/scenarios/comparison?startYear=2024&endYear=2024
GET /api/v1/scenarios/comparison?startYear=2021&endYear=2025&includeMerra2=true
```

The existing response gains one additive field: `data.descriptiveAnalytics`. The envelope, existing evidence fields, status/error conventions, `Cache-Control: no-store`, provenance, and query validation are unchanged. Defaults remain 2021-2025 and `includeMerra2=false`. A comparison with partial or empty temporal evidence can still succeed; the analytics expose that missingness explicitly.

`src/modules/analytics/historical.analytics.js` exports the pure `createHistoricalAnalytics(comparison)` function. Its input is the existing comparison object after Engine contract validation, year filtering, pagination, bounded collection and provenance checks. It adds no source reads, CSV parser, validation framework, database access, configuration or dependency. It neither mutates evidence nor retains request state.

Existing monthly MODIS statistics, raw composite trends/QA, annual crop distributions, original crop-class distributions and overall availability counts are reused through response paths. Soil null counts are reused from `missingValues`. The new calculations add annual and seasonal summaries, consecutive differences, grouped transition summaries, and map-unit distributions. No new endpoint or query parameter is needed.

## Analytics structure

| Field below `descriptiveAnalytics` | Contract |
| --- | --- |
| `version` | `1.0.0`, the descriptive calculation/response version. Distinct from the unchanged Engine contract version. |
| `classification` | `derived_descriptive_statistics`. Supplied source-product values remain in the original evidence sections. |
| `methodology` | This documentation path. |
| `provenancePath` | `datasetProvenance`; existing source hashes, schema declarations/units, coverage, validation status, grain and limitations apply. |
| `climate` | `datasetId: power_monthly`, existing evidence path, explicit spatial aggregation `none`, and separate `locations`. |
| `vegetation.monthly` | Annual weighted summaries, calendar-month summaries across selected years, missing-record statistics and paths to existing monthly source summaries/QA/availability. |
| `vegetation.composites16day` | Independent annual weighted summaries, missing-record statistics and changes between consecutive source records, with raw QA/trend paths. |
| `crops` | Grouped annual area/share changes, focus crop codes `[1, 5]`, paths to existing annual/class distributions, and per-year-pair transition categories. |
| `soil` | Static, unweighted map-unit availability, numeric summaries, and categorical distributions. |
| `merra2` | A reference to existing optional `merra2Context`, its existing status, and `additionalAggregation: none`. Native contextual cells/units are unchanged. |
| `limitations` | Explicit descriptive scope, missingness, weighting, resolution and scientific limitations. |

Evidence paths are dot paths relative to the same response's `data` object. Consumers should follow them to retrieve existing source values and QA; the analytics do not duplicate those records. The original `metadata.derivedDescriptiveStatistics` list describes the retained Sprint 11 summaries; the new section separately documents its additional derived calculations. Scientific evaluation remains `not_implemented`, scientific validation remains `not_assessed`, and recommendations remain disabled.

## NASA POWER: annual climate

Each `climate.locations[]` retains its `location_id`, latitude and longitude. `annual[]` is sorted by observed calendar year. No arithmetic mean across locations, county interpolation, or county climate estimate is calculated. Identical values at different delivered locations are retained independently.

### Completeness

Every annual entry has `completeness` with expected/present month counts, explicit `missingMonths` and `incompleteMonths`, expected/observed/missing day counts, observed-day percentage and `complete`/`partial` status. Gregorian leap rules apply: divisible by four, except centuries unless divisible by 400. A year has 365 or 366 expected days.

- `observedDayCount = sum(days_present)` over present monthly rows.
- `missingDayCount = expectedDayCount - observedDayCount`; it includes absent months and incomplete delivered months.
- `observedDayPercentage = 100 * observedDayCount / expectedDayCount`.
- A complete annual summary requires twelve distinct months, every source `complete` flag true, and the full calendar-day count. The existing Engine checks each source month's dates, day counts and completeness before analytics run.
- `missingYearRanges` compactly identifies requested calendar years with no rows for an observed location. An entirely empty location selection has no invented location series and reports `climate.status: no_records_in_period`; existing dataset selection/coverage metadata explains the selection.

Expected periods refer to full requested calendar years, including requested years outside declared dataset coverage. Missing records alone do not establish a sensor failure. No rows, days or values are filled in.

### Metrics and units

| Source columns | Method | Retained unit |
| --- | --- | --- |
| `T2M_mean`, `T2M_MAX_mean`, `T2M_MIN_mean` | Day-weighted mean of monthly daily means | C |
| `RH2M_mean` | Day-weighted mean of monthly humidity means | % |
| `PRECTOTCORR_daily_mean` | Day-weighted mean | mm/day |
| `ALLSKY_SFC_SW_DWN_daily_mean` | Day-weighted mean | MJ/m^2/day |
| `PRECTOTCORR_total` | Sum of supplied monthly totals | mm over the year/observed portion |
| `ALLSKY_SFC_SW_DWN_total` | Sum of supplied monthly totals | MJ/m^2 over the year/observed portion |

For a day-weighted metric, `observedValue = sum(monthlyValue * days_present) / sum(days_present)` over non-null monthly values with positive `days_present`. This reconstructs an observed-day summary from monthly daily means; it is not an unweighted mean of twelve monthly numbers. `T2M_MAX_mean` and `T2M_MIN_mean` remain means of daily maximum/minimum temperatures, not absolute annual extrema.

For totals, `observedValue = sum(non-null supplied monthly totals)`. No daily rate is converted into a total. Source totals and daily-mean columns are aggregated independently; source rounding can cause small differences between their implied totals. The backend does not force them to match.

Each metric contains `datasetId`, `sourceField`, source `unit`, `method`, `value`, `observedValue`, `sampleCount`, `missingValueCount`, `unusableWeightCount`, `weightSumDays`, and `status`.

- `sampleCount` counts contributing monthly rows, not days or independent weather stations.
- `missingValueCount` counts present rows whose metric is null/unavailable. Missing months are reported separately by completeness.
- `unusableWeightCount` counts available monthly means that cannot contribute because their day weight is zero. Those rows are not silently discarded.
- `weightSumDays` is the contributing daily denominator for weighted means; it is null for totals.
- `value` is populated only when all twelve months are complete and every monthly metric contributes. Otherwise it is null. `observedValue` retains any calculable partial summary, with status `partial`.
- No contributing values produces null, never a fabricated zero. Status can also be `unavailable` or `source_field_unavailable`. Actual delivered POWER columns are non-nullable; the generic layer reports missing metrics explicitly if used with a structurally verified reduced fixture/contract declaration.

`yearOverYear[]` compares a year only with the preceding calendar year inside the selection, never with the preceding available nonconsecutive year. Each metric uses `current complete annual value - previous complete annual value`. Temperature, precipitation and solar differences keep their source units; humidity changes have unit `percentage_points`. No relative-percent change is inferred. Each change reports `sampleCount` (0-2 complete annual values), `previous_year_unavailable`, `incomplete_or_missing_annual_value`, or `available`. A partial annual value cannot enter a year-over-year result.

## MODIS: separate resolutions

Monthly and composite datasets are never combined or averaged together. Both already contain scaled, QA-filtered county pixel-center statistics; no additional index scaling is applied. Original means, medians, standard deviations, pixel counts, QA distributions and dates stay at their original evidence paths.

### Annual and calendar-month summaries

For each index independently:

```text
weighted mean = sum(source period mean * source valid pixel count)
                / sum(valid pixel count for contributing non-null means)
```

The weight field is `ndvi_valid_pixel_count` or `evi_valid_pixel_count`. Monthly counts represent pixel observations pooled across monthly composites. Composite counts represent quality-passing pixels for that date; when summed across dates, they too count pixel observations, not unique land pixels.

This is a valid-pixel-observation-weighted summary of supplied means, not an equal-month mean, an equal-day average, a crop-specific metric, a county crop yield, or a field measurement. It reflects the source's unequal valid-pixel availability and source precision. Raw-pixel annual medians, standard deviations or uncertainty cannot be reconstructed from the delivered summaries and are not invented.

Annual entries are grouped by source year. `monthly.calendarMonths[]` additionally groups the monthly dataset by month number across selected years. For example, January combines only delivered January records from those years using their valid-pixel counts; it does not generate a new summary for every original month. Existing individual monthly statistics remain at `monthlySummariesPath`.

Each index summary contains:

| Field | Definition/denominator |
| --- | --- |
| `mean` | Weighted mean above; null when the contributing pixel count is zero. |
| `minimumPeriodMean`, `maximumPeriodMean` | Min/max of non-null period means, not raw-pixel extremes or extrema of modeled vegetation. |
| `availablePeriodCount`, `nullPeriodCount` | Present records with non-null/null index means. Their sum equals `presentRecordCount`. |
| `contributingPeriodCount`, `unusableWeightCount` | Non-null means with positive/unusable valid-pixel weights. |
| `validObservationPercentage` | `100 * availablePeriodCount / presentRecordCount`. This measures record-level index availability, not pixel QA percentage. |
| `contributingPixelObservations` | Sum of positive source valid-pixel weights whose mean contributes. |
| `validPixelObservations` | Sum of all source valid pixel counts, including zero counts. |
| `possiblePixelObservations` | Sum of `total_pixel_observations` for monthly records or `total_pixel_count` for composites. |
| `validPixelPercentage` | `100 * validPixelObservations / possiblePixelObservations`; not an unweighted mean of source percentages. |
| `datasetId`, `sourceField`, `unit`, `method`, `weightField`, `pixelPercentageDenominatorField` | Source identity, dimensionless index unit, weighting and pixel denominator declarations. |

Zero valid pixels can therefore give a valid-pixel percentage of zero while the index mean remains null. Unknown/zero denominators produce null percentages. Missing means are not treated as zero. Present all-null records remain in the availability and possible-pixel denominators.

`expectedRecordCount` and `missingRecordCount` describe absent rows separately from null-valued present rows. Monthly expectations are twelve per requested year; calendar-month groups expect one per requested year. Composite annual expectations come from the manifest's `coverage.observations_per_year` (23 in the real delivery); if not declared, expected/missing counts are null. Entire missing years are also represented as compact `missingYearRanges`. These expectations do not establish the exact dates of absent composites and include requests outside source coverage. Existing top-level MODIS `observationCounts` are reused via `periodAvailabilityPath`.

### 16-day historical changes and QA

The original temporal series and QA stay at `qaEvidencePath`/`evidencePath`. `changesBetweenConsecutiveRecords[]` sorts source dates and reports each date, preceding selected source date, actual `elapsedDays`, NDVI/EVI mean differences, and per-index `comparisonAvailable` flags.

`change = current source mean - previous source mean`, in dimensionless index units. If either endpoint is null, the change is null; an intermediate null observation is never bridged by searching backward. Date gaps are retained as their actual elapsed days, without interpolation, normalization into a daily rate, linear fitting, or causal interpretation. The first selected record has no prior comparison. These are historical differences, not forecasts or evidence of crop stress caused by a particular practice.

## USDA: area, shares and grouped transitions

`annualDistributionPath` and `cropClasses.distributionPath` reuse the existing annual grouped-crop and original CDL class records. Source labels, including unresolved `CDL_Class_*` labels and grouped Other code 999, are preserved. Corn (1) and Soybeans (5) are identified by `focusCropCodes`; their changes are in the same `annualChanges[].crops[]` records rather than duplicated in another history table.

For the same crop code in adjacent selected calendar years:

- `areaChangeHa = current area_ha - previous area_ha`, in ha.
- `percentagePointChange = current area_pct - previous area_pct`, in percentage points, not relative percent.
- Current/previous source areas, percentages and `valid_denominator_ha` are retained on the change record. Each source percentage uses its own year's valid county CDL area excluding classes 0 and 255. A changing denominator is not normalized away.
- `sampleCount` counts present crop records (0-2); status identifies a missing comparison record/year. An absent crop code is not assumed to have zero area; no prior year outside the selection is read or substituted.

For every selected consecutive year pair, `transitions.yearPairs[]` preserves the original `common_valid_area_ha`, source row count and total transition area. The original directed transition records and percentages remain at `transitions.evidencePath`. Categories add descriptive totals for `same_group` and `different_group`, comparing the source's Corn/Soybeans/Other labels:

```text
category area = sum(source area_ha for the category within that year pair)
category percentage = 100 * category area / that pair's common_valid_area_ha
```

Percentages are computed from summed areas and the original denominator, not by adding rounded source percentages or renormalizing to a starting crop. Source row counts distinguish each category's contributing transitions. Pair denominators are never averaged or pooled across years. `Other -> Other` may contain changes between original CDL classes; even `same_group` is not proof that a specific crop stayed on a field. These are county-level aggregates, not farm rotation histories or invented sequences.

## SSURGO: map-unit samples

`soil.attributes` has one entry per delivered schema field, including identifiers/context. It reuses existing null counts. For every attribute:

```text
availableCount = selectedRecordCount - nullCount
nullPercentage = 100 * nullCount / selectedRecordCount
```

The denominator is the number of delivered map-unit records (86), never county hectares or field count. For an empty sample, null percentage is null. All-null attributes have status `all_values_null` and numerical statistics remain null.

Numeric fields report an **unweighted across-map-unit** mean, median, minimum, maximum and non-null sample count. The median is the middle sorted value, or arithmetic mean of the two middle values for an even sample. Values retain source units. This includes surface-horizon AWC (cm/cm), organic matter (%), slope (%), component percentage accounted (%), and root-zone available water storage (mm). The source may already weight components within a map unit; the backend does not treat that as an area weight between map units.

Texture, drainage class and hydrologic group additionally report each non-null source category with its count and two clearly named percentages: `percentageOfAllMapUnits` uses every delivered map-unit row, while `percentageOfAvailableMapUnits` uses only non-null values for that attribute. Missing categories remain separately counted; they are not labeled as a real soil class. No county coverage percentage or field assignment is derived.

All 86 delivered root-zone AWS values are null. Surface AWC is not substituted for root-zone storage. Organic-matter outliers and source categories are preserved rather than clipped, reclassified or interpreted as soil-health gains.

## Precision, safety and limitations

Source rows, Engine files, CSVs, schemas, environment and MongoDB records are unchanged. Calculations use JavaScript finite double-precision numbers without extra rounding. Small binary floating-point tails can appear in sums/differences; frontend formatting may round for display without altering the stored source values. Numeric strings/non-finite values reaching the pure numeric helpers are rejected rather than coerced. Source precision, units, spatial grain, temporal grain, nullability and upstream QA remain limiting factors.

These outputs summarize historical products, some modeled, classified or aggregated upstream. Structural/checksum validation does not establish independent scientific validation. No recommendation, scenario score, crop sequence, predicted yield, water saving, irrigation requirement, soil-health improvement, land-area weighting, or causal relationship is produced. No preference weights are applied. MERRA-2 remains optional contextual evidence with separate native cells, monthly flux units and signs.

Actual API captures, calculated values and verification results are in [Historical analytics verification](../reports/historical_analytics_verification.md) and [the complete actual HTTP response](../reports/historical_analytics_actual_response.json).
