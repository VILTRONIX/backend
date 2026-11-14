# Final Engine availability ? Sprint 9

Verified on 14 November 2026 with `TERRAPULSE_ENGINE_ROOT` pointing to the separate Engine repository. No setting was persisted to actual `.env`. A process without configured paths still uses its Backend defaults and can report `missing_manifest`.

| Logical ID | Engine dataset | Required? | Rows | Result |
| --- | --- | --- | ---: | --- |
| `power_monthly` | `nasa_power_monthly_features` | Yes | 432 | available |
| `modis_monthly` | `modis_monthly_features` | Yes | 108 | available |
| `modis_16day` | `modis_16day_features` | Yes | 207 | available |
| `usda_annual` | `crop_annual_features` | Yes | 15 | available |
| `usda_crop_classes` | `crop_class_annual_features` | Yes | 156 | available |
| `usda_crop_transitions` | `crop_transition_features` | Yes | 36 | available |
| `soil_map_units` | `soil_mapunit_features` | Yes | 86 | available |
| `merra2_context` | `merra2_monthly_context_features` | No | 422 | available |

All 1,462 records passed implemented structural checks against the original referenced schemas. Output/schema hashes matched; headers, widths, keys, counts, missingness, coverage and implemented dataset-specific arithmetic passed. The HTTP verifier returned 200 from all ten endpoint shapes and selected one matching record from each dataset.

`structurallyReady` does not mean scientific approval. `verification.scientific` remains `not_assessed`; final-contract support is `supported`; original-source verification remains `not_independently_verified`. Upstream source CSVs and referenced evidence documents were absent in this checkout.

## Retained limitations

- POWER: four separate points, 108 months each, January 2017?December 2025; no county-average inference.
- MODIS monthly: 108 months over 2017?2025; February 2019 and January 2021 retain null statistics.
- MODIS 16-day: 207 dates, 18 no-quality-valid-pixel dates. The declared exact county method uses 37,193 pixel centers; the backend does not independently reconstruct the mask.
- Crops: 2021?2025; grouped code 999 means Other. Forty-seven detailed-class rows retain unresolved source labels.
- Transitions: four consecutive year pairs, each with its own common-valid denominator; county totals do not identify field rotations.
- Soil: 86 static SSURGO IA169 map units; root-zone AWS is null in all 86, never imputed. Other source nulls remain null.
- MERRA-2: two separate coarse cells, 211 months each, June 2008?December 2025. Optional context; native signs/flux units retained; no TSH supplied.

## Unavailable states

| Status | Meaning |
| --- | --- |
| `missing_manifest` | Manifest/root absent |
| `missing_file` | Output absent or logical dataset undeclared |
| `schema_missing` | Schema absent |
| `invalid_schema` | Unsupported assertions, invalid declarations, schema hash failure or metadata contradiction |
| `unsupported_format` | No registered adapter |
| `validation_failed` | Invalid manifest/path/CSV/type/hash/count/key/coverage/arithmetic, resource limit or source change |

Metadata remains inspectable for unavailable known IDs; record reads return 503. Missing inputs never become fabricated rows. A valid source with no matching rows returns an empty successful page. Optional MERRA-2 absence does not block required datasets or Express startup.

Engine availability does not alter Dataset Registry lifecycle, existing MODIS documents or Scenario scientific readiness. SMAP remains excluded.
