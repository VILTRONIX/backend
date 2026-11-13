# MODIS backend source audit — read-only AOI summaries

Generated (UTC): 2026-11-13T16:26:46.176Z.

**Dry-run result: PASS.** Both files were read through `process.env.TERRAPULSE_DATA_ROOT`. Source checksums were checked again after parsing. No database connection, asset registration, lifecycle update, ingestion, scaling, QA filtering, source-file write, vegetation collection, or vegetation API is performed by this script.

**Spatial limitation: these files summarize a bounding-box AOI. They are not an exact Story County polygon mask and must not be represented as county-only statistics.** The CSVs do not contain the AOI geometry or bounding coordinates, so its exact footprint cannot be independently reconstructed from these two files.

## Source identity and scope

| Resolution | Actual source path | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| 16day | C:\TerraPulseData\processed\modis\modis_16day_aoi_summary.csv | 51686 | 0a2bb581122774e5e6bc69319e1d3758e37c98947f362677098133748719edc7 |
| monthly | C:\TerraPulseData\processed\modis\modis_monthly_aoi_summary.csv | 17695 | f411afa54c2d8fee70251958fb73ec50c86dd2cb95325670ead7f9a323579465 |

The root was supplied explicitly to the audit process. There is no hardcoded/default data root in the audit code. Mahdi's Linux path is not used. The old county-masked filenames and mask-report assumptions are superseded by the user-provided AOI files for this phase. No separate processing report was supplied or treated as audited evidence.

Product/processing provenance supplied by the user: NASA MOD13Q1.061, 250 m nominal spatial resolution, native 16-day composites; NDVI/EVI were already scale-decoded (dimensionless indices). Pixel Reliability = 0 and MODLAND QA = 0, with MODLAND bits 0–1, were applied upstream. **No 0.0001 scaling or QA filters were applied during this audit.** Units, scaling history, raw QA flags, and exact upstream code are not independently provable from the CSVs: neither a units/scale column nor Pixel Reliability/MODLAND QA flag columns is present. The available VI usefulness histograms are a different QA diagnostic.

Numeric summaries below preserve the existing decoded values. Blank cells become null only in audit memory; they are never converted to zero. The per-file mean is the unweighted arithmetic mean of non-null row means, not a pixel-weighted spatial estimate. Minima/maxima below describe the exported summary columns, not raw pixel extrema. Null-only averages/minima/maxima remain null. The CSV schemas contain no coordinates, CRS, or AOI geometry; exact spatial verification cannot be inferred from their pixel totals.

## 16day file

Rows: **207** (expected 207); first/last dates: **2017-01-01 — 2025-12-19**. Date/month nulls: 0. Duplicate date/month keys: 0; duplicate complete records: 0; ordering violations: 0.

Exact headers in source order, observed non-null data types, null counts, and invalid counts:

| Column | Observed type | Nulls | Invalid |
| --- | --- | --- | --- |
| date | calendar date (YYYY-MM-DD) | 0 | 0 |
| ndvi_mean | finite decimal number | 18 | 0 |
| ndvi_median | finite decimal number | 18 | 0 |
| ndvi_std | finite decimal number | 18 | 0 |
| ndvi_valid_pixel_count | integer | 0 | 0 |
| ndvi_valid_pixel_percentage | finite decimal number | 0 | 0 |
| evi_mean | finite decimal number | 18 | 0 |
| evi_median | finite decimal number | 18 | 0 |
| evi_std | finite decimal number | 18 | 0 |
| evi_valid_pixel_count | integer | 0 | 0 |
| evi_valid_pixel_percentage | finite decimal number | 0 | 0 |
| total_pixel_count | integer | 0 | 0 |
| base_valid_pixel_count | integer | 0 | 0 |
| quality_valid_pixel_count | integer | 0 | 0 |
| vi_usefulness_distribution_before_filter | JSON object of category:integer-count | 0 | 0 |
| vi_usefulness_distribution_after_filter | JSON object of category:integer-count | 0 | 0 |

Numeric column statistics (nulls excluded; counts and percentages retain their source meanings):

| Column | Non-null count | Minimum | Maximum | Arithmetic mean | Sum |
| --- | --- | --- | --- | --- | --- |
| ndvi_mean | 189 | 0.21023578279266575 | 0.8694360112028302 | 0.45118954796854943 | 85.27482456605584 |
| ndvi_median | 189 | 0.19890000000000002 | 0.8998 | 0.43928888888888873 | 83.02559999999997 |
| ndvi_std | 189 | 0.03166151681551873 | 0.16332604086442473 | 0.08838683370723485 | 16.705111570667388 |
| ndvi_valid_pixel_count | 207 | 0 | 37575 | 28597.700483091787 | 5919724 |
| ndvi_valid_pixel_percentage | 207 | 0 | 100 | 76.1083179856069 | 15754.42182302063 |
| evi_mean | 189 | 0.10071779538904899 | 0.7561052413793105 | 0.2997535044998172 | 56.653412350465445 |
| evi_median | 189 | 0.0961 | 0.7877500000000001 | 0.2908029100529102 | 54.96175000000002 |
| evi_std | 189 | 0.0193274545165781 | 0.1561662866093689 | 0.07887137347115108 | 14.906689586047555 |
| evi_valid_pixel_count | 207 | 0 | 37575 | 28597.700483091787 | 5919724 |
| evi_valid_pixel_percentage | 207 | 0 | 100 | 76.1083179856069 | 15754.42182302063 |
| total_pixel_count | 207 | 37575 | 37575 | 37575 | 7778025 |
| base_valid_pixel_count | 207 | 37563 | 37575 | 37574.69082125604 | 7777961 |
| quality_valid_pixel_count | 207 | 0 | 37575 | 28597.700483091787 | 5919724 |

Invalid numeric values: 0. Per-variable zero-data mismatches: 0. NDVI/EVI valid-pixel count mismatches: 0.

Records per year: `{"2017":23,"2018":23,"2019":23,"2020":23,"2021":23,"2022":23,"2023":23,"2024":23,"2025":23}`.

Actual source sample: first three records plus the original header (no source-file modification):

```csv
date,ndvi_mean,ndvi_median,ndvi_std,ndvi_valid_pixel_count,ndvi_valid_pixel_percentage,evi_mean,evi_median,evi_std,evi_valid_pixel_count,evi_valid_pixel_percentage,total_pixel_count,base_valid_pixel_count,quality_valid_pixel_count,vi_usefulness_distribution_before_filter,vi_usefulness_distribution_after_filter
2017-01-01,0.24394132511430436,0.2326,0.04397907165151379,24496,65.19228210246175,0.13409301518615285,0.1272,0.031339646292507545,24496,65.19228210246175,37575,37575,24496,"{""2"": 24496, ""3"": 11102, ""4"": 1138, ""5"": 393, ""6"": 399, ""8"": 47}","{""2"": 24496}"
2017-01-17,0.2825406775588659,0.2702,0.05471613319898938,12486,33.22954091816367,0.1296897725452507,0.1255,0.03630600585998422,12486,33.22954091816367,37575,37574,12486,"{""3"": 12486, ""4"": 1480, ""5"": 5682, ""6"": 15576, ""7"": 1732, ""8"": 476, ""9"": 59, ""10"": 83}","{""3"": 12486}"
2017-02-02,0.24895365444459477,0.2409,0.03594649178694812,36955,98.34996673320026,0.11343499661750776,0.1097,0.02461723987829257,36955,98.34996673320026,37575,37575,36955,"{""1"": 36450, ""2"": 699, ""3"": 320, ""4"": 17, ""5"": 22, ""6"": 57, ""7"": 10}","{""1"": 36450, ""2"": 462, ""3"": 43}"
```

Validation errors (0):

```json
[]
```

Warnings (0): `[]`.

Zero-quality-valid observations: **18**. Zero-quality dates match all-null NDVI/EVI dates: **true**. Variable-valid vs quality-valid count mismatches: 0.

No-data date list: 2018-01-01, 2018-02-02, 2019-01-17, 2019-02-02, 2019-02-18, 2020-01-17, 2020-02-02, 2020-12-18, 2021-01-01, 2021-01-17, 2021-02-02, 2022-01-17, 2022-02-02, 2022-12-19, 2023-01-17, 2024-12-18, 2025-01-01, 2025-12-03.

No-data calendar-month distribution: `{"12":4,"01":8,"02":6}`. December/January/February are calendar winter here; the cause of failed quality criteria is **not established**.

Consecutive gap distribution (days): `{"13":6,"14":2,"16":198}`. Within-year gaps other than 16 days: 0. Off-calendar dates: 0; absent January-1-anchored composite timestamps inside the actual date range: 0. The 13/14-day gaps at year transitions reflect the January-1 reset and leap-year calendar, not absent composites. UTC is used only for deterministic calendar arithmetic; the CSV date keys have no timezone field.

Aggregated VI usefulness distributions. Counts are pixel-observations across dates, not unique physical pixels:

| Category | Before filter | After filter |
| --- | --- | --- |
| 1 | 4546008 | 4542206 |
| 2 | 1865957 | 1271934 |
| 3 | 400138 | 105584 |
| 4 | 280179 | 0 |
| 5 | 531168 | 0 |
| 6 | 121062 | 0 |
| 7 | 18575 | 0 |
| 8 | 10735 | 0 |
| 9 | 2568 | 0 |
| 10 | 956 | 0 |
| 11 | 529 | 0 |
| 12 | 86 | 0 |

Exported QA histogram sum/subset/format check errors: 0. Zero errors means before-filter sums match base-valid counts, after-filter sums match quality-valid counts, and retained category counts do not exceed original counts. These checks do not reapply or independently verify the upstream raw-flag selection.

## monthly file

Rows: **108** (expected 108); first/last months: **2017-01 — 2025-12**. Date/month nulls: 0. Duplicate date/month keys: 0; duplicate complete records: 0; ordering violations: 0.

Exact headers in source order, observed non-null data types, null counts, and invalid counts:

| Column | Observed type | Nulls | Invalid |
| --- | --- | --- | --- |
| month | calendar month (YYYY-MM) | 0 | 0 |
| observation_count | integer | 0 | 0 |
| total_pixel_observations | integer | 0 | 0 |
| ndvi_mean | finite decimal number | 2 | 0 |
| ndvi_median | finite decimal number | 2 | 0 |
| ndvi_std | finite decimal number | 2 | 0 |
| ndvi_valid_pixel_count | integer | 0 | 0 |
| ndvi_valid_pixel_percentage | finite decimal number | 0 | 0 |
| evi_mean | finite decimal number | 2 | 0 |
| evi_median | finite decimal number | 2 | 0 |
| evi_std | finite decimal number | 2 | 0 |
| evi_valid_pixel_count | integer | 0 | 0 |
| evi_valid_pixel_percentage | finite decimal number | 0 | 0 |

Numeric column statistics (nulls excluded; counts and percentages retain their source meanings):

| Column | Non-null count | Minimum | Maximum | Arithmetic mean | Sum |
| --- | --- | --- | --- | --- | --- |
| observation_count | 108 | 1 | 2 | 1.9166666666666667 | 207 |
| total_pixel_observations | 108 | 37575 | 75150 | 72018.75 | 7778025 |
| ndvi_mean | 106 | 0.21023578279266575 | 0.8675265982718176 | 0.43220484352081573 | 45.813713413206465 |
| ndvi_median | 106 | 0.19890000000000002 | 0.8964000000000001 | 0.421265566037736 | 44.654150000000016 |
| ndvi_std | 106 | 0.03248905403547034 | 0.17760597218790108 | 0.09265411337228799 | 9.821336017462526 |
| ndvi_valid_pixel_count | 108 | 0 | 75048 | 54812.25925925926 | 5919724 |
| ndvi_valid_pixel_percentage | 108 | 0 | 100 | 76.88583327172817 | 8303.669993346643 |
| evi_mean | 106 | 0.10071779538904899 | 0.7287537585850034 | 0.28255218254438985 | 29.950531349705326 |
| evi_median | 106 | 0.0961 | 0.7511 | 0.2734061320754717 | 28.98105 |
| evi_std | 106 | 0.02061920402174619 | 0.17269976826342381 | 0.0812383985629322 | 8.611270247670813 |
| evi_valid_pixel_count | 108 | 0 | 75048 | 54812.25925925926 | 5919724 |
| evi_valid_pixel_percentage | 108 | 0 | 100 | 76.88583327172817 | 8303.669993346643 |

Invalid numeric values: 0. Per-variable zero-data mismatches: 0. NDVI/EVI valid-pixel count mismatches: 0.

Records per year: `{"2017":12,"2018":12,"2019":12,"2020":12,"2021":12,"2022":12,"2023":12,"2024":12,"2025":12}`.

Actual source sample: first three records plus the original header (no source-file modification):

```csv
month,observation_count,total_pixel_observations,ndvi_mean,ndvi_median,ndvi_std,ndvi_valid_pixel_count,ndvi_valid_pixel_percentage,evi_mean,evi_median,evi_std,evi_valid_pixel_count,evi_valid_pixel_percentage
2017-01,2,75150,0.25697338164512473,0.2434,0.05123604051682724,36982,49.21091151031271,0.1326063760748472,0.1267,0.033165267074865244,36982,49.21091151031271
2017-02,2,75150,0.2531595043213699,0.24480000000000002,0.03668579018743779,74282,98.84497671324019,0.1206177606957271,0.11750000000000001,0.026432220381256803,74282,98.84497671324019
2017-03,2,75150,0.25921519263532294,0.24710000000000001,0.04040771383838539,33457,44.52029274783766,0.13995319962937502,0.1346,0.02933322765927356,33457,44.52029274783766
```

Validation errors (0):

```json
[]
```

Warnings (0): `[]`.

## Cross-file reconciliation

Monthly rows reconciled: **108**. Monthly observation_count sum: **207**. Observation-count distribution: `{"1":9,"2":99}`.

Absent monthly records for composite month keys: `[]`; monthly records without composite dates: `[]`; missing calendar-month rows: `[]`.

Monthly rows with no valid data: **2019-02, 2021-01**. These records exist; they are not absent rows. Their actual fields are shown below; no missing month was interpolated or filled.

```json
[
  {
    "month": "2019-02",
    "observation_count": 2,
    "total_pixel_observations": 75150,
    "ndvi_mean": null,
    "ndvi_median": null,
    "ndvi_std": null,
    "ndvi_valid_pixel_count": 0,
    "ndvi_valid_pixel_percentage": 0,
    "evi_mean": null,
    "evi_median": null,
    "evi_std": null,
    "evi_valid_pixel_count": 0,
    "evi_valid_pixel_percentage": 0
  },
  {
    "month": "2021-01",
    "observation_count": 2,
    "total_pixel_observations": 75150,
    "ndvi_mean": null,
    "ndvi_median": null,
    "ndvi_std": null,
    "ndvi_valid_pixel_count": 0,
    "ndvi_valid_pixel_percentage": 0,
    "evi_mean": null,
    "evi_median": null,
    "evi_std": null,
    "evi_valid_pixel_count": 0,
    "evi_valid_pixel_percentage": 0
  }
]
```

Monthly count/total/valid-count reconciliation: 108/108 rows match. Assignment uses composite date calendar-month keys; no interval/day-overlap weights are invented. These monthly counts count repeated pixel-observations, not unique AOI pixels or county area.

The independent monthly mean check is sum(composite mean × its valid-pixel count) / sum(valid-pixel counts), separately for NDVI and EVI. Months with zero total weight remain null. Absolute tolerance: 1e-9.

Weighted mean match counts: `{"ndvi":{"nonNull":106,"null":2,"mismatched":0},"evi":{"nonNull":106,"null":2,"mismatched":0}}`.

| Variable | Maximum absolute weighted-mean difference | Maximum absolute pooled-population-std difference |
| --- | --- | --- |
| NDVI | 1.1102230246251565e-16 | 2.7755575615628914e-17 |
| EVI | 2.220446049250313e-16 | 5.551115123125783e-17 |

Pooled-population-standard-deviation checks passed for 108/108 rows. This check pools composite population variances and between-composite mean differences, weighted by valid-pixel counts. Matching is consistency evidence for a population/pixel-observation aggregation, not proof of the original code or ddof setting. Monthly medians cannot be independently reconstructed from composite medians/counts; original pixel values are not present and were not requested or reprocessed.

Complete per-month checks (counts, totals, valid counts, weighted means, and pooled population standard deviations):

| Month | Composite dates | Monthly observation_count | Composites with data | All checks pass | NDVI mean abs. diff. | EVI mean abs. diff. |
| --- | --- | --- | --- | --- | --- | --- |
| 2017-01 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 2.7755575615628914e-17 |
| 2017-02 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 2.7755575615628914e-17 |
| 2017-03 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2017-04 | 2 | 2 | 2 | true | 0 | 0 |
| 2017-05 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2017-06 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2017-07 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 1.1102230246251565e-16 |
| 2017-08 | 2 | 2 | 2 | true | 0 | 1.1102230246251565e-16 |
| 2017-09 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2017-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2017-11 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2017-12 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 2.7755575615628914e-17 |
| 2018-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2018-02 | 2 | 2 | 1 | true | 0 | 0 |
| 2018-03 | 2 | 2 | 2 | true | 0 | 0 |
| 2018-04 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2018-05 | 2 | 2 | 2 | true | 0 | 0 |
| 2018-06 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2018-07 | 2 | 2 | 2 | true | 0 | 0 |
| 2018-08 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 1.1102230246251565e-16 |
| 2018-09 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2018-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2018-11 | 2 | 2 | 2 | true | 0 | 0 |
| 2018-12 | 2 | 2 | 2 | true | 0 | 0 |
| 2019-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2019-02 | 2 | 2 | 0 | true | null | null |
| 2019-03 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2019-04 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2019-05 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 2.7755575615628914e-17 |
| 2019-06 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 1.1102230246251565e-16 |
| 2019-07 | 2 | 2 | 2 | true | 0 | 0 |
| 2019-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2019-09 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2019-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2019-11 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2019-12 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2020-02 | 2 | 2 | 1 | true | 0 | 0 |
| 2020-03 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2020-04 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-05 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2020-06 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-07 | 2 | 2 | 2 | true | 0 | 1.1102230246251565e-16 |
| 2020-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-09 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-10 | 2 | 2 | 2 | true | 0 | 0 |
| 2020-11 | 1 | 1 | 1 | true | 0 | 0 |
| 2020-12 | 2 | 2 | 1 | true | 0 | 0 |
| 2021-01 | 2 | 2 | 0 | true | null | null |
| 2021-02 | 2 | 2 | 1 | true | 0 | 0 |
| 2021-03 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2021-04 | 2 | 2 | 2 | true | 0 | 0 |
| 2021-05 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2021-06 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 5.551115123125783e-17 |
| 2021-07 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2021-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2021-09 | 2 | 2 | 2 | true | 0 | 5.551115123125783e-17 |
| 2021-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2021-11 | 2 | 2 | 2 | true | 0 | 0 |
| 2021-12 | 2 | 2 | 2 | true | 0 | 0 |
| 2022-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2022-02 | 2 | 2 | 1 | true | 0 | 0 |
| 2022-03 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2022-04 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2022-05 | 2 | 2 | 2 | true | 0 | 0 |
| 2022-06 | 2 | 2 | 2 | true | 0 | 0 |
| 2022-07 | 2 | 2 | 2 | true | 0 | 0 |
| 2022-08 | 2 | 2 | 2 | true | 0 | 1.1102230246251565e-16 |
| 2022-09 | 2 | 2 | 2 | true | 0 | 5.551115123125783e-17 |
| 2022-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2022-11 | 2 | 2 | 2 | true | 0 | 0 |
| 2022-12 | 2 | 2 | 1 | true | 0 | 0 |
| 2023-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2023-02 | 2 | 2 | 2 | true | 2.7755575615628914e-17 | 1.3877787807814457e-17 |
| 2023-03 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 2.7755575615628914e-17 |
| 2023-04 | 2 | 2 | 2 | true | 0 | 0 |
| 2023-05 | 2 | 2 | 2 | true | 0 | 0 |
| 2023-06 | 2 | 2 | 2 | true | 0 | 2.220446049250313e-16 |
| 2023-07 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2023-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2023-09 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2023-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2023-11 | 2 | 2 | 2 | true | 0 | 0 |
| 2023-12 | 2 | 2 | 2 | true | 0 | 0 |
| 2024-01 | 2 | 2 | 2 | true | 2.7755575615628914e-17 | 0 |
| 2024-02 | 2 | 2 | 2 | true | 0 | 0 |
| 2024-03 | 2 | 2 | 2 | true | 0 | 0 |
| 2024-04 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2024-05 | 2 | 2 | 2 | true | 5.551115123125783e-17 | 0 |
| 2024-06 | 2 | 2 | 2 | true | 0 | 0 |
| 2024-07 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2024-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2024-09 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2024-10 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 0 |
| 2024-11 | 1 | 1 | 1 | true | 0 | 0 |
| 2024-12 | 2 | 2 | 1 | true | 0 | 0 |
| 2025-01 | 2 | 2 | 1 | true | 0 | 0 |
| 2025-02 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-03 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2025-04 | 2 | 2 | 2 | true | 0 | 2.7755575615628914e-17 |
| 2025-05 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-06 | 2 | 2 | 2 | true | 1.1102230246251565e-16 | 1.1102230246251565e-16 |
| 2025-07 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-08 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-09 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-10 | 1 | 1 | 1 | true | 0 | 0 |
| 2025-11 | 2 | 2 | 2 | true | 0 | 0 |
| 2025-12 | 2 | 2 | 1 | true | 0 | 0 |

Cross-file discrepancies (0):

```json
[]
```

## Integrity findings and dry-run status

```json
{
  "passed": true,
  "numericTolerance": 1e-9,
  "integrityErrors": []
}
```

No counts were forced, no duplicate was dropped, and no record/value was created, replaced, rescaled, or interpolated. Differences at floating-point rounding scale are reported above rather than modifying either CSV. Expected 207/108 row counts and 18 zero-quality observations are checks, not substitutes for measured counts.

Limitations: bounding-box AOI only; no exact county polygon statistics or raster/map rendering. No raw QA verification, upstream cause attribution for winter gaps, reconstructed pixel values, independent median verification, or observation-time timezone inference. Monthly data aggregate the existing composites; they are not an independent satellite product.

## Reproduction and approval boundary

Set TERRAPULSE_DATA_ROOT explicitly in the invoking environment, then run `npm run audit` to print this audit. Run `node scripts/auditModisSource.js --report` to also replace only this report in the backend. Missing/unreadable input or absent/relative data root fails; no alternative location is searched. The script imports only Node standard-library modules and contains no MongoDB code.

MongoDB ingestion, DatasetAsset registration, lifecycle promotion, vegetation collections, and vegetation APIs remain blocked pending separate user approval. Regression test results are documented in the README; source dry-run success is not a database integration result.
