# Historical Analytics verification - Sprint 12

The existing comparison endpoint now adds `data.descriptiveAnalytics`. The reusable calculation module consumes validated comparison evidence, adds no Engine reads, and preserves all pre-existing response data. No source/data/environment change, new dependency or MongoDB write was performed.

## API examples and actual checks

```http
GET /api/v1/scenarios/comparison
GET /api/v1/scenarios/comparison?startYear=2024&endYear=2024
GET /api/v1/scenarios/comparison?startYear=2021&endYear=2025&includeMerra2=true
```

| Actual local HTTP request | Status | POWER locations | MODIS annual groups per resolution | Transition pairs | Soil records | MERRA-2 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Default 2021-2025 | 200 | 4 | 5 | 4 | 86 | not_requested |
| Default with includeMerra2=true | 200 | 4 | 5 | 4 | 86 | available |
| 2024-2024 | 200 | 4 | 1 | 0 | 86 | not_requested |
| 1990-1991, outside temporal source coverage | 200 | 0 | 0 | 0 | 86 | not_requested |

The complete actual HTTP response is [historical_analytics_actual_response.json](historical_analytics_actual_response.json). Its request ID is from an isolated local application instance with a database stub that throws if a connection is requested. The running application was not explicitly restarted. Both default and custom periods were checked without an Atlas connection.

The captured default response with optional context was compared recursively with the prior Sprint 11 capture: all pre-existing `data` fields matched exactly. The only addition is `descriptiveAnalytics`; envelope/request-ID conventions remain unchanged. Original source rows, QA, percentage denominators, and optional-context behavior are retained.

Source contract: 1.0.0. Manifest SHA-256: d8d9fc4189b22cbbc7ffa1b6c31505d99b6be133ded061b4dd172cfffbba21ae. All eight delivered source datasets total 1,462 rows; the requested default interval selects 828 rows including optional MERRA-2.

## Actual POWER annual results

Display values below are rounded; the API capture retains unrounded JavaScript numbers. Temperature and humidity are day-weighted means. Precipitation and solar are sums of monthly totals. Every location-year below has twelve complete months; 2024 has 366 days and the other years have 365. The four locations are separate samples, including where delivered values coincide.

| Location | Year | Source days | Temperature (C) | Precipitation (mm) | Humidity (%) | Solar (MJ/m^2) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DG001 | 2021 | 365 | 10.709479 | 651.51 | 72.428740 | 5533.32 |
| DG001 | 2022 | 365 | 9.231041 | 677.21 | 70.552877 | 5517.38 |
| DG001 | 2023 | 365 | 11.050438 | 604.46 | 69.940110 | 5479.75 |
| DG001 | 2024 | 366 | 11.201831 | 957.58 | 71.986940 | 5520.58 |
| DG001 | 2025 | 365 | 10.069342 | 909.80 | 75.475233 | 5475.03 |
| DG002 | 2021 | 365 | 11.076438 | 648.07 | 70.058438 | 5533.32 |
| DG002 | 2022 | 365 | 9.443562 | 676.82 | 68.791205 | 5517.38 |
| DG002 | 2023 | 365 | 11.225014 | 627.59 | 68.587014 | 5479.75 |
| DG002 | 2024 | 366 | 11.489208 | 894.80 | 69.747322 | 5520.58 |
| DG002 | 2025 | 365 | 10.273342 | 914.10 | 74.172685 | 5475.03 |
| DG003 | 2021 | 365 | 10.709479 | 651.51 | 72.428740 | 5465.48 |
| DG003 | 2022 | 365 | 9.231041 | 677.21 | 70.552877 | 5381.84 |
| DG003 | 2023 | 365 | 11.050438 | 604.46 | 69.940110 | 5351.49 |
| DG003 | 2024 | 366 | 11.201831 | 957.58 | 71.986940 | 5395.36 |
| DG003 | 2025 | 365 | 10.069342 | 909.80 | 75.475233 | 5323.21 |
| DG004 | 2021 | 365 | 11.076438 | 648.07 | 70.058438 | 5465.48 |
| DG004 | 2022 | 365 | 9.443562 | 676.82 | 68.791205 | 5381.84 |
| DG004 | 2023 | 365 | 11.225014 | 627.59 | 68.587014 | 5351.49 |
| DG004 | 2024 | 366 | 11.489208 | 894.80 | 69.747322 | 5395.36 |
| DG004 | 2025 | 365 | 10.273342 | 914.10 | 74.172685 | 5323.21 |

Year-over-year examples for DG001 (complete consecutive calendar years only):

| Year vs previous year | Temperature change (C) | Precipitation change (mm) | Humidity change (percentage points) | Solar change (MJ/m^2) |
| --- | ---: | ---: | ---: | ---: |
| 2022 vs 2021 | -1.478438 | 25.70 | -1.875863 | -15.94 |
| 2023 vs 2022 | 1.819397 | -72.75 | -0.612767 | -37.63 |
| 2024 vs 2023 | 0.151392 | 353.12 | 2.046830 | 40.83 |
| 2025 vs 2024 | -1.132488 | -47.78 | 3.488293 | -45.55 |

## Actual MODIS annual results

Monthly and 16-day records remain distinct. Means use source valid-pixel-observation counts as weights. Pixel QA percentage uses the sum of all possible pixel observations; present rows with no valid means stay in that denominator. Available-period percentage uses non-null index means divided by present records.

| Resolution | Year | NDVI mean | EVI mean | Available / present periods | Null periods | Valid period % | Valid / possible pixel observations | Valid pixel % |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |
| monthly | 2021 | 0.439191 | 0.274133 | 11 / 12 | 1 | 91.666667 | 559284 / 855439 | 65.379764 |
| monthly | 2022 | 0.478391 | 0.331695 | 12 / 12 | 0 | 100.000000 | 656961 / 855439 | 76.798112 |
| monthly | 2023 | 0.466849 | 0.316013 | 12 / 12 | 0 | 100.000000 | 698580 / 855439 | 81.663333 |
| monthly | 2024 | 0.457957 | 0.300240 | 12 / 12 | 0 | 100.000000 | 679665 / 855439 | 79.452188 |
| monthly | 2025 | 0.444620 | 0.303767 | 12 / 12 | 0 | 100.000000 | 595844 / 855439 | 69.653593 |
| 16-day | 2021 | 0.439191 | 0.274133 | 20 / 23 | 3 | 86.956522 | 559284 / 855439 | 65.379764 |
| 16-day | 2022 | 0.478391 | 0.331695 | 20 / 23 | 3 | 86.956522 | 656961 / 855439 | 76.798112 |
| 16-day | 2023 | 0.466849 | 0.316013 | 22 / 23 | 1 | 95.652174 | 698580 / 855439 | 81.663333 |
| 16-day | 2024 | 0.457957 | 0.300240 | 22 / 23 | 1 | 95.652174 | 679665 / 855439 | 79.452188 |
| 16-day | 2025 | 0.444620 | 0.303767 | 21 / 23 | 2 | 91.304348 | 595844 / 855439 | 69.653593 |

For every selected year, monthly and composite weighted annual means agree within 1e-12 and their valid-pixel-observation sums agree, while each resolution retains its own period counts and QA. This is a check of the delivered pooled summaries, not a merge of their data. Calendar-month summaries, min/max period means and every dated composite difference are in the full response. Dates with null means produce null differences; gaps retain actual elapsed days.

## Actual Corn and Soybeans changes

Areas are current minus previous year. Percentage changes below are differences of original source percentages in percentage points. Both annual valid-area denominators are retained on every comparison record, including if denominators differ.

| Crop | Year vs previous | Previous area (ha) | Current area (ha) | Area change (ha) | Share change (percentage points) | Previous / current denominator (ha) |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Corn | 2022 vs 2021 | 57873.60 | 63485.55 | 5611.95 | 3.7772 | 148572.90 / 148572.90 |
| Soybeans | 2022 vs 2021 | 52334.10 | 45973.62 | -6360.48 | -4.2810 | 148572.90 / 148572.90 |
| Corn | 2023 vs 2022 | 63485.55 | 60587.73 | -2897.82 | -1.9504 | 148572.90 / 148572.90 |
| Soybeans | 2023 vs 2022 | 45973.62 | 48208.68 | 2235.06 | 1.5043 | 148572.90 / 148572.90 |
| Corn | 2024 vs 2023 | 60587.73 | 62293.95 | 1706.22 | 1.1482 | 148572.90 / 148573.80 |
| Soybeans | 2024 vs 2023 | 48208.68 | 47367.27 | -841.41 | -0.5665 | 148572.90 / 148573.80 |
| Corn | 2025 vs 2024 | 62293.95 | 65061.09 | 2767.14 | 1.8624 | 148573.80 / 148573.80 |
| Soybeans | 2025 vs 2024 | 47367.27 | 42947.91 | -4419.36 | -2.9745 | 148573.80 / 148573.80 |

The original full crop-class distributions remain available at `currentRotation.cropClassDistribution.years`; they are referenced rather than copied into analytics.

## Actual transition categories

| Pair | Source rows | Original common-valid area (ha) | Same-group area (ha) | Same-group % | Different-group area (ha) | Different-group % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2021-2022 | 9 | 148572.90 | 52092.36 | 35.061818 | 96480.54 | 64.938182 |
| 2022-2023 | 9 | 148572.90 | 56878.83 | 38.283449 | 91694.07 | 61.716551 |
| 2023-2024 | 9 | 148539.33 | 54340.65 | 36.583341 | 94198.68 | 63.416659 |
| 2024-2025 | 9 | 148573.80 | 59428.53 | 39.999334 | 89145.27 | 60.000666 |

Percentages are computed from category area divided by that original pair denominator, without changing the original transition rows/percentages. Other -> Other is only the same aggregate label, not necessarily the same original crop. None of these categories identifies a field or a farm rotation history.

## Actual SSURGO summaries

Every delivered map-unit record has equal weight. These are record-sample statistics, not county coverage or an area-weighted soil condition estimate. Source component weighting within a map unit is retained.

| Source field | Unit | Non-null / total map units | Null % | Mean | Median | Minimum | Maximum |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| awc_weighted_cm_per_cm | cm/cm | 77 / 86 | 10.465116 | 0.187753 | 0.183000 | 0.110000 | 0.380000 |
| organic_matter_weighted_pct | % | 77 / 86 | 10.465116 | 4.882558 | 3.350000 | 1.455000 | 59.300000 |
| slope_weighted_pct | % | 79 / 86 | 8.139535 | 5.661266 | 3.600000 | 0.000000 | 38.000000 |
| total_component_pct_accounted | % | 86 / 86 | 0.000000 | 100.000000 | 100.000000 | 100.000000 | 100.000000 |
| root_zone_aws_0_150cm_mm | mm | 0 / 86 | 100.000000 | null | null | null | null |

### dominant_drainage_class

Available: 77; null: 9 (10.465116% of delivered map-unit records).

| Source category | Record count | % of all 86 records | % of available records |
| --- | ---: | ---: | ---: |
| Excessively drained | 3 | 3.488372 | 3.896104 |
| Moderately well drained | 6 | 6.976744 | 7.792208 |
| Poorly drained | 15 | 17.441860 | 19.480519 |
| Somewhat excessively drained | 8 | 9.302326 | 10.389610 |
| Somewhat poorly drained | 5 | 5.813953 | 6.493506 |
| Very poorly drained | 5 | 5.813953 | 6.493506 |
| Well drained | 35 | 40.697674 | 45.454545 |

### dominant_hydrologic_group

Available: 77; null: 9 (10.465116% of delivered map-unit records).

| Source category | Record count | % of all 86 records | % of available records |
| --- | ---: | ---: | ---: |
| A | 14 | 16.279070 | 18.181818 |
| B | 22 | 25.581395 | 28.571429 |
| B/D | 4 | 4.651163 | 5.194805 |
| C | 15 | 17.441860 | 19.480519 |
| C/D | 22 | 25.581395 | 28.571429 |

Root-zone AWS is null for all 86 records. The API reports 100% null, zero contributing samples and null numeric statistics; surface AWC is not substituted.

## Methodology and test results

[Historical analytics methodology](../docs/historical_analytics_methodology.md) documents every formula, source column, unit, weight, sample count, null rule, expected-period rule, reference path and scientific limitation.

`npm.cmd test -- --test-reporter=spec` completed with **255 passed, 0 failed, 0 skipped** (20 new historical analytics tests; 235 existing tests). The final run took approximately 12.25 seconds. `git diff --check` passed; existing line-ending notices are informational.

New tests cover all metric families, Gregorian leap years (including 1900/2000), missing/incomplete months, day weights, actual zeros versus missing values, four independent POWER series, year-over-year eligibility, separate MODIS resolutions, independent EVI calculations, pixel denominators, null QA periods, undeclared expected cadence, actual date gaps, annual crop denominators, percentage points, pair denominators, soil numeric/categorical distributions, static soil nulls, empty/custom selections, statelessness, no extra Engine reads, safe query validation and existing response compatibility.

## Remaining limitations

- Structural/hash validation is not independent scientific validation. Daily POWER inputs and raw MODIS pixels are not reconstructed from their existing monthly/composite summaries.
- Full annual climate values and comparisons are null for incomplete years; observed portions remain labeled with source counts. Requested years outside coverage are not sensor-failure claims.
- MODIS weighted summaries inherit source QA, rounding and unequal availability. They are not crop-specific field measurements, uncertainty estimates or causal effects.
- Crop denominators can vary by year/pair. Aggregate class/transition differences do not identify field management histories.
- Soil attributes have nulls, no delivered field linkage and no spatial area weights. Unweighted sample summaries do not estimate county-wide soil coverage.
- MERRA-2 remains separate optional context without new flux conversion or aggregation.
- No recommendations, scores, crop sequences, predictions, water savings or soil-health improvements are generated.

## Exact files changed

- src/modules/analytics/historical.analytics.js (new pure calculation layer)
- src/modules/scenarios/scenario.comparison.js (additive response integration)
- tests/historical.analytics.test.js (new unit/API regression tests)
- docs/historical_analytics_methodology.md (new formulas/units/denominators and response contract)
- docs/scenario_comparison_api_contract.md (document additive section)
- docs/scenario_engine_architecture.md (document calculation layer)
- reports/historical_analytics_actual_response.json (new actual API capture)
- reports/historical_analytics_verification.md (this report)
