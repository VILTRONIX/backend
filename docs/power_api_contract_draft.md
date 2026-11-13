# NASA POWER model and API contract draft

Status: **proposal only, November 13, 2026**. No climate model, collection, index, ingestion service, lifecycle update, or route is implemented. POWER remains working data. Source evidence and unresolved dependencies are in the [preliminary audit](../reports/power_preliminary_source_audit.md).

## Source and registry boundary

The inspected monthly source has 432 rows, DG001-DG004, 108 months per location from 2017-01 through 2025-12. Snapshot SHA-256 is `59e1e97a477f6d32767f5016da8b02dbd20b45f37ad65e33e65468f35aeff097`. All eight actual measurement columns are listed below; WS10M is absent. Units, source timezone, CRS, and raw daily/QA processing remain unverified.

The existing candidate registry parent is `nasa-power-daily`, which currently describes ten daily locations through 2024 and includes WS10M as a target. Linkage of this monthly four-point delivery to that parent must be confirmed. Do not automatically create a second Dataset, alter the existing registry metadata, treat the daily target list as the monthly schema, or mark the dataset ready. A separately identified derived dataset is an option for future review if the data team determines this is a distinct product.

A future approved import could register one processed CSV with existing DatasetAsset: actual filename/size/checksum, NDVI-independent POWER parameter names, monthly coverage, and point-location provenance. Private storageUri/internal evidence remain hidden via existing DTO conventions. No asset or planned record identifier in this document corresponds to a newly created MongoDB document.

## Proposed ClimateObservation document

Suggested collection name: `climate_observations`. No collection has been created. Use JavaScript ES Modules and connection-bound Mongoose only after authorization. One document represents one location-month from one approved immutable source asset; POWER is not combined with MERRA-2 or MODIS.

| Proposed field | Type and rules | CSV/source mapping |
| --- | --- | --- |
| datasetId | Required existing Dataset ObjectId | Resolve the approved registry parent; never invent an ID. |
| sourceAssetId | Required existing approved DatasetAsset ObjectId | Future asset registration only after approval. |
| sourceChecksum | SHA-256 string | Immutable source bytes, not a guessed version. |
| sourceFile | Safe basename | power_monthly_by_location.csv; never an absolute path in public output. |
| sourceState | Working/approved version metadata | Working now; a future serving gate requires separately approved source/version. |
| locationId | Required stable string | location_id, unchanged. |
| position.latitude / longitude | Finite numbers with conventional axis bounds | latitude / longitude, unchanged. |
| position.crs / crsStatus | null / unverified until documented | No CRS assertion from column names alone. |
| resolution | monthly | Actual row granularity, not the registry's reported daily resolution. |
| periodKey | Valid YYYY-MM | Derived formatting of the original year/month; originals also retained. |
| year / month | Integers; month 1-12 | year / month, unchanged. |
| monthStart / monthEnd | Valid YYYY-MM-DD calendar strings | month_start / month_end, unchanged; must match calendar bounds. |
| daysExpected / daysPresent | Safe non-negative integers; present <= expected | days_expected / days_present. Calendar checks include leap years. |
| complete | Boolean | Exact source True/False; cannot certify per-variable QA by itself. |
| values | Explicit finite-number-or-null fields, exact keys below | No omitted source measurement or synthesized variable. |
| variableMetadata | Fixed keys with unit=null, unitStatus=unverified until supported | Future approved sidecar supplies authoritative units/aggregation semantics. |
| spatialScope | point_locations | Four separate requested/extracted locations; sampling meaning pending. |
| countyMaskApplied / exactCountyStatistics | false / false | No county-wide aggregation or mask. |
| countyCoverageStatus | unverified | Point delivery does not establish county representativeness. |
| studyAreaId / studyAreaRelationship | Optional existing pilot ObjectId / pilot_context_only | No containment, footprint, or area-average assertion. |
| processingMetadata | Bounded, whitelisted provenance | Generator/version, source method, timezone/QA/missing-data/units verification statuses. No invented metadata. |
| importedAt / contentHash | Future import timestamp / internal canonical payload hash | Conflict detection and provenance, never added to this working CSV. |

Preserve measurement keys inside `values` exactly:

```text
T2M_mean
T2M_MAX_mean
T2M_MIN_mean
PRECTOTCORR_total
PRECTOTCORR_daily_mean
ALLSKY_SFC_SW_DWN_total
ALLSKY_SFC_SW_DWN_daily_mean
RH2M_mean
```

This explicitly maps every one of the 18 CSV columns. No WS10M field is proposed. Keep null distinct from zero; future source-specific sentinel handling must be approved before import. No interpolation or unit conversion is proposed. The source currently has no missing values, but a future version may do so. Missing identity/calendar/control fields should fail validation rather than defaulting them. Do not automatically infer physical-value rejection limits while units/QA are unverified.

Do not generate a GeoJSON Point or a 2dsphere index until the source coordinate reference system is confirmed. StudyArea currently accepts polygons only; point locations do not justify changing that model or storing four new StudyArea documents. Native POWER grid/cell resolution and representative support remain unknown.

Proposed indexes, **not created**:

```javascript
// One location-month per approved immutable asset version.
{ datasetId: 1, sourceAssetId: 1, locationId: 1, resolution: 1, periodKey: 1 } // unique
// Optional later, if cross-location date-query measurements justify it:
{ datasetId: 1, sourceAssetId: 1, resolution: 1, periodKey: 1, locationId: 1 }
```

A changed source checksum should identify a reviewed new delivery, not silently overwrite an existing asset/observation. Final version/supersession policy is an outstanding data-team decision. The serving layer must select exactly one approved asset version before filtering; it must never combine duplicate location-months from multiple snapshots. This draft recommends immutable version-scoped identities so revised deliveries remain distinguishable. It does not authorize any version writes.

Do not use MODIS's `processedSummaryAvailability` unchanged: its current schema requires bounding_box_aoi. A future approved point-summary availability representation must be designed separately and preserve existing MODIS behavior. Source availability, scientific approval, raw acquisition, lifecycle readiness, and exact county coverage are separate facts. Existing readiness rules remain active + downloaded + validated + completed, and no state transition is part of this sprint.

## Proposed endpoints and filtering

| Proposed GET path | Meaning |
| --- | --- |
| /api/v1/observations/climate | Paginated monthly location records. |
| /api/v1/observations/climate/summary | Selected monthly statistics, grouped by individual location. |
| /api/v1/observations/climate/ | Trailing-slash alias of the listing endpoint, with identical behavior. |

The third user-specified path is a trailing slash, not a date parameter. No extra detail route is assumed. An optional future location/month detail route would need a separately agreed unambiguous identity and is outside this draft's required endpoints. All paths above remain unimplemented; current routing should return the existing generic 404.

| Filter | Proposed rules |
| --- | --- |
| locationId | Optional single exact ID from the selected approved asset's location inventory. This snapshot has DG001-DG004. Omitted means all locations, with summaries still grouped separately. Empty/malformed values return400; a well-formed unknown ID yields empty results. |
| startDate / endDate | Optional valid YYYY-MM calendar month, inclusive; start must not follow end. Reject YYYY-MM-DD for these monthly routes rather than silently truncating. Omitted bounds use the approved version's available range. A selection outside coverage yields empty results. |
| variables | Optional comma-separated list of distinct exact measurement keys from the eight-field allowlist above. Default all available keys. Reject unknown keys, WS10M, duplicate/empty tokens, arrays/operator-like/repeated parameters. Reject unsupported variables rather than returning synthetic null fields. |
| page / limit | Listing and its alias only. Page 1-10000, default1; limit1-100, default20, matching existing backend conventions. Summary rejects pagination filters because it summarizes the full selected date range by point. |

The provisional location-ID format is uppercase letters/digits, 1-64 characters; final grammar must be confirmed by the location dictionary. Reject unknown query parameter names, non-scalar values, invalid dates, SQL/Mongo-style operators, and duplicate query keys. Sort listing by locationId, periodKey, then _id within the single approved source version. Projection via variables never removes identity, source version, coordinates, calendar/completeness fields, or mandatory scientific limitations.

These endpoints initially select only the approved NASA POWER source. There is no implicit MERRA-2 fallback, merging, interpolation, or source mixing. If another climate provider is later approved, its explicit product/source selection contract must be designed first.

## Proposed listing response

Illustrative shape using actual DG001 January 2017 values from the CSV for a one-month, two-variable selection. This is documentation, not a live API/database result. A future approved source reference must replace the pending registry relationship.

```json
{
  "success": true,
  "data": {
    "items": [{
      "locationId": "DG001",
      "position": { "latitude": 41.8914, "longitude": -93.3975, "crs": null, "crsStatus": "unverified" },
      "resolution": "monthly",
      "periodKey": "2017-01",
      "year": 2017,
      "month": 1,
      "monthStart": "2017-01-01",
      "monthEnd": "2017-01-31",
      "daysExpected": 31,
      "daysPresent": 31,
      "complete": true,
      "values": { "T2M_mean": -4.499032258064516, "PRECTOTCORR_total": 47.85 },
      "source": {
        "fileName": "power_monthly_by_location.csv",
        "checksum": "59e1e97a477f6d32767f5016da8b02dbd20b45f37ad65e33e65468f35aeff097"
      }
    }],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
    "metadata": {
      "provider": "NASA",
      "product": "POWER",
      "sourceState": "working_snapshot_not_approved",
      "registryRelationshipStatus": "pending_data_team_confirmation",
      "resolution": "monthly",
      "variables": ["T2M_mean", "PRECTOTCORR_total"],
      "variableMetadata": {
        "T2M_mean": { "unit": null, "unitStatus": "unverified", "sourceStatistic": "mean" },
        "PRECTOTCORR_total": { "unit": null, "unitStatus": "unverified", "sourceStatistic": "total" }
      },
      "timezone": "unknown",
      "spatialScope": "point_locations",
      "countyMaskApplied": false,
      "exactCountyStatistics": false,
      "countyCoverageStatus": "unverified",
      "studyAreaRelationship": "pilot_context_only",
      "rasterRenderingSupported": false,
      "limitations": [
        "Individual point records; no exact county-wide average or spatial extrapolation.",
        "Units, CRS, timezone, raw daily QA, and extraction support require data-team verification.",
        "WS10M is absent; no interpolation, inferred variable, or MERRA-2 combination."
      ]
    }
  },
  "requestId": "<request UUID>"
}
```

Future DTOs may include actual public Dataset/Asset/Observation IDs after approval; none is invented here. Private storageUri, absolute filesystem paths, evidence references, internal asset metadata/contentHash, credentials, and stack traces must be omitted. The scientific metadata above is mandatory on the listing, alias, and summary, including empty successful responses. SourceState should reflect the approved selected delivery when serving becomes authorized; this example intentionally identifies today's working snapshot as unapproved.

## Proposed summary response and semantics

Use `{ success: true, data: { items: [...perLocationSummaries], metadata: {...} }, requestId }`. Always group by locationId; requesting all four locations returns four separate summaries with their coordinates. Global metadata may report record/location counts, but no cross-location weather mean/total or county summary is proposed.

Each item would include:

- locationId and the unmodified position/provenance.
- resolution=monthly and periodRange `{ start, end }` for existing selected records; explicit requestedRange separately.
- recordCount, declaredCompleteCount, declaredIncompleteCount. These reflect source flags, not scientific quality approval.
- expectedMonthCount for the selected bounded calendar, missingMonths for absent location-month rows, and incompletePeriods for existing rows declaring incomplete. Keep these distinct from null variable values.
- summed expected/present **location-days** for that location only, never unique county days or per-variable valid-day claims.
- statistics per selected exact variable key: `availableValueCount`, `missingValueCount`, `minimumMonthlyValue`, `maximumMonthlyValue`, `unweightedAverageMonthlyValue`, `missingPeriods`, `sourceStatistic`, unit, and unitStatus.

For a mean column, extrema/average are across source monthly means. For a total column, they are across source monthly totals. They are never daily/pixel extrema; sourceStatistic labels prevent confusing monthly total and daily mean. Do not sum mean fields, pool points, silently weight periods by days, reconstruct annual totals, or expose a derived physical calculation before units and aggregation policy are approved. The draft's descriptive averages are optional serving behavior to confirm with the data team, not a claim of scientific validation.

Ignore null values for per-variable statistics, preserve genuine zeros, and return null min/max/average when no values exist. Available means finite/non-null source values, not approved QA. For an approved known location with zero selected rows, its summary has recordCount0, null periodRange/statistics, and missingMonths relative to the explicit bounded request; do not fabricate observation rows. Unknown locations return items=[] with mandatory metadata. When bounds are omitted, resolve them from the selected approved delivery to avoid unbounded calendar enumeration; validate and bound final range lengths during implementation.

A source flag can be true even if future raw parameter QA is incomplete. Do not automatically label complete rows scientifically valid or silently drop incomplete rows. Return original flags plus separate missing/incomplete diagnostics. Parameter-specific valid-day counts must come from approved source metadata, not from shared days_present alone.

## Proposed error responses and serving gates

Preserve the existing error envelope, for example:

```json
{
  "success": false,
  "error": { "code": "VARIABLE_UNAVAILABLE", "message": "Requested variable is not available in the selected POWER source." },
  "requestId": "<request UUID>"
}
```

Proposed status rules: 400 for invalid filters/unsupported variables; 200 with empty items or null statistics for valid empty selections; 503 for disconnected MongoDB or an unavailable approved source version (distinct safe error codes); generic500 for unexpected failures. A missing approved serving version must not silently expose working data. No 201/write route, public importer, new authentication scheme, or lifecycle mutation is proposed. Today the routes remain absent and use existing404 handling.

Before implementation/import: resolve the registry parent/granularity mismatch, approve final source/version/checksum, document units/CRS/timezone/QA/missing-value and aggregation policies, confirm location identities and WS10M scope, agree snapshot supersession and summary semantics, and obtain explicit user authorization. Keep all existing MODIS contracts and provenance restrictions intact.
