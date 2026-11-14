# TerraPulse frontend integration guide

Audit date: November 13, 2026. Repository revision inspected: `43d6acfb5e46310c0802a0d1091dd0761a5ad5d8`. This is a read-only audit of the existing application, not a feature implementation or database import.

Quick links: [readiness matrix](#verified-readiness-matrix), [endpoint contracts](#endpoint-contracts-and-frontend-fields), [PowerShell examples](#powershell-integration-examples), [JavaScript examples](#javascript-fetch-integration-examples), [captured responses](#actual-response-evidence).

## Current decision

**Data integration is NOT READY in the running environment.** The existing server at `http://localhost:5000` is alive, but MongoDB is disconnected. `/health/ready` returns 503 and Study Areas, Dataset Registry, coverage, assets, and vegetation requests return 503. An independent read-only Atlas connection failed both inside and outside restricted execution. The unrestricted probe reported `MongooseServerSelectionError` with three `MongoNetworkError` causes carrying `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`.

That is evidence of an Atlas TLS connectivity blocker, not proof of its underlying cause. No credentials, network settings, TLS options, application logic, lifecycle states, or records were changed to bypass it. The existing local server was not stopped or restarted.

Frontend work can integrate/test liveness, metadata, CORS, structural geometry validation, request IDs, and failure states now. Successful data rendering, pagination results, live county geometry, observation counts/nulls, asset inventory, and API/database parity must be verified after Atlas connectivity is restored. Earlier sprint reports are historical evidence only and are not substituted for current database verification.

## URLs, origins, and frontend environment

- Backend root: **http://localhost:5000**.
- API base: **http://localhost:5000/api/v1**.
- Health base: **http://localhost:5000/health**; health is outside `/api/v1`.
- Source configuration: development, port 5000, MongoDB configured, allowed client origins **http://localhost:5173** only.
- Live CORS checks: this exact origin is allowed, including a real GET and an OPTIONS preflight. `http://localhost:3000`, `http://127.0.0.1:5173`, and `https://frontend.example.com` were rejected 403. Requests without Origin, such as PowerShell, are allowed.
- Allowed responses reflect the exact origin, include `Vary: Origin`, and expose `X-Request-ID`. No wildcard origin or `Access-Control-Allow-Credentials` was returned. No cookie or Authorization header is required by the implemented routes.
- The default CORS preflight advertises GET, HEAD, PUT, PATCH, POST, DELETE; this is middleware policy, not evidence that write endpoints exist. Only the actual route inventory below is implemented.
- The browser can call this backend directly from **http://localhost:5173**, but data requests currently return 503. CORS permission and database readiness are separate checks. A different frontend origin is currently blocked; this audit did not edit CORS.

Recommended frontend setting for the Vite examples below:

```dotenv
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

This is a frontend convention proposed by this guide, not an existing backend environment variable or a change to either `.env`. No frontend exists in this repository. Keep MongoDB configuration on the backend only. On another developer's computer, localhost refers to that computer; remote access to this machine was not tested.

## Verified readiness matrix

HTTP Tested reports observed responses, not a claim that a nominal success path passed. Database Verified means current records were independently read and compared; no such read succeeded during this audit.

| Endpoint (relative to backend root) | Implemented | HTTP Tested | Database Verified | Frontend Ready |
| --- | --- | --- | --- | --- |
| GET / | Yes | 200 | N/A | READY |
| GET /health/live | Yes | 200 | N/A | READY |
| GET /health/ready | Yes | 503 NOT_READY | No; disconnected | NOT READY |
| GET /api/v1/meta | Yes | 200, degraded | N/A; connection state only | READY WITH LIMITATIONS |
| GET /api/v1/study-areas | Yes | 503; invalid filters 400 | Blocked | NOT READY |
| GET /api/v1/study-areas/ | Yes, list alias | 503 | Blocked | NOT READY |
| GET /api/v1/study-areas/:id | Yes | 503; invalid ID 400 | Blocked | NOT READY |
| GET /api/v1/study-areas/:areaId/coverage | Yes | 503; invalid ID 400 | Blocked | NOT READY |
| POST /api/v1/areas/validate | Yes, non-persisting | 200; invalid input 400/413 | Structure N/A; intersection blocked | READY WITH LIMITATIONS |
| GET /api/v1/datasets | Yes | 503; invalid filters 400 | Blocked | NOT READY |
| GET /api/v1/datasets/ | Yes, list alias | 503 | Blocked | NOT READY |
| GET /api/v1/datasets/:slug | Yes | 503; invalid slug 400 | Blocked | NOT READY |
| GET /api/v1/datasets/:slug/assets | Yes | 503; invalid type 400 | Blocked | NOT READY |
| GET /api/v1/datasets/:slug/coverage | Yes | 503 | Blocked | NOT READY |
| GET /api/v1/observations/vegetation | Yes | 503; invalid filters 400 | Blocked | NOT READY |
| GET /api/v1/observations/vegetation/ | Yes, list alias | 503 | Blocked | NOT READY |
| GET /api/v1/observations/vegetation/summary | Yes | 503; missing resolution 400 | Blocked | NOT READY |
| GET /api/v1/observations/vegetation/:date | Yes | 503; invalid period 400 | Blocked | NOT READY |

The source implements 15 route handlers plus the three tested trailing-slash list aliases. The prompt's `/study-areas//coverage`, `/datasets//assets`, and `/datasets//coverage` contain missing path parameters. All three literal URLs returned 404; they are not usable shortcuts. Substitute the actual area ID or dataset slug as shown below. `/observations/vegetation/` is a listing alias, not an observation lookup.

## Shared response and error handling

Successful JSON bodies use `success`, `data`, and `requestId`. Errors use `success:false`, `error.code`, `error.message`, optional `error.details`, and `requestId`. These are real application keys; complete captured JSON is included later. No success body for a database-backed endpoint was captured in this environment, so none is fabricated below. Source-derived success fields are explicitly identified as contracts to verify after reconnection.

- `Content-Type: application/json; charset=utf-8` was verified on JSON responses.
- A fresh server-generated UUID is supplied in `X-Request-ID` and JSON `requestId`; the audit checked equality for every JSON capture. A caller-supplied request ID was ignored. Include the returned ID in support logs.
- Browser fetch does not reject HTTP 400/503 automatically. Check both `response.ok` and `body.success` before reading data. A CORS rejection can surface as a network TypeError, without browser-readable error JSON.
- Domain validation 400, CORS 403, missing route 404, oversized request 413, and disconnected database 503 were observed. A well-formed nonexistent dataset/area/period returned 503 during the outage, so its intended database 404 behavior could not be live-verified. The existing unit tests verify those missing-record branches.
- No stack trace or MongoDB connection string appeared in captured responses. Security headers include `X-Content-Type-Options: nosniff`; the Express identification header is disabled in source.
- List data uses `items` and `pagination: { page, limit, total, totalPages }`. Source defaults: page 1, limit 20; bounds page 1-10000 and limit 1-100. The bounds were live-checked with invalid requests, but actual list totals/pages remain blocked.
- UI loading: keep a separate loading state per resource; cancel stale requests when filters change. Do not interpret loading/failure as an empty dataset.
- UI empty: only show a no-results state after successful 200 with an empty items array. A successful summary with no values has null statistics, not zero. Current 503 is an unavailable state, never an empty result.
- UI errors:400 means correct the query/input;403 from a browser Origin means configuration/origin mismatch;404 means missing route or a confirmed absent entity;413 means reduce the request;503 means show service unavailable with retry and request ID. Use bounded retries, not a tight retry loop.
- GET requests need only Accept:application/json. For geometry validation, use Content-Type:application/json. Express limits are100 KiB normally and 1 MiB for `/areas/validate`; geometry validation separately limits geometry to 512 KiB and 20,000 positions.

## Endpoint contracts and frontend fields

The success contracts in this section come from the actual controllers/services/DTOs, not fixture responses. Current HTTP outcomes and corresponding captured-body IDs are provided for every route. IDs refer to the evidence appendix. Fields explicitly called optional must not be assumed to exist in all records.

### Welcome, liveness, readiness, metadata

| Method and full URL | Parameters | Frontend fields and behavior | Evidence |
| --- | --- | --- | --- |
| GET http://localhost:5000/ | None defined | data.message, data.apiVersion. Static welcome. | welcome (200) |
| GET http://localhost:5000/health/live | None defined | data.status=alive means process alive, not data availability. | live (200) |
| GET http://localhost:5000/health/ready | None defined | On success: data.status and data.database.{configured,ready,name,status}. Current error.details.database shows configured=true, ready=false, name=null, status=disconnected. | ready (503) |
| GET http://localhost:5000/api/v1/meta | None defined | data.project, apiVersion, pilotLocation, environment, serviceStatus. Observed serviceStatus=degraded. This is not a scientific dataset-readiness flag. | meta (200) |

Successful welcome/liveness/metadata bodies and readiness failure are captured verbatim below. No successful readiness body was observed. A forbidden Origin is an error case for these routes too; the shared CORS capture shows its actual 403 shape. Loading recommendation: lightweight status indicator. No-results state is not applicable; a failed probe is not evidence that the process or a dataset is missing.

### Study Area listing and geometry

Full URLs:

```text
GET http://localhost:5000/api/v1/study-areas
GET http://localhost:5000/api/v1/study-areas/
GET http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed
```

List query parameters, all encoded as single strings:

| Name | Accepted values/default |
| --- | --- |
| geoid | Optional exact five-digit string; use 19169. |
| areaType | county, user_drawn, verified_field, illustrative_demo. |
| includeGeometry | true/false; defaults false. |
| page / limit | Shared bounds/defaults above. |

Lists select active areas, sort by name then _id, and omit geometry by default. The exact detail path parameter `id` must be a 24-character hexadecimal ObjectId; the provided Story County ID above passes format validation. Detail success directly places the area document in data, with geometry included. It is a GeoJSON geometry object, not a FeatureCollection. No detail query filters are defined.

Frontend fields: `_id` (not id), name, slug, geoid, areaType, geometryStatus, isActive; use optional state/stateCode/country/countryCode for labels. Geometry is `data.geometry.{type,coordinates}` for detail, or `data.items[i].geometry` only with includeGeometry=true. Source metadata is geometrySource and metadata, including the stored CRS if present; do not read coordinates from the default lightweight list.

Evidence: areas, areas-slash, story-list, story-list-geometry, story-detail all 503; story-invalid-id, story-invalid-query, story-invalid-page, story-repeated-geoid all 400. Pagination page 2 and an empty geoid selection were attempted but blocked 503. Successful geometry availability/coordinates in Atlas are not currently verified.

Independent local artifact inspection, **not a live database/API result**: checked-in `data/seed/story-county.geojson` is Polygon with a closed 1,050-position ring, EPSG:4326, longitude bounds[-93.698767,-93.231443], latitude bounds[41.862572,42.209397], first/last coordinate[-93.463043,42.209302]. Submission of that actual artifact to the non-writing validation endpoint returned valid=true, geometryType=Polygon, coordinateCount=1050, with pilotIntersection unavailable. It does not prove the stored county matches the artifact today.

Loading: show area-list/map loading separately. Empty: successful items=[] means no matching active area; missing geometry is distinct from an empty area list. Errors: validate ID/filter formats before requesting; show 503 as unavailable and do not draw a fabricated boundary. Successful response JSON was unavailable; actual 503 and 400 bodies appear in the appendix.

### Study Area geographic coverage

```text
GET http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed/coverage
```

Path parameter areaId is the same hexadecimal ObjectId. Query parameters are the Dataset list filters documented below, including provider/category/readiness/page/limit. A tested focused request was `?provider=NASA&category=vegetation&limit=1`.

Source-derived success shape: data.studyArea, data.items, data.pagination. Each item has dataset, coverage, datasetTemporalCoverage, readiness, availability, limitations, and optional processedSummaryAvailability for a matching pilot relationship. Availability contains status, available (true/false/null), analysisReady. The area coverage's temporal bounds are separate from the broader datasetTemporalCoverage. `available:null` is unknown, not false. Reported/global product coverage is not verified county coverage.

Evidence area-coverage 503 and area-coverage-invalid 400. A nonexistent valid area ID also returned 503, not a verified database 404. No successful JSON or current county coverage state could be captured. Loading: independent coverage panel. Empty: successful items=[] means no datasets match filters. Error: preserve unknown/unavailable status rather than claiming there is no coverage.

### Non-persisting geometry validation

```text
POST http://localhost:5000/api/v1/areas/validate
Content-Type: application/json
```

No path/query filters are defined. Request body requires geometry, a Polygon or MultiPolygon GeoJSON geometry in longitude/latitude order. No submitted boundary is saved. The audit used the checked-in official polygon, never a fabricated county.

Actual success fields are data.valid, geometryType, coordinateCount, validationErrors, warnings, pilotIntersection. Structurally invalid geometry can return 200 with valid=false; it is not necessarily an HTTP 400 error. pilotIntersection contains status, intersects, fullContainment and a reason when unavailable. The real official-artifact capture returned unavailable/DATABASE_UNAVAILABLE, intersects=null, fullContainment=not_evaluated. True intersection, when operational, is not full containment.

Evidence: validate-official-artifact 200, validate-invalid-geometry 200 / valid=false, validate-missing-geometry 400, validate-invalid-json 400, validate-oversized-body 413. Loading: disable repeated validation while a request is active. Empty: absent input is an input error. Error: display structural validationErrors separately from HTTP failure or unavailable intersection. Self-intersections, hole relationships, full topology, and full containment are not implemented.

### Dataset listing and metadata

```text
GET http://localhost:5000/api/v1/datasets
GET http://localhost:5000/api/v1/datasets/
GET http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061
```

List filters:

| Parameter | Accepted values/default |
| --- | --- |
| provider | NASA, USDA, USGS. |
| category | vegetation, climate, soil_moisture, soil, crop_history, imagery. |
| readiness | ready, not_ready, failed. Failed is a separate category, not included in not_ready. |
| acquisitionStatus | pending, request_completed, reported_available, downloaded, failed. |
| validationStatus | pending, partially_validated, validated, failed. |
| processingStatus | not_started, in_progress, completed, failed. |
| isActive | true/false; defaults true. |
| search | Literal case-insensitive substring,1-100 characters, across name/slug/productId/description. Not a regular expression. |
| page / limit | Shared bounds/defaults above. |

Unknown/repeated query keys, operator-like input, bad enums, invalid booleans, and invalid pagination are rejected by the parsers. Lists sort by slug then _id. Detail has path parameter slug: lowercase letters/digits with single hyphens, maximum 120 characters. No detail query filters are defined. Invalid slug 400 was captured; a well-formed missing slug was blocked 503 before its database existence could be checked.

Source-derived frontend fields: `_id`, slug, name, provider, category, productId/productCollection/version where known, description, purpose, optional, variables, temporalCoverage, spatialCoverage, spatialResolution, temporalResolution, source, acquisition, validation, processing, readiness, limitations, tags, isActive, createdAt, updatedAt; processedSummaryAvailability is optional. Variables include name/displayName/unit/description/availabilityStatus; unit may be null and target/reported is not verified presence.

Readiness has status, ready, scope, blockers. It requires active + acquisition.downloaded + validation.validated + processing.completed and does not independently certify geographic/scientific fitness. A processed MODIS summary may be available while overall readiness remains false because raw acquisition is unverified. Do not suppress legitimate processed-summary capability solely because readiness.ready=false; inspect the separate metadata when it can be fetched.

Evidence datasets/datasets-slash, each provider, climate/vegetation categories, all three readiness categories, pagination, lifecycle filters, inactive and empty search requests all returned 503. Invalid provider/page/slug returned 400. Successful filter counts and actual registry detail remain unverified. Loading: catalog skeleton. Empty: successful empty items means no matches, not a missing module. Errors:503 is a service outage; future verified 404 for detail is a missing registry entry, not an empty catalog.

### MODIS assets and dataset coverage

```text
GET http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets
GET http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/coverage
```

Path parameter slug uses the rules above. Assets query accepts assetType=raw|processed|metadata and page/limit. Coverage defines no query filters. Tested processed/raw asset filters both returned 503; invalid assetType returned 400. Coverage returned 503.

Assets success contract: data.dataset, data.items, data.pagination. Public items whitelist `_id`, datasetId, assetKey, assetType, fileName, format, sizeBytes, checksum, checksumAlgorithm, storageType, discoveredAt, dateStart/dateEnd, timezone, crs, variables, validationStatus, processingStatus, createdAt, updatedAt. Never expect a download URL or storageUri; private local paths/internal metadata are intentionally hidden. A sanitized unsafe legacy filename can be null. Asset dates can have day/month precision; preserve the returned form.

Coverage success contract: data.dataset, temporalCoverage, spatialCoverage, readiness, limitations, warning, and optional processedSummaryAvailability. Spatial coverage unknown/reported is not exact county verification. Loading: independent source/coverage panels. Empty: successful empty assets means no registered assets matching the filter, not that raw data have been verified absent. Error: show metadata unavailable on 503. No live 200 response or actual asset count was captured.

### Vegetation listing, history, and period lookup

```text
GET http://localhost:5000/api/v1/observations/vegetation
GET http://localhost:5000/api/v1/observations/vegetation/
GET http://localhost:5000/api/v1/observations/vegetation/2017-01-01
GET http://localhost:5000/api/v1/observations/vegetation/2019-02?resolution=monthly
```

| Parameter | Listing | :date lookup | Rules |
| --- | --- | --- | --- |
| resolution | Yes | Yes | 16day or monthly; default 16day. |
| areaId | Yes | Yes |24 hexadecimal characters; pilot context only. |
| geoid | Yes | Yes | Five digits; use 19169. |
| startDate / endDate | Yes | No | Inclusive YYYY-MM-DD for16day; inclusive YYYY-MM for monthly. Start <= end. |
| page / limit | Yes | No | Shared bounds/defaults above. |

Listing defaults to the registered Story County pilot context. Valid nonmatching area filters return empty data by source contract, not containment results. Listing sorts by periodKey then _id. Lookup path date must match its resolution exactly; it is not an arbitrary daily climate lookup. No variables filter exists for vegetation: both indices are returned. Summary has different query rules below. Unknown/repeated parameters are rejected.

Source-derived listing success fields: data.items, data.pagination, data.metadata. Lookup uses data.observation and data.metadata. Each observation includes identity/reference fields, periodKey, observationDate, resolution, ndviMean/Median/Std, eviMean/Median/Std, each variable's ValidPixelCount and ValidPixelPercentage, sourceFile/sourceChecksum/sourceAssetId, importedAt, missingDataStatus, processingMetadata, and explicit spatial flags. Monthly rows additionally preserve month, observationCount, totalPixelObservations; composites carry totalPixelCount, baseValidPixelCount, qualityValidPixelCount, viUsefulnessDistributionBeforeFilter, viUsefulnessDistributionAfterFilter. Resolution-specific absent fields must not be treated as zeros.

Metadata includes provider, product, variables, nativeSpatialResolutionMeters, temporalResolution, aoiKey, spatial provenance, studyArea pilot context, dataLevel, rasterRenderingSupported, processing, limitations, sourceAssets, rawProductAcquisitionStatus, datasetReadiness, processedSummariesAvailable, requestedFilters. Internal contentHash and private storage fields are omitted.

Scientific UI requirements from the actual implementation: NASA MOD13Q1.061; native 250 m; bounding_box_aoi; countyMaskApplied=false; exactCountyStatistics=false; countyCoverageStatus=unverified; studyAreaRelationship=pilot_context_only. These are area summaries of an unknown exact bounding-box footprint, not exact county-polygon statistics and not pixel-level map/raster data. Do not color every county pixel as if clipped. NDVI/EVI are already decoded: no extra 0.0001 multiplier.

Historical approved-source expectations:18 composite rows have null NDVI/EVI measurements and zero quality-valid pixels; February 2019 and January 2021 have existing monthly rows with null measurements. Preserve null as a chart gap/missing label, never0 or interpolation. The actual current database nulls and values could not be read in this audit.

Evidence: both resolutions, both list forms, date/area filters, page 3, lookup, both no-data months, and empty selections returned 503. Date-format/granularity/range, repeated resolution, unknown filter and invalid area tests returned 400. A valid but nonexistent composite date returned 503, not a live-verified 404. Loading: chart skeleton independent of source metadata. Empty: successful items=[] means no selected records; null is an existing missing observation. Error: never fill chart history from fabricated values during 503.

### Vegetation summary

```text
GET http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly
```

Required query: resolution=16day|monthly. Optional: areaId, geoid, startDate/endDate with the same inclusive formats above. Pagination is not accepted; the aggregation spans the selected records, not one page. Both monthly/16day requests were attempted. Missing resolution returned 400 / RESOLUTION_REQUIRED; summaries for full range, empty range, and February 2019 null-only range were blocked 503.

Source-derived success data fields: resolution, recordCount, validObservationCount, missingObservationCount, periodRange.{start,end}, statistics.{ndvi,evi}, statisticScope, missingPeriods, pixelCoverage, metadata. Each variable has validPeriodCount, averagePeriodMean, minimumPeriodMean, maximumPeriodMean. ValidObservationCount requires both means present; per-variable counts are separate. Average is unweighted across available period means. Min/max are across period-level means, not raw pixels. Nulls are excluded; all-null/empty statistics remain null, never0.

Pixel coverage contains unit, totalPixelObservations, ndviValidPixelObservations, eviValidPixelObservations, ndviValidPixelPercentage, eviValidPixelPercentage. These count repeated pixel-observations across periods, not unique pixels or county area. missingPeriods lists existing selected rows with unavailable means, not newly created calendar records. The metadata and bounding-box warning are mandatory frontend context.

Loading: summary skeleton separate from history pagination. Empty: successful recordCount=0 with null statistics; existing all-null rows retain a positive recordCount and missing-period labels. Error: show unavailable on 503, not zero productivity/vegetation. No actual summary 200 or null-statistic JSON could be captured during this outage.

## Database verification and unavailable features

| Required Atlas check | Expected from prior approved import | Current audit result |
| --- | ---: | --- |
| 16day MODIS observations | 207 | Not verified: TLS connection failure. |
|Monthly MODIS observations | 108 | Not verified: TLS connection failure. |
|Total MODIS observations | 315 | Not verified: TLS connection failure. |
|Processed MODIS DatasetAssets | 2 | Not verified: TLS connection failure. |
|Story County document/geometry and coverage | Provided ID/GEOID; prior official Polygon | Live read blocked; local artifact only inspected. |
|API values/counts match Atlas | Required | Not established in this audit. |

No records, collections, indexes, assets, or lifecycle states were written. The separate Atlas probe disabled autoCreate/autoIndex and closed only its own connection. Existing Atlas integration tests also use their own read-only connections; they do not stop the server on port 5000. Reconnection is required before current data-integrity approval.

| Feature | Source inspection / HTTP evidence | Classification |
| --- | --- | --- |
| NASA POWER Climate APIs | Audit script and contract draft only; climate listing/summary/trailing-slash URLs 404. | NOT IMPLEMENTED |
| MERRA-2 Climate APIs | Registry metadata only; no climate handler/provider fallback; climate?provider=MERRA-2 returned 404. | NOT IMPLEMENTED |
| SMAP APIs | Registry entry, no observation route; observations/smap 404. | NOT IMPLEMENTED |
| Crop History APIs | Registry metadata only; crop-history 404. | NOT IMPLEMENTED |
| Soil APIs | Registry metadata only; soils 404. | NOT IMPLEMENTED |
| Scenario Comparison APIs | No module/route; scenarios and scenarios/compare 404. | NOT IMPLEMENTED |
| Crop Rotation Recommendation Engine | No engine/module/route; recommendations 404. | NOT IMPLEMENTED |

HTTP paths for absent modules above are probes, not promised contracts. The source route inventory, not a single guessed 404, establishes absence. Dataset Registry entries for these products do not make data APIs available or scientifically ready.

## PowerShell integration examples

These are correct requests for the existing contracts. At the audited state the data calls report 503; successful data display remains blocked until readiness recovers. Do not treat the outage as empty data. The helper uses Windows PowerShell-compatible Invoke-RestMethod and prints a request ID from JSON errors when available.

```powershell
$Backend = 'http://localhost:5000'
$Api = "$Backend/api/v1"
$AreaId = '6af71070cca3d14ecfec0aed'
$Modis = 'nasa-modis-mod13q1-061'

function Get-TerraPulseData {
    param([Parameter(Mandatory=$true)][string]$Path)
    try {
        $body = Invoke-RestMethod -Method Get -Uri "$Api$Path" -ErrorAction Stop
    } catch {
        # PowerShell commonly provides JSON error content in ErrorDetails.Message.
        if ($_.ErrorDetails.Message) {
            try {
                $failure = $_.ErrorDetails.Message | ConvertFrom-Json
                Write-Warning "$($failure.error.code): $($failure.error.message); requestId=$($failure.requestId)"
            } catch { Write-Warning 'The API request failed; inspect the HTTP status and server readiness.' }
        }
        throw
    }
    if (-not $body.success) { throw "API error; requestId=$($body.requestId)" }
    return $body.data
}

Invoke-RestMethod "$Backend/health/live"
# This currently throws HTTP 503 and correctly blocks a readiness assumption:
Invoke-RestMethod "$Backend/health/ready"

# Fetch Story County summary metadata (geometry omitted by default).
$areas = Get-TerraPulseData '/study-areas?geoid=19169&areaType=county&limit=1'
$areas.items

# Fetch the county document and its actual geometry after recovery.
$county = Get-TerraPulseData "/study-areas/$AreaId"
$county.geometry

# Fetch the complete 16day history using API pagination, not a hardcoded row count.
$history = @()
$page = 1
do {
    $result = Get-TerraPulseData "/observations/vegetation?geoid=19169&resolution=16day&limit=100&page=$page"
    $history += @($result.items)
    $page++
} while ($page -le $result.pagination.totalPages)
$history | Select-Object periodKey,ndviMean,eviMean,missingDataStatus

# Fetch monthly NDVI/EVI period-mean statistics.
$summary = Get-TerraPulseData '/observations/vegetation/summary?resolution=monthly&geoid=19169'
$summary.statistics

# Fetch registry entries and MODIS details; availability is not implied by registration.
$datasets = Get-TerraPulseData '/datasets?limit=100'
$datasets.items
$modisDetails = Get-TerraPulseData "/datasets/$Modis"
$modisDetails
```

PowerShell does not enforce browser CORS. To reproduce browser policy explicitly:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "$Backend/health/live" -Headers @{ Origin='http://localhost:5173' }
# The different origin below was observed 403:
Invoke-WebRequest -UseBasicParsing -Uri "$Backend/health/live" -Headers @{ Origin='http://127.0.0.1:5173' }
```

## JavaScript fetch integration examples

Use these in a Vite frontend served from the allowed origin. Each function uses actual source field names. They do not hide 503 or fabricate successful responses. Call them inside your UI's loading/error flow; handle AbortError separately when a request is cancelled.

```javascript
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const AREA_ID = '6af71070cca3d14ecfec0aed';

async function apiGet(path, { signal } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal,
  });
  const body = await response.json();
  if (!response.ok || body.success !== true) {
    const error = new Error(body.error?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body.error?.code;
    error.requestId = body.requestId ?? response.headers.get('X-Request-ID');
    throw error;
  }
  return body.data;
}

//1. Story County metadata; returns { items, pagination }.
export const fetchStoryCounty = (signal) =>
  apiGet('/study-areas?geoid=19169&areaType=county&limit=1', { signal });

//2. County detail; read county.geometry.type and county.geometry.coordinates.
export const fetchStoryCountyGeometry = (signal) =>
  apiGet(`/study-areas/${AREA_ID}`, { signal });

//3. Complete paginated MODIS history; retain null means as chart gaps.
export async function fetchVegetationHistory({ resolution = '16day', startDate, endDate, signal } = {}) {
  const items = [];
  let page = 1;
  let data;
  do {
    const query = new URLSearchParams({ geoid: '19169', resolution, limit: '100', page: String(page) });
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);
    data = await apiGet(`/observations/vegetation?${query}`, { signal });
    items.push(...data.items);
    page += 1;
  } while (page <= data.pagination.totalPages);
  return { items, metadata: data.metadata };
}

//4. Monthly summary: summary.statistics.ndvi/evi.averagePeriodMean, not raw pixel extrema.
export const fetchMonthlyVegetationSummary = (signal) =>
  apiGet('/observations/vegetation/summary?resolution=monthly&geoid=19169', { signal });

//5. Available registry entries; inspect separate readiness/summary availability.
export const fetchDatasets = (signal) => apiGet('/datasets?limit=100', { signal });

//6. MODIS metadata and limitations.
export const fetchModisDataset = (signal) =>
  apiGet('/datasets/nasa-modis-mod13q1-061', { signal });

// Example caller; integrate loading state in the chosen UI framework.
try {
  const { items, metadata } = await fetchVegetationHistory();
  const points = items.map(({ periodKey, ndviMean, eviMean }) => ({ periodKey, ndviMean, eviMean }));
  console.log(points, metadata.limitations);
} catch (error) {
  if (error.name !== 'AbortError') {
    console.error({ status: error.status, code: error.code, requestId: error.requestId, message: error.message });
  }
}
```

For monthly history, use resolution=monthly and YYYY-MM bounds. For 16day, use YYYY-MM-DD bounds. Fetch readiness from the backend root rather than appending /health to API_BASE. Bounded pagination totals/items are separate reads and may change under future administrative updates; no such writes were made here.

## Automated results and next verification

- `npm test`: **136 passed, 0 failed** after retrying restricted Node worker startup with the required execution permission.
- `npm run test:integration`: **failed**, 1 test, Atlas did not become ready before its readiness assertion; county data/index/API assertions were not reached.
- `npm run test:datasets:integration`: **failed**, 1 test, Atlas did not become ready; registry data/index assertions were not reached.
- `npm run test:modis:integration`: **failed**, 1 test, Atlas did not become ready; current observation/asset/API parity assertions were not reached. Its source-file validation ran before the connection check, but this is not a database pass.
- Captured HTTP matrix: **94 completed HTTP requests**, covering every implemented handler, list aliases, valid/invalid filters, actual local official-boundary validation, CORS/preflight, missing routes, and unavailable modules. Outcomes: 200 x 6, 204 x 1, 400 x 18, 403 x 4, 404 x 13, 413 x 1, 503 x 51. This is not 94 successful data-contract checks; the 503 cases are blocked success-path verification.
- All 42 JSON response/header blocks in this guide were parsed and matched against the original capture objects. The six documented JavaScript fetch functions were executed with the documented API base substituted for the Vite environment expression; all reached the real server and correctly surfaced its 503/DATABASE_UNAVAILABLE with a request ID. Both PowerShell example blocks passed the PowerShell parser. Additional example/probe requests are not included in the 94-row capture ledger.
- Every JSON capture had matching header/body request IDs and an envelope consistent with its HTTP status. The OPTIONS 204 response has no JSON body, as expected.
- Scope check: SHA-256 comparisons of all 66 pre-existing workspace files found zero changes, including .env, application logic, models, source artifacts, tests, package files, and existing reports. Only this requested guide was added; no commit/push, seed, ingestion, server restart, or database write was performed. The guide passed a private-credential scan. Final local probes still showed live 200, ready 503/disconnected, and meta 200/degraded.

Remaining blocker: restore the existing environment's Atlas TLS connectivity through an authorized operational investigation. IP access policy, firewall/VPN/TLS interception, cluster access, certificate trust, and client networking are possible investigation areas, not established causes. No unsafe TLS bypass is proposed. Keep the current server running; this audit did not stop/restart it or alter credentials/configuration.

After connectivity recovery, rerun readiness, then each valid data request and all three read-only integration suites. Verify live county geometry/pagination, dataset/area coverage, all observation fields/null periods,207/108/315 observation totals, exactly 2 processed assets, and API/database value parity. Only then promote affected data rows in this matrix to READY WITH LIMITATIONS, retaining the MODIS bounding-box warning and all geometry/coverage caveats. Do not run seeds or ingestion to make this audit pass.

## Actual response evidence

The appendix below contains complete JSON bodies captured from the existing server during this audit. No successful database response, entity, coordinate array, count, or scientific value has been synthesized. Requests that should nominally succeed are shown with their actual 503 response. The final HTTP ledger includes all94 tested URLs and statuses; nominal status is the source-defined branch being attempted, not a passed assertion.

Capture window: 2026-11-13T19:57:09.313Z through 2026-11-13T19:57:09.501Z. All URLs target the existing localhost:5000 server.

### Capture: welcome

GET `http://localhost:5000/` — HTTP **200**; captured 2026-11-13T19:57:09.313Z.

```json
{
  "success": true,
  "data": {
    "message": "Welcome to the TerraPulse API.",
    "apiVersion": "v1"
  },
  "requestId": "0c66f7ec-0b6a-4c59-8f33-a65ecff9a9fd"
}
```

### Capture: live

GET `http://localhost:5000/health/live` — HTTP **200**; captured 2026-11-13T19:57:09.320Z.

```json
{
  "success": true,
  "data": {
    "status": "alive"
  },
  "requestId": "b1eec7bf-7596-4e91-89c6-35fce009dfbf"
}
```

### Capture: ready

GET `http://localhost:5000/health/ready` — HTTP **503**; captured 2026-11-13T19:57:09.323Z.

```json
{
  "success": false,
  "error": {
    "code": "NOT_READY",
    "message": "Service is not ready.",
    "details": {
      "database": {
        "configured": true,
        "ready": false,
        "name": null,
        "status": "disconnected"
      }
    }
  },
  "requestId": "ffaea5d7-38b1-4307-ba07-8d847bc2fbd3"
}
```

### Capture: meta

GET `http://localhost:5000/api/v1/meta` — HTTP **200**; captured 2026-11-13T19:57:09.325Z.

```json
{
  "success": true,
  "data": {
    "project": "TerraPulse",
    "apiVersion": "v1",
    "pilotLocation": "Story County, Iowa, USA",
    "environment": "development",
    "serviceStatus": "degraded"
  },
  "requestId": "8d204575-a80c-4e0c-bd70-66a4384169e8"
}
```

### Capture: areas

GET `http://localhost:5000/api/v1/study-areas` — HTTP **503**; captured 2026-11-13T19:57:09.328Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "464a792f-5df7-41db-8162-65f9013baa4e"
}
```

### Capture: areas-slash

GET `http://localhost:5000/api/v1/study-areas/` — HTTP **503**; captured 2026-11-13T19:57:09.330Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "ebf40745-748d-4c88-b3d3-244581b488f1"
}
```

### Capture: story-list

GET `http://localhost:5000/api/v1/study-areas?geoid=19169&areaType=county&limit=1&page=1` — HTTP **503**; captured 2026-11-13T19:57:09.334Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "79ce49ef-c972-42f6-bd0f-7eb5d1943246"
}
```

### Capture: story-list-geometry

GET `http://localhost:5000/api/v1/study-areas?geoid=19169&includeGeometry=true&limit=1` — HTTP **503**; captured 2026-11-13T19:57:09.336Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "561c7915-983a-4ba0-aa3f-b98858d08ed0"
}
```

### Capture: story-detail

GET `http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed` — HTTP **503**; captured 2026-11-13T19:57:09.340Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "85bd6a9e-34bd-4edb-912a-1ab044d95815"
}
```

### Capture: story-invalid-id

GET `http://localhost:5000/api/v1/study-areas/invalid` — HTTP **400**; captured 2026-11-13T19:57:09.346Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_ID",
    "message": "Study area id must be a 24-character hexadecimal ObjectId."
  },
  "requestId": "58aebf56-c02c-4685-a31e-f9ea2e07ede4"
}
```

### Capture: story-invalid-query

GET `http://localhost:5000/api/v1/study-areas?includeGeometry=yes` — HTTP **400**; captured 2026-11-13T19:57:09.351Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "includeGeometry must be true or false."
  },
  "requestId": "3f917a4a-8650-42c8-b09f-3be68f6bda1c"
}
```

### Capture: area-coverage

GET `http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed/coverage?limit=1&provider=NASA&category=vegetation` — HTTP **503**; captured 2026-11-13T19:57:09.356Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "182f34d0-ea89-40b1-ba94-bae225f8b51e"
}
```

### Capture: area-coverage-invalid

GET `http://localhost:5000/api/v1/study-areas/invalid/coverage` — HTTP **400**; captured 2026-11-13T19:57:09.360Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_ID",
    "message": "Study area id must be a 24-character hexadecimal ObjectId."
  },
  "requestId": "00b91b85-685d-4539-909d-4e1dddc2dec3"
}
```

### Capture: validate-official-artifact

POST `http://localhost:5000/api/v1/areas/validate` — HTTP **200**; captured 2026-11-13T19:57:09.468Z.

```json
{
  "success": true,
  "data": {
    "valid": true,
    "geometryType": "Polygon",
    "coordinateCount": 1050,
    "validationErrors": [],
    "warnings": [
      "Structural validation only. Self-intersections, hole placement, and full topological validity are not checked.",
      "Coordinates are interpreted as [longitude, latitude] in EPSG:4326. Swapped values within valid ranges cannot be detected."
    ],
    "pilotIntersection": {
      "status": "unavailable",
      "intersects": null,
      "fullContainment": "not_evaluated",
      "reason": "DATABASE_UNAVAILABLE"
    }
  },
  "requestId": "fbe8a4ea-cadf-47a9-bcef-8834fd0af052"
}
```

### Capture: validate-invalid-geometry

POST `http://localhost:5000/api/v1/areas/validate` — HTTP **200**; captured 2026-11-13T19:57:09.470Z.

```json
{
  "success": true,
  "data": {
    "valid": false,
    "geometryType": null,
    "coordinateCount": 0,
    "validationErrors": [
      "geometry.type must be Polygon or MultiPolygon."
    ],
    "warnings": [
      "Structural validation only. Self-intersections, hole placement, and full topological validity are not checked.",
      "Coordinates are interpreted as [longitude, latitude] in EPSG:4326. Swapped values within valid ranges cannot be detected."
    ],
    "pilotIntersection": {
      "status": "unavailable",
      "intersects": null,
      "fullContainment": "not_evaluated",
      "reason": "STRUCTURAL_VALIDATION_FAILED"
    }
  },
  "requestId": "094bdb60-c86c-42b0-a642-dc84fb771808"
}
```

### Capture: validate-missing-geometry

POST `http://localhost:5000/api/v1/areas/validate` — HTTP **400**; captured 2026-11-13T19:57:09.472Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Request body must be an object containing geometry."
  },
  "requestId": "8fcbd6ef-742e-444c-84b1-7a298c4b125c"
}
```

### Capture: validate-invalid-json

POST `http://localhost:5000/api/v1/areas/validate` — HTTP **400**; captured 2026-11-13T19:57:09.474Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body must contain valid JSON."
  },
  "requestId": "301069fa-15c3-42d8-9ca6-581e23f1d02f"
}
```

### Capture: validate-oversized-body

POST `http://localhost:5000/api/v1/areas/validate` — HTTP **413**; captured 2026-11-13T19:57:09.478Z.

```json
{
  "success": false,
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Request body exceeds the permitted size limit."
  },
  "requestId": "887a0c7a-f9c6-4508-8a5a-74d2f856be62"
}
```

### Capture: datasets

GET `http://localhost:5000/api/v1/datasets` — HTTP **503**; captured 2026-11-13T19:57:09.365Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "99f7cbf2-7fa4-480b-98af-0de6740f6cf5"
}
```

### Capture: datasets-slash

GET `http://localhost:5000/api/v1/datasets/` — HTTP **503**; captured 2026-11-13T19:57:09.366Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "10dfbfb5-1fe0-4f13-81e8-f9c48837f1c3"
}
```

### Capture: datasets-invalid-provider

GET `http://localhost:5000/api/v1/datasets?provider=invalid` — HTTP **400**; captured 2026-11-13T19:57:09.405Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "provider is not supported."
  },
  "requestId": "36d9826e-6434-4ae6-93b6-8b7941864d1f"
}
```

### Capture: modis-detail

GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061` — HTTP **503**; captured 2026-11-13T19:57:09.393Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "289bb770-8ddf-47f9-b344-461e22ba71f3"
}
```

### Capture: dataset-invalid-slug

GET `http://localhost:5000/api/v1/datasets/BAD_SLUG` — HTTP **400**; captured 2026-11-13T19:57:09.400Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_SLUG",
    "message": "Dataset slug must use lowercase letters, digits, and single hyphens (maximum 120 characters)."
  },
  "requestId": "e22b5964-b835-446b-974c-1d210865f2bd"
}
```

### Capture: dataset-missing

GET `http://localhost:5000/api/v1/datasets/no-such-dataset` — HTTP **503**; captured 2026-11-13T19:57:09.401Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "f12a9909-cc1f-42aa-845f-02d7fd7022b2"
}
```

### Capture: modis-assets

GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets?assetType=processed&limit=2` — HTTP **503**; captured 2026-11-13T19:57:09.395Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "079167fa-a9cf-4bbb-9d47-ffcecba20e75"
}
```

### Capture: assets-invalid-type

GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets?assetType=unknown` — HTTP **400**; captured 2026-11-13T19:57:09.407Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "assetType is not supported."
  },
  "requestId": "e38cded2-8d79-4c8b-bf60-783ac14e53b8"
}
```

### Capture: modis-coverage

GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/coverage` — HTTP **503**; captured 2026-11-13T19:57:09.399Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "3396b508-1baf-4441-9073-33fde33eca49"
}
```

### Capture: vegetation

GET `http://localhost:5000/api/v1/observations/vegetation` — HTTP **503**; captured 2026-11-13T19:57:09.411Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "f8f7782f-4fc0-48fb-aa47-81a38338311d"
}
```

### Capture: vegetation-slash

GET `http://localhost:5000/api/v1/observations/vegetation/` — HTTP **503**; captured 2026-11-13T19:57:09.412Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "e9426840-a64c-4910-853d-46cb35af3681"
}
```

### Capture: vegetation-monthly

GET `http://localhost:5000/api/v1/observations/vegetation?resolution=monthly&limit=100` — HTTP **503**; captured 2026-11-13T19:57:09.416Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "22af5d1b-4574-497a-a586-7a9dff1bafa4"
}
```

### Capture: vegetation-summary-monthly

GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly` — HTTP **503**; captured 2026-11-13T19:57:09.425Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "91062132-9285-4357-b9a7-9080222e0d40"
}
```

### Capture: vegetation-null-summary

GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly&startDate=2019-02&endDate=2019-02` — HTTP **503**; captured 2026-11-13T19:57:09.428Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "ccd23b1d-5537-41b0-8829-618aafa7caa3"
}
```

### Capture: vegetation-date

GET `http://localhost:5000/api/v1/observations/vegetation/2017-01-01` — HTTP **503**; captured 2026-11-13T19:57:09.432Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "182d398b-1a93-4252-b01f-031ac1980b73"
}
```

### Capture: vegetation-null-month-2019

GET `http://localhost:5000/api/v1/observations/vegetation/2019-02?resolution=monthly` — HTTP **503**; captured 2026-11-13T19:57:09.433Z.

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is not ready."
  },
  "requestId": "b6980c3d-9a09-416f-9e3d-72cf05c7d271"
}
```

### Capture: vegetation-invalid-date

GET `http://localhost:5000/api/v1/observations/vegetation/2019-02-30` — HTTP **400**; captured 2026-11-13T19:57:09.438Z.

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PERIOD",
    "message": "Period must be a valid YYYY-MM-DD date."
  },
  "requestId": "c53f3c8e-ab85-43ee-a0b7-00b3de94dd1d"
}
```

### Capture: vegetation-summary-no-resolution

GET `http://localhost:5000/api/v1/observations/vegetation/summary` — HTTP **400**; captured 2026-11-13T19:57:09.439Z.

```json
{
  "success": false,
  "error": {
    "code": "RESOLUTION_REQUIRED",
    "message": "Summary requires resolution=16day or resolution=monthly."
  },
  "requestId": "0f1e7734-8c6d-4d52-85e4-a89df0565715"
}
```

### Capture: cors-allowed

GET `http://localhost:5000/health/live` — HTTP **200**; captured 2026-11-13T19:57:09.480Z.

Request Origin: `http://localhost:5173`.

```json
{
  "success": true,
  "data": {
    "status": "alive"
  },
  "requestId": "a65d4dbe-3b81-45a3-bd4f-6fe89ade438e"
}
```

Selected actual response headers:

```json
{
  "access-control-allow-origin": "http://localhost:5173",
  "access-control-expose-headers": "X-Request-ID",
  "vary": "Origin",
  "x-request-id": "a65d4dbe-3b81-45a3-bd4f-6fe89ade438e"
}
```

### Capture: cors-denied-localhost3000

GET `http://localhost:5000/health/live` — HTTP **403**; captured 2026-11-13T19:57:09.485Z.

Request Origin: `http://localhost:3000`.

```json
{
  "success": false,
  "error": {
    "code": "CORS_ORIGIN_DENIED",
    "message": "Origin is not allowed."
  },
  "requestId": "bc0a5752-4bed-4dcc-9dd4-809c32e5dd2e"
}
```

Selected actual response headers:

```json
{
  "x-request-id": "bc0a5752-4bed-4dcc-9dd4-809c32e5dd2e"
}
```

### Capture: cors-preflight-allowed

OPTIONS `http://localhost:5000/api/v1/areas/validate` — HTTP **204**; captured 2026-11-13T19:57:09.489Z.

Request Origin: `http://localhost:5173`.

No response body (actual OPTIONS preflight 204).

Selected actual response headers:

```json
{
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
  "access-control-allow-origin": "http://localhost:5173",
  "access-control-expose-headers": "X-Request-ID",
  "vary": "Origin, Access-Control-Request-Headers",
  "x-request-id": "296b9d40-7725-4588-affc-cc1494036093"
}
```

### Capture: unimplemented-/api/v1/observations/climate

GET `http://localhost:5000/api/v1/observations/climate` — HTTP **404**; captured 2026-11-13T19:57:09.491Z.

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found."
  },
  "requestId": "754004f2-dc08-4f3a-9fd3-f403b55064e0"
}
```

## Full HTTP verification ledger

| Check ID | Method / full URL | Actual HTTP | Code | Nominal branch attempted |
| --- | --- | ---: | --- | ---: |
| welcome | GET `http://localhost:5000/` | 200 | — | 200 |
| live | GET `http://localhost:5000/health/live` | 200 | — | 200 |
| ready | GET `http://localhost:5000/health/ready` | 503 | NOT_READY | 200 |
| meta | GET `http://localhost:5000/api/v1/meta` | 200 | — | 200 |
| areas | GET `http://localhost:5000/api/v1/study-areas` | 503 | DATABASE_UNAVAILABLE | 200 |
| areas-slash | GET `http://localhost:5000/api/v1/study-areas/` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-list | GET `http://localhost:5000/api/v1/study-areas?geoid=19169&areaType=county&limit=1&page=1` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-list-geometry | GET `http://localhost:5000/api/v1/study-areas?geoid=19169&includeGeometry=true&limit=1` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-detail | GET `http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-next-page | GET `http://localhost:5000/api/v1/study-areas?geoid=19169&limit=1&page=2` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-empty | GET `http://localhost:5000/api/v1/study-areas?geoid=00000` | 503 | DATABASE_UNAVAILABLE | 200 |
| story-invalid-id | GET `http://localhost:5000/api/v1/study-areas/invalid` | 400 | INVALID_ID | 400 |
| story-missing | GET `http://localhost:5000/api/v1/study-areas/000000000000000000000000` | 503 | DATABASE_UNAVAILABLE | 404 |
| story-invalid-query | GET `http://localhost:5000/api/v1/study-areas?includeGeometry=yes` | 400 | INVALID_QUERY | 400 |
| story-invalid-page | GET `http://localhost:5000/api/v1/study-areas?limit=101` | 400 | INVALID_QUERY | 400 |
| story-repeated-geoid | GET `http://localhost:5000/api/v1/study-areas?geoid=19169&geoid=19169` | 400 | INVALID_QUERY | 400 |
| area-coverage | GET `http://localhost:5000/api/v1/study-areas/6af71070cca3d14ecfec0aed/coverage?limit=1&provider=NASA&category=vegetation` | 503 | DATABASE_UNAVAILABLE | 200 |
| area-coverage-missing | GET `http://localhost:5000/api/v1/study-areas/000000000000000000000000/coverage` | 503 | DATABASE_UNAVAILABLE | 404 |
| area-coverage-invalid | GET `http://localhost:5000/api/v1/study-areas/invalid/coverage` | 400 | INVALID_ID | 400 |
| literal-area-double-slash | GET `http://localhost:5000/api/v1/study-areas//coverage` | 404 | NOT_FOUND | 404 |
| datasets | GET `http://localhost:5000/api/v1/datasets` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-slash | GET `http://localhost:5000/api/v1/datasets/` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-provider-NASA | GET `http://localhost:5000/api/v1/datasets?provider=NASA` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-provider-USDA | GET `http://localhost:5000/api/v1/datasets?provider=USDA` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-provider-USGS | GET `http://localhost:5000/api/v1/datasets?provider=USGS` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-category | GET `http://localhost:5000/api/v1/datasets?category=climate` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-category-vegetation | GET `http://localhost:5000/api/v1/datasets?category=vegetation` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-readiness-ready | GET `http://localhost:5000/api/v1/datasets?readiness=ready` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-readiness-not_ready | GET `http://localhost:5000/api/v1/datasets?readiness=not_ready` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-readiness-failed | GET `http://localhost:5000/api/v1/datasets?readiness=failed` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-page1 | GET `http://localhost:5000/api/v1/datasets?limit=3&page=1` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-page3 | GET `http://localhost:5000/api/v1/datasets?limit=3&page=3` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-empty | GET `http://localhost:5000/api/v1/datasets?search=doesnotexist` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-inactive | GET `http://localhost:5000/api/v1/datasets?isActive=false` | 503 | DATABASE_UNAVAILABLE | 200 |
| datasets-lifecycle | GET `http://localhost:5000/api/v1/datasets?acquisitionStatus=request_completed&validationStatus=validated&processingStatus=completed` | 503 | DATABASE_UNAVAILABLE | 200 |
| modis-detail | GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061` | 503 | DATABASE_UNAVAILABLE | 200 |
| modis-assets | GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets?assetType=processed&limit=2` | 503 | DATABASE_UNAVAILABLE | 200 |
| modis-raw-assets | GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets?assetType=raw` | 503 | DATABASE_UNAVAILABLE | 200 |
| modis-coverage | GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/coverage` | 503 | DATABASE_UNAVAILABLE | 200 |
| dataset-invalid-slug | GET `http://localhost:5000/api/v1/datasets/BAD_SLUG` | 400 | INVALID_SLUG | 400 |
| dataset-missing | GET `http://localhost:5000/api/v1/datasets/no-such-dataset` | 503 | DATABASE_UNAVAILABLE | 404 |
| dataset-missing-assets | GET `http://localhost:5000/api/v1/datasets/no-such-dataset/assets` | 503 | DATABASE_UNAVAILABLE | 404 |
| dataset-missing-coverage | GET `http://localhost:5000/api/v1/datasets/no-such-dataset/coverage` | 503 | DATABASE_UNAVAILABLE | 404 |
| datasets-invalid-provider | GET `http://localhost:5000/api/v1/datasets?provider=invalid` | 400 | INVALID_QUERY | 400 |
| datasets-invalid-pagination | GET `http://localhost:5000/api/v1/datasets?page=0` | 400 | INVALID_QUERY | 400 |
| assets-invalid-type | GET `http://localhost:5000/api/v1/datasets/nasa-modis-mod13q1-061/assets?assetType=unknown` | 400 | INVALID_QUERY | 400 |
| literal-assets-double-slash | GET `http://localhost:5000/api/v1/datasets//assets` | 404 | NOT_FOUND | 404 |
| literal-coverage-double-slash | GET `http://localhost:5000/api/v1/datasets//coverage` | 404 | NOT_FOUND | 404 |
| vegetation | GET `http://localhost:5000/api/v1/observations/vegetation` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-slash | GET `http://localhost:5000/api/v1/observations/vegetation/` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-16day | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=16day&limit=100` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-monthly | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=monthly&limit=100` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-page3 | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=16day&limit=100&page=3` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-date-filter | GET `http://localhost:5000/api/v1/observations/vegetation?startDate=2017-01-01&endDate=2017-01-01` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-month-filter | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=monthly&startDate=2019-02&endDate=2019-02` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-area-filter | GET `http://localhost:5000/api/v1/observations/vegetation?areaId=6af71070cca3d14ecfec0aed&geoid=19169&limit=1` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-empty-area | GET `http://localhost:5000/api/v1/observations/vegetation?geoid=00000` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-summary-monthly | GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-summary-16day | GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=16day` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-null-summary | GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly&startDate=2019-02&endDate=2019-02` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-empty-summary | GET `http://localhost:5000/api/v1/observations/vegetation/summary?resolution=monthly&startDate=2030-01&endDate=2030-12` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-date | GET `http://localhost:5000/api/v1/observations/vegetation/2017-01-01` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-null-month-2019 | GET `http://localhost:5000/api/v1/observations/vegetation/2019-02?resolution=monthly` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-null-month-2021 | GET `http://localhost:5000/api/v1/observations/vegetation/2021-01?resolution=monthly` | 503 | DATABASE_UNAVAILABLE | 200 |
| vegetation-missing-date | GET `http://localhost:5000/api/v1/observations/vegetation/2017-01-02` | 503 | DATABASE_UNAVAILABLE | 404 |
| vegetation-invalid-date | GET `http://localhost:5000/api/v1/observations/vegetation/2019-02-30` | 400 | INVALID_PERIOD | 400 |
| vegetation-summary-no-resolution | GET `http://localhost:5000/api/v1/observations/vegetation/summary` | 400 | RESOLUTION_REQUIRED | 400 |
| vegetation-invalid-area | GET `http://localhost:5000/api/v1/observations/vegetation?areaId=invalid` | 400 | INVALID_QUERY | 400 |
| vegetation-mixed-date-granularity | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=monthly&startDate=2017-01-01` | 400 | INVALID_QUERY | 400 |
| vegetation-reversed-range | GET `http://localhost:5000/api/v1/observations/vegetation?startDate=2020-01-01&endDate=2017-01-01` | 400 | INVALID_QUERY | 400 |
| vegetation-unknown-parameter | GET `http://localhost:5000/api/v1/observations/vegetation?variables=NDVI` | 400 | INVALID_QUERY | 400 |
| vegetation-repeated-resolution | GET `http://localhost:5000/api/v1/observations/vegetation?resolution=16day&resolution=monthly` | 400 | INVALID_QUERY | 400 |
| validate-official-artifact | POST `http://localhost:5000/api/v1/areas/validate` | 200 | — | 200 |
| validate-invalid-geometry | POST `http://localhost:5000/api/v1/areas/validate` | 200 | — | 200 |
| validate-missing-geometry | POST `http://localhost:5000/api/v1/areas/validate` | 400 | INVALID_INPUT | 400 |
| validate-invalid-json | POST `http://localhost:5000/api/v1/areas/validate` | 400 | INVALID_JSON | 400 |
| validate-oversized-body | POST `http://localhost:5000/api/v1/areas/validate` | 413 | PAYLOAD_TOO_LARGE | 413 |
| cors-allowed | GET `http://localhost:5000/health/live` | 200 | — | 200 |
| cors-allowed-data | GET `http://localhost:5000/api/v1/observations/vegetation?limit=1` | 503 | DATABASE_UNAVAILABLE | 200 |
| cors-denied-localhost3000 | GET `http://localhost:5000/health/live` | 403 | CORS_ORIGIN_DENIED | 403 |
| cors-denied-loopback | GET `http://localhost:5000/health/live` | 403 | CORS_ORIGIN_DENIED | 403 |
| cors-denied-external | GET `http://localhost:5000/health/live` | 403 | CORS_ORIGIN_DENIED | 403 |
| cors-preflight-allowed | OPTIONS `http://localhost:5000/api/v1/areas/validate` | 204 | — | 204 |
| cors-preflight-denied | OPTIONS `http://localhost:5000/api/v1/areas/validate` | 403 | CORS_ORIGIN_DENIED | 403 |
| unimplemented-/api/v1/observations/climate | GET `http://localhost:5000/api/v1/observations/climate` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/observations/climate/summary | GET `http://localhost:5000/api/v1/observations/climate/summary` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/observations/climate/ | GET `http://localhost:5000/api/v1/observations/climate/` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/observations/smap | GET `http://localhost:5000/api/v1/observations/smap` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/crop-history | GET `http://localhost:5000/api/v1/crop-history` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/soils | GET `http://localhost:5000/api/v1/soils` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/scenarios | GET `http://localhost:5000/api/v1/scenarios` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/scenarios/compare | GET `http://localhost:5000/api/v1/scenarios/compare` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/recommendations | GET `http://localhost:5000/api/v1/recommendations` | 404 | NOT_FOUND | 404 |
| unimplemented-/api/v1/observations/climate?provider=MERRA-2 | GET `http://localhost:5000/api/v1/observations/climate?provider=MERRA-2` | 404 | NOT_FOUND | 404 |
