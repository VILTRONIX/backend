# TerraPulse backend

TerraPulse is a NASA Space Apps Challenge 2026 project for comparing crop rotation strategies in **Story County, Iowa, USA**. Its intended users are farmers and agricultural advisors.

This repository contains the backend foundation, Study Areas, Dataset Registry, and MODIS vegetation summaries: health checks, service metadata, MongoDB connection management, official boundaries, geometry validation, source inventory/availability APIs, and read-only vegetation APIs. It contains no frontend and uses the repository root.

The checked-in official Story County boundary comes from Census TIGER/Line 2026. The study-area seed validates and stores this boundary in MongoDB. Eight NASA/USDA/USGS source registry entries are available. Sprint 4 imported 315 existing processed MODIS bounding-box AOI summaries and registered their two CSV assets. These are not exact county statistics; the raw NetCDF product has not been locally verified. Other sources remain registry entries. No agricultural scores, crop results, or scientific formulas are implemented.

## Stack and prerequisites

- Node.js **22.17.1 or newer**, with npm (development verified with Node 22.17.1 and npm 10.9.2).
- JavaScript ES Modules and Express 5.
- MongoDB Atlas with Mongoose 9.
- dotenv, cors, helmet, and morgan.
- nodemon for development; Node's built-in test runner and HTTP client for tests.

The existing dependency versions were retained after checking their Node engine requirements. No additional runtime or development dependencies were introduced. A local MongoDB installation is not required to run the HTTP server or the default tests.

## Folder structure

```text
src/
  config/
    env.js                       # Environment loading and validation
    database.js                  # Mongoose connection, state, retries, shutdown
  modules/
    health/health.routes.js      # Liveness and readiness
    study-areas/
      study-area.model.js
      study-area.routes.js
      study-area.controller.js
      study-area.service.js
      study-area.validation.js
    datasets/
      dataset.model.js
      dataset-asset.model.js
      dataset.routes.js
      dataset.controller.js
      dataset.service.js
      dataset.validation.js
    vegetation/
      vegetation.constants.js
      vegetation-observation.model.js
      vegetation.validation.js
      vegetation.service.js
      vegetation.routes.js
      modis-import.service.js
  middleware/
    requestId.js
    notFound.js
    errorHandler.js
  routes/index.js                # Versioned API metadata
  utils/appError.js              # Sanitized application errors
  app.js                         # Express setup; no network/database side effects
  server.js                      # HTTP startup and process signal handling
tests/
  helpers/http.js
  app.test.js
  database.test.js
  env.test.js
  server.test.js
  study-area.*.test.js
  dataset.*.test.js
  vegetation.*.test.js
integration/study-areas.check.js  # Explicit Atlas checks, outside default discovery
integration/datasets.check.js
integration/modis.check.js
scripts/seedStudyAreas.js
scripts/seedDatasets.js
scripts/auditModisSource.js
scripts/ingestModis.js
reports/modis_ingestion_report.md
data/seed/
  datasets.js                    # Project-reported source inventory, not observations
  story-county.geojson
  README.md                      # Source and conversion provenance
.env.example
.gitignore
package.json
package-lock.json
```

Add future domain routes, controllers, and services within `src/modules/<domain>/` when their requirements are approved. Database configuration stays outside route modules. Large raster and NetCDF assets belong in suitable file/object storage; MongoDB should hold their metadata and references.

## Installation and environment setup

From this directory:

```sh
npm install
```

For a reproducible install using the committed lockfile, use `npm ci` instead.

Create your private environment file in PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux use `cp .env.example .env`. Copy only if `.env` does not already exist; preserve existing credentials. The server resolves `.env` from the project root and lets environment variables supplied by the deployment platform take precedence.

```dotenv
PORT=5000
NODE_ENV=development
MONGODB_URI=
CLIENT_URL=http://localhost:5173
```

| Variable | Rules |
| --- | --- |
| `PORT` | Integer from 1 to 65535; defaults to 5000. |
| `NODE_ENV` | `development`, `test`, or `production`; defaults to `development`. |
| `MONGODB_URI` | `mongodb://` or `mongodb+srv://` URI. Optional in development/test; required in production. |
| `CLIENT_URL` | One or more comma-separated exact HTTP(S) origins. Defaults to `http://localhost:5173` outside production; explicitly required in production. |

Origin examples: `https://app.example.com,https://advisor.example.com`. Do not include paths, trailing slashes, credentials, or wildcards. CORS permits requests without an `Origin` header for probes and server clients; CORS is not authentication. An unapproved browser origin receives HTTP 403.

`.env` and environment variants are excluded by `.gitignore`; `.env.example` is the safe, tracked template. Do not put credentials in source files, URLs sent to API endpoints, or Git. No `.env` file is generated automatically.

## Connect MongoDB Atlas

1. Create or select an Atlas project and cluster.
2. Create a **database user** with `readWrite` access limited to the `terrapulse` database. This is separate from your Atlas website account.
3. Add your development machine's public IP to the project's IP access list. For deployment, allow the backend's outbound IP addresses. Avoid opening access to all IPs.
4. In the cluster's **Connect** dialog choose the driver/application connection option and Node.js, then copy the provided connection string.
5. Set `MONGODB_URI` in your private `.env` (or deployment secret store), substituting the actual database user, password, and cluster host, and selecting the `terrapulse` database:

   ```dotenv
   MONGODB_URI=mongodb+srv://<database-user>:<percent-encoded-password>@<cluster-host>/terrapulse?retryWrites=true&w=majority&appName=TerraPulse
   ```

   Replace the angle-bracket placeholders. Percent-encode special characters in the username/password, such as `@`, `:`, `/`, and `#`; do not encode the entire URI.

6. Restart the server, then request `GET /health/ready`. A successful connection produces a `MongoDB connected.` log and HTTP 200 with `data.database.ready: true`. HTTP 503 means the service is still unavailable; check the database user, IP access list, cluster availability, DNS, and network access.

See the official [Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) and [connection troubleshooting guide](https://www.mongodb.com/docs/atlas/troubleshoot-connection/).

The HTTP listener starts before the database connection attempt, so liveness works during an outage. Initial connection failures retry after 5 seconds; server selection and TCP connection timeouts are 5 seconds, and the pool is limited to 10 connections. Mongoose handles reconnection after an established connection drops. Readiness follows the driver's state, so outage detection depends on its heartbeat (configured for 5 seconds). See [Mongoose connection behavior](https://mongoosejs.com/docs/connections.html).

Missing MongoDB configuration in development/test produces a warning and readiness 503. Missing production configuration fails startup. A configured but unreachable database keeps liveness at 200 and readiness at 503 in every environment. Connection state and logs never include the URI, driver error message, or credentials. Readiness confirms a database connection; it does not certify future dataset availability or scientific validity.

## Run the server

```sh
npm run dev
```

nodemon watches `src` and restarts on code changes. Restart manually after changing `.env`.

```sh
npm start
```

For production, set `NODE_ENV=production`, `MONGODB_URI`, and explicit frontend origins through your hosting platform. Terminate HTTPS at a configured gateway. Ctrl+C (`SIGINT`) and `SIGTERM` stop accepting HTTP requests, mark database readiness false, cancel initial connection retries, and close MongoDB. Shutdown has a 10-second deadline.

## Endpoints and JSON format

Default base URL: `http://localhost:5000`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/` | API welcome message and version (200). |
| GET | `/health/live` | Process is alive (200), independent of MongoDB. |
| GET | `/health/ready` | Application/database ready (200), otherwise 503; includes connected database name. |
| GET | `/health/engine` | Independent Engine readiness (200/503), seven mandatory datasets and optional MERRA-2; [contract](docs/engine_api_contract.md). |
| GET | `/api/v1/meta` | Project, API version, pilot location, environment, and `ready`/`degraded` service status (200). |
| GET | `/api/v1/study-areas` | Paginated active study areas, excluding geometry by default. |
| GET | `/api/v1/study-areas/:id` | Active study area including geometry; missing records return 404. |
| POST | `/api/v1/areas/validate` | Structural geometry validation and optional pilot intersection; never saves geometry. |
| GET | `/api/v1/datasets` | Paginated/filterable registry with separate lifecycle states and derived readiness. |
| GET | `/api/v1/datasets/:slug` | Public dataset metadata; missing records return 404. |
| GET | `/api/v1/datasets/:slug/assets` | Paginated file references/metadata, with private paths omitted. |
| GET | `/api/v1/datasets/:slug/coverage` | Reported/verified/unavailable/unknown spatial and temporal metadata. |
| GET | `/api/v1/study-areas/:areaId/coverage` | Area-specific coverage and availability; never inferred from global extent or general dates. |

Success responses use `{ "success": true, "data": { ... }, "requestId": "..." }`. Failures use `{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`. Readiness failures also include sanitized database state under `error.details.database`. Every request receives a generated `X-Request-ID`; success and error JSON echo that ID. Standard CORS preflight requests use HTTP 204 without a body.

Unknown routes return JSON 404. Malformed JSON returns 400. General request bodies are limited to 100 KiB; the geometry validation endpoint accepts at most 1 MiB of JSON, with a separate 512 KiB geometry limit. Body-parser size failures return 413. Unexpected failures return sanitized 500 responses. Stack traces, raw errors, request bodies, and database credentials are never returned. Morgan logs method, registered route pattern, status, duration, and request ID; raw paths and query strings are omitted to avoid logging secrets. Helmet security headers are enabled and Express's identifying header is disabled.

Readiness uses the actual connection's `db.databaseName` (for example, `data.database.name: "terrapulse"`), not a global Mongoose connection or URI string. The name is `null` when disconnected and readiness is 503. Database readiness does not certify that the county has been seeded.

Example checks in PowerShell:

```powershell
Invoke-RestMethod http://localhost:5000/health/live
Invoke-RestMethod http://localhost:5000/api/v1/meta
curl.exe -i http://localhost:5000/health/ready
```

## Study Areas schema and indexing

The `study_areas` collection uses Mongoose timestamps (`createdAt`, `updatedAt`) and strict schemas. There are no public creation, update, or delete routes.

| Field | Meaning and validation |
| --- | --- |
| `name`, `slug` | Required bounded strings; slug uses lowercase letters, digits, and hyphens. |
| `areaType` | `county`, `user_drawn`, `verified_field`, or `illustrative_demo`. |
| `geoid` | Five-digit Census county identifier; required for counties. |
| `state`, `stateCode` | State name and two-letter code, such as Iowa and IA. |
| `country`, `countryCode` | Required country name and two-letter code. |
| `geometry` | Structurally validated 2D GeoJSON Polygon or MultiPolygon in EPSG:4326; required unless geometry status is pending. |
| `geometrySource` | Provider, dataset, vintage, source URL, retrieval date, and source identifier; required for official/verified geometry. |
| `geometryStatus` | `official`, `verified`, `pending`, or `illustrative`. Demo areas must be illustrative. |
| `isActive` | Defaults to true; public list/detail routes return active records. |
| `metadata` | Source attributes, CRS information, archive checksum, conversion tooling, and provenance. |

Indexes are declared once in the schema:

- A unique index on `slug`.
- A unique compound index on `(countryCode, geoid)`, restricted to county documents with string GEOIDs. Non-county documents without GEOIDs can coexist.
- A `2dsphere` index on `geometry` for spherical geospatial operations. Pending records without geometry are not included in this sparse geospatial index.

Automatic collection/index creation stays disabled on the server. The seed script explicitly creates the collection and required indexes. It never calls `syncIndexes`, drops indexes, or deletes conflicting records. Existing duplicate identities cause a clear failure requiring manual review.

Models bind to the same explicit Mongoose connection used by health checks and server startup. They do not use Mongoose's unused global default connection.

## Official Story County boundary and seeding

The latest official TIGER/Line release available when this boundary was acquired was **2026**, released October 14, 2026, with boundaries as of January 1, 2026. Sources: [Census release page](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), [county archive listing](https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/), and [exact downloaded archive](https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip).

`data/seed/story-county.geojson` contains the complete extracted Feature for GEOID `19169`, state FIPS `19`, county FIPS `169`. It is a Polygon with **1,050 positions including the closing position**. Coordinates were transformed from the archive's EPSG:4269 to EPSG:4326 using longitude/latitude axis order, without simplification or mock coordinates. Full provenance, archive SHA-256, source DBF attributes, retrieval time, and transformation details are stored in the Feature properties; see [boundary provenance](data/seed/README.md).

GeoJSON geometry layout:

- Polygon: `coordinates` is an array of rings; each ring is an array of `[longitude, latitude]` positions. The first ring is the exterior; subsequent rings are holes.
- MultiPolygon: `coordinates` is an array of Polygon coordinate arrays.
- Rings must contain at least four positions, close exactly, and contain at least three distinct positions.
- Only finite numeric 2D positions are accepted. Longitude is in [-180, 180]; latitude is in [-90, 90]. GeoJSON uses implicit WGS84; custom `crs` members are rejected.

The checked-in file is the complete valid GeoJSON example; public validation accepts its `geometry` object rather than the entire Feature. Root Feature properties describe provenance and are not geometry coordinates.

With `MONGODB_URI` configured in your private `.env`:

```powershell
npm run seed:study-areas
```

The command reads and validates the official file before connecting, validates the Mongoose document, ensures indexes, then upserts on `(countryCode: US, areaType: county, geoid: 19169)`. Before reporting success it reads the document back and compares the complete geometry, geometry source, and metadata, checks actual index keys/uniqueness/partial filters against the schema, and verifies exactly one matching county exists. Repeated runs preserve the same record ID and update the existing county. Missing, malformed, oversized, or mislabeled seed files fail without a mock fallback. The seed needs Atlas permissions to write documents, create the collection, and create indexes.

## Study Areas API

### List and detail

`GET /api/v1/study-areas` supports only these query parameters:

| Parameter | Default and accepted values |
| --- | --- |
| `page` | 1; integer 1 through 10000. |
| `limit` | 20; integer 1 through 100. |
| `areaType` | Optional supported enum value. |
| `geoid` | Optional five-digit string. |
| `includeGeometry` | `false`; accepts the exact strings `true` or `false`. |

The response uses `data.items` and `data.pagination` (`page`, `limit`, `total`, `totalPages`). Ordering is by name, then ID. Geometry is omitted unless requested. Unsupported query keys, operator-like parameters, repeated parameters, and invalid values return 400. Pagination totals and items use separate reads and may briefly differ during administrative changes.

`GET /api/v1/study-areas/:id` includes geometry. Malformed ObjectIds return 400; missing or inactive records return 404 with `STUDY_AREA_NOT_FOUND`. Database unavailability returns 503 for list/detail.

An abbreviated list response after seeding:

```json
{
  "success": true,
  "data": {
    "items": [{ "_id": "<ObjectId>", "name": "Story County", "geoid": "19169", "geometryStatus": "official" }],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  },
  "requestId": "<UUID>"
}
```

### Validate geometry without saving

`POST /api/v1/areas/validate` accepts a JSON object with a `geometry` field. The result contains `valid`, `geometryType`, `coordinateCount` (including ring-closing positions), `validationErrors`, `warnings`, and `pilotIntersection`. A completed validation request returns 200 even if `data.valid` is false; missing request fields return 400. Geometry exceeding 512 KiB or 20,000 positions is structurally invalid. A JSON body exceeding 1 MiB returns 413.

`valid` describes structural validation only. Self-intersections, holes outside shells, polygon overlap, winding, hemisphere size, and complete topology are not checked. Swapped axes cannot be detected if both numbers lie within allowed ranges. The datum transformation also does not establish survey-grade positional accuracy.

When an active official Story County geometry exists, the service queries MongoDB with `$geoIntersects`. It returns `pilotIntersection.status: "evaluated"`, `intersects: true` or `false`, and `fullContainment: "not_evaluated"`. **Intersection never means full containment.** MongoDB has spherical/hemisphere and boundary-contact semantics; see the [official operator documentation](https://www.mongodb.com/docs/manual/reference/operator/query/geointersects/).

When evaluation cannot run, `intersects` is `null`, status is `unavailable`, and `reason` is one of `STRUCTURAL_VALIDATION_FAILED`, `DATABASE_UNAVAILABLE`, `OFFICIAL_COUNTY_NOT_AVAILABLE`, or `GEOSPATIAL_QUERY_REJECTED`. A MongoDB topology rejection is reported separately from structural validity. Submitted geometries are never written.

Example result excerpt when validating the official county itself:

```json
{
  "valid": true,
  "geometryType": "Polygon",
  "coordinateCount": 1050,
  "validationErrors": [],
  "pilotIntersection": {
    "status": "evaluated",
    "intersects": true,
    "fullContainment": "not_evaluated",
    "geoid": "19169",
    "operator": "$geoIntersects"
  }
}
```

PowerShell examples using the actual seeded geometry:

```powershell
$base = 'http://localhost:5000'
$areas = Invoke-RestMethod "$base/api/v1/study-areas?areaType=county&geoid=19169&page=1&limit=20"
$areas.data.pagination
$id = $areas.data.items[0]._id
$detail = Invoke-RestMethod "$base/api/v1/study-areas/$id"
Invoke-RestMethod "$base/api/v1/study-areas?includeGeometry=true"

$body = @{ geometry = $detail.data.geometry } | ConvertTo-Json -Depth 100 -Compress
$validation = Invoke-RestMethod "$base/api/v1/areas/validate" -Method Post -ContentType 'application/json' -Body $body
$validation.data | ConvertTo-Json -Depth 10
Invoke-RestMethod "$base/health/ready"
```

## Dataset Registry (Sprint 3)

The registry separates **project reports**, **discovered file assets**, **validation**, **processing**, and **area-specific coverage**. It contains no source-file downloader, CSV/NetCDF processor, raster generator, satellite calculation, or agricultural scoring. No public dataset/asset creation, modification, or deletion endpoints exist.

### Dataset model

The strict, connection-bound `Dataset` model uses the `datasets` collection and Mongoose timestamps:

| Fields | Meaning |
| --- | --- |
| `slug`, `name`, `provider`, `category` | Stable identity; providers NASA/USDA/USGS; categories vegetation, climate, soil_moisture, soil, crop_history, imagery. |
| `productId`, `productCollection`, `version` | Exact known product/version metadata; unknown values remain null. `productCollection` avoids Mongoose's reserved `collection` document property. MODIS preserves collection/version token `061`; MERRA-2 preserves `5.12.4`. |
| `description`, `purpose`, `optional`, `limitations`, `tags`, `isActive` | Descriptive registry metadata and explicit limitations/optional sources. |
| `variables` | Bounded, uniquely named objects with `name`, `displayName`, `unit`, `description`, and `availabilityStatus`. Status is target, reported, verified, reported_absent, unavailable, or unknown. |
| `temporalCoverage` | Coverage status, exact string bounds, day/month/year precision, timezone, description, and optional verification evidence/time. Month-only dates are not expanded to fabricated daily observations. |
| `spatialCoverage` | Overall metadata, native extent, reported output CRS, and explicit per-study-area claims. Overall global extent is not proof of local coverage. |
| `spatialResolution`, `temporalResolution` | Native nominal/grid resolutions and temporal cadence; unknown resolutions remain unknown. |
| `source` | Official product reference and inventory basis. Every initial record uses `project_report`, not `verified_files`. |
| `acquisition`, `validation`, `processing` | Separate lifecycle stages; acquisition also stores reported request/inventory details. |

Coverage statuses are `reported`, `verified`, `unavailable`, and `unknown`. Verified coverage requires a verification timestamp and private evidence reference; verified temporal coverage also needs explicit bounds. Area claims must identify a study-area ObjectId or an explicit country/county GEOID, with unique identities. An ID-specific claim is not reused for a different area that happens to have matching county fields. Private evidence references are excluded from public representations.

Unknown variable units are **null**, not guessed. Initial variable statuses preserve the difference between reported MERRA-2 layers and NASA POWER target parameters. `TSH` is registered as `reported_absent`; `Var_TSH` remains a variance variable and is never substituted for TSH.

### Dataset Asset model

The separate `dataset_assets` collection contains file metadata/references only. Each asset requires `datasetId`, globally unique `assetKey`, `assetType`, a basename-only `fileName`, `format`, `storageType`, private `storageUri`, and an actual `discoveredAt` timestamp. `assetType` distinguishes `raw`, `processed`, and `metadata` assets. Formats support CSV, NetCDF4, GeoTIFF, GeoJSON, Parquet, JSON, and TXT (for metadata files such as ANG).

Optional metadata includes safe-integer `sizeBytes`, paired `checksum`/`checksumAlgorithm` (sha256, sha512, md5), date strings and timezone, CRS, variable names, per-asset validation/processing statuses, and timestamps. Unknown sizes/checksums remain null. Checksums must match their declared algorithm. Private internal metadata is limited to 16 KiB; it is not a place for raster/NetCDF payloads. Files remain in external storage.

Asset APIs use an explicit public field whitelist: `storageUri`, internal `metadata`, and evidence references are never returned, including when storage is local. Absolute paths in legacy filename fields are also suppressed. No source assets were discovered in this sprint, so **all eight asset lists are empty**; reported file counts are stored only in dataset acquisition metadata. The registry does not scan arbitrary folders or create one asset per reported file.

### Lifecycle and readiness

| Stage | Status values |
| --- | --- |
| Acquisition | pending, request_completed, reported_available, downloaded, failed |
| Validation | pending, partially_validated, validated, failed |
| Processing | not_started, in_progress, completed, failed |

`readiness.ready` is true only when the dataset is active, acquisition is `downloaded`, validation is `validated`, and processing is `completed`. `readiness.status` is `failed` if any lifecycle stage failed; otherwise it is `ready` or `not_ready`. The summary includes blocker codes and `scope: "dataset_lifecycle_only"`. The filter uses the same conditions; actual MongoDB matching is integration-tested for every supported lifecycle combination.

Readiness is derived, not a stored editable flag. It describes the registry's lifecycle assertions, not a live storage probe or a certification of scientific fitness. Trusted future ingestion/validation workflows must establish those assertions from actual files. Request completion and reported availability never satisfy the download/validation/processing requirements. All eight initial entries are **not_ready**.

### Current reported inventory

All validation states are pending and all processing states are not_started. Facts below are project-reported inventory and product metadata, not file-validation results:

| Slug | Acquisition | Reported inventory and limitations |
| --- | --- | --- |
| `nasa-modis-mod13q1-061` | request_completed | [MOD13Q1.061](https://doi.org/10.5067/MODIS/MOD13Q1.061); native 250 m/16-day composites; extraction 2017-01-01–2025-12-31. AppEEARS request `357b171f-0fff-4b41-83cc-4ecc34f5bcd4` reported Completed on 2026-11-12: NetCDF4, EPSG:4326 output, one user-drawn feature, 252.81 MB, twelve output layers. Only the five supplied important layer names are listed; actual files, units/scales/QA, all layers, and county footprint require validation. NDVI/EVI are not direct soil-health measurements. |
| `nasa-merra2-m2tmnxflx-5-12-4` | reported_available | [M2TMNXFLX / tavgM_2d_flx_Nx 5.12.4](https://disc.gsfc.nasa.gov/datasets/M2TMNXFLX_5.12.4/summary); 211 monthly NetCDF4 files, 2008-06–2025-12, native 0.5° latitude × 0.625° longitude. A Story County subset reportedly had one latitude row and two longitude cells. Readability is reported, not independently verified. Coarse climate cells are not field-level observations; analytical features are unconfirmed. |
| `nasa-power-daily` | reported_available | [NASA POWER](https://power.larc.nasa.gov/); ten daily CSV files at ten locations, 2017-01-01–2024-12-31, UTC. Listed parameters are targets; presence in each CSV, headers, units, coordinates, missing values, and exact coverage remain unverified. Native parameter grids are not assumed. |
| `nasa-smap` | pending | [SMAP](https://smap.jpl.nasa.gov/); no usable product confirmed. Product ID, dates, native resolution, variables, and assets are unknown. |
| `usda-cdl` | pending | [Project-supplied CDL reference](https://www.nass.usda.gov/Research_and_Science/Cropland/); annual crop classification/history context. Local years, files, attributes, native product resolution/version, and coverage are unknown. The supplied directory URL returned 404 during reference checking; the [current NASS product page](https://www.nass.usda.gov/research-and-science/cropland/sars1a) is an alternative official reference. The supplied URL is preserved in the registry. |
| `usda-ssurgo` | pending | [Web Soil Survey / SSURGO](https://websoilsurvey.nrcs.usda.gov/); soil map-unit/property context. Spatial/tabular files, map-unit keys, attributes, version, dates, and coverage are unconfirmed. |
| `usda-csb` | pending, optional | [USDA Crop Sequence Boundaries](https://www.nass.usda.gov/Research_and_Science/Crop-Sequence-Boundaries/index.php); candidate only. No local files, version, period, or Story County coverage confirmed. |
| `usgs-landsat-8-c2-l2` | pending, optional | [Landsat Collection 2](https://www.usgs.gov/landsat-missions/landsat-collection-2); scene `LC08_L2SP_026031_20240923_20240928_02_T1`, acquisition date 2024-09-23. Only ANG metadata was previously reported. Science bands, QA files, full bundle, native band resolutions, and county footprint require verification. |

### Seed behavior and indexes

Configure the existing private `.env`, then run:

```powershell
npm run seed:datasets
```

The seed validates the entire input before document writes, rejects duplicate input identities, creates the Dataset/Asset collections and indexes, and upserts by slug. It reports `created`, `updated`, and `unchanged` counts. It neither seeds assets nor writes Study Areas.

Seed-managed descriptive fields are name, provider, category, product ID/collection/version, description, purpose, optional flag, limitations, and tags. **Acquisition, validation, processing, variable units/availability, source evidence, temporal/spatial coverage, and active flags are insert-only defaults**: reseeding preserves later manual/ingestion updates. A descriptive change uses an atomic `$set` while protected defaults remain in `$setOnInsert`, so a concurrent lifecycle update is not overwritten. Identical records are skipped without advancing timestamps. Updates to seed-owned descriptions/limitations replace those fields; maintainers should edit the inventory for lasting descriptive changes. Seeding is per-record, not an all-record transaction; a failure may follow successful writes, and a safe rerun reconciles them.

Verified indexes in Atlas:

| Collection | Index | Definition |
| --- | --- | --- |
| datasets | `dataset_slug_unique` | Unique slug. |
| datasets | `dataset_provider_category` | Provider/category compound query index. |
| datasets | `dataset_category` | Category query index. |
| datasets | `dataset_product_version_unique` | Unique `(provider, productId, version)` where both productId and version are strings; unknown products/versions are excluded. |
| dataset_assets | `dataset_asset_key_unique` | Globally unique assetKey. |
| dataset_assets | `dataset_asset_dataset_type` | `(datasetId, assetType, _id)` for scoped asset lists. |

Each collection also has MongoDB's `_id_` index. Index creation is explicit in the seed; it does not drop existing indexes. Duplicate identities fail without deleting conflicting records. The model's dataset reference is not a database-enforced foreign key; future trusted ingestion must check the parent dataset exists before writing assets.

### Registry APIs and availability semantics

All routes are read-only GET requests under `/api/v1`. They use the existing JSON envelope and pagination shape (`data.items`, `data.pagination` with page/limit/total/totalPages). List ordering is by slug and ID; asset ordering is by ID. Pagination totals/items are separate reads and can briefly differ during administrative edits. MongoDB outages return 503; invalid parameters return 400; missing slugs/study areas return 404.

`GET /datasets` supports:

| Parameter | Values |
| --- | --- |
| `provider`, `category` | Exact enum values listed above. |
| `acquisitionStatus`, `validationStatus`, `processingStatus` | Exact lifecycle enum values. |
| `readiness` | ready, not_ready, failed (failed is distinct from not_ready). |
| `isActive` | true/false; defaults to true. Use false to inspect inactive entries. |
| `page`, `limit` | Page 1–10000 (default 1), limit 1–100 (default 20). |
| `search` | 1–100 characters; case-insensitive **literal** substring search of name, slug, productId, description. Regex operators are escaped. |

Unknown/operator-like/repeated parameters and invalid values are rejected. `GET /datasets/:slug` returns complete public metadata, including inactive records when addressed explicitly. Slugs allow lowercase letters/digits/single hyphens, at most 120 characters. Private evidence references are omitted.

`GET /datasets/:slug/assets` supports page, limit, and optional `assetType=raw|processed|metadata`. It returns only assets linked to the resolved dataset; an empty list means no assets are registered, not that reported filenames have been verified.

`GET /datasets/:slug/coverage` returns the dataset's temporal/spatial coverage statuses and limitations. Reported periods do not establish verified area-specific coverage. Unknown bounds are null, not inferred from the general product archive.

`GET /study-areas/:areaId/coverage` validates the registered active study area, supports the dataset list filters/pagination, and returns one availability item per matching dataset. An explicit ID-specific claim takes precedence over a county identity claim. Each item separates `coverage.temporalCoverage` for this area from `datasetTemporalCoverage` for the broader reported inventory. MERRA-2 currently has a reported/unverified county claim; other entries have unknown area coverage. No initial entry claims verified county availability.

| Area claim and lifecycle | `availability.status` | `available` / `analysisReady` |
| --- | --- | --- |
| No claim or unknown | unknown | null / false |
| Reported claim | unverified | null / false |
| Explicit unavailable claim | unavailable | false / false |
| Verified spatial claim, lifecycle incomplete | not_ready | null / false |
| Verified spatial claim, lifecycle ready | available | true / true |

`analysisReady` expresses registered lifecycle completion plus verified spatial coverage; it is not a scientific quality score or a claim of full temporal coverage. Consumers must inspect the separate area-specific temporal status/bounds for their requested period. There is no requested-date intersection API in this sprint.

Example excerpt from MODIS details after the approved summary import:

```json
{
  "success": true,
  "data": {
    "slug": "nasa-modis-mod13q1-061",
    "acquisition": { "status": "request_completed" },
    "validation": { "status": "validated" },
    "processing": { "status": "completed" },
    "readiness": {
      "status": "not_ready",
      "ready": false,
      "scope": "dataset_lifecycle_only",
      "blockers": ["acquisition_not_downloaded"]
    }
  },
  "requestId": "<UUID>"
}
```

PowerShell API checks, in a second terminal after `npm run dev`:

```powershell
$base = 'http://localhost:5000/api/v1'
Invoke-RestMethod "$base/datasets?page=1&limit=3"
Invoke-RestMethod "$base/datasets?provider=NASA&category=climate"
Invoke-RestMethod "$base/datasets?acquisitionStatus=reported_available&validationStatus=pending"
Invoke-RestMethod "$base/datasets?readiness=not_ready&search=MERRA"
Invoke-RestMethod "$base/datasets/nasa-modis-mod13q1-061"
Invoke-RestMethod "$base/datasets/nasa-modis-mod13q1-061/assets?assetType=raw"
Invoke-RestMethod "$base/datasets/nasa-power-daily/coverage"

$areas = Invoke-RestMethod "$base/study-areas?geoid=19169"
$areaId = $areas.data.items[0]._id
$coverage = Invoke-RestMethod "$base/study-areas/$areaId/coverage?limit=20"
$coverage.data | ConvertTo-Json -Depth 20
```

Registry verification commands:

```powershell
npm test
npm run seed:datasets
npm run test:datasets:integration
npm run test:integration
```

Sprint 3 verification on November 13, 2026: **102 default tests passed**, including the existing 68 regression tests; the new Dataset Atlas integration check and existing Study Areas Atlas integration check each passed. The first dataset seed created 8 entries; the second reported 0 created, 0 updated, 8 unchanged. Asset count remained 0. The complete stored Study Areas document hash and official GeoJSON hash matched before and after registry seeding. Lifecycle-preservation tests use controlled in-memory fixtures; no real dataset was falsely marked validated/processed for testing. The read-only live check verifies actual indexes, API filters, coverage uncertainty, and readiness-filter parity across every lifecycle combination using MongoDB 6.0+ literal-document aggregation without saving fixtures.

## MODIS read-only source audit (Sprint 4)

The transferred sources are now available beneath the user-supplied data root as `processed/modis/modis_16day_aoi_summary.csv` and `processed/modis/modis_monthly_aoi_summary.csv`. The completed [source audit](reports/modis_backend_source_audit.md) records actual absolute paths, byte sizes, SHA-256 checksums, exact ordered schemas/types, every column's null/invalid counts and numeric statistics, source samples, date checks, QA histograms, all 108 monthly reconciliations, and limitations.

**These are bounding-box AOI summaries, not an exact Story County polygon mask.** Do not present them as county-only statistics. The CSVs have no AOI geometry, CRS, coordinates, units, raw Pixel Reliability flags, or raw MODLAND QA flags. Product identity, already decoded dimensionless indices, and the upstream Pixel Reliability = 0 / MODLAND QA bits 0–1 = 0 rules are user-provided provenance. The audit checks available summaries without reapplying QA or multiplying values by 0.0001. Mahdi's separate Linux filesystem is not used.

`scripts/auditModisSource.js` uses only Node standard-library modules and reads `process.env.TERRAPULSE_DATA_ROOT` directly. It does not load a fallback root from the working directory, `.env`, another computer, or a hardcoded application path. The environment variable was absent from the inherited audit process, so the exact user-provided value was supplied only to the invoking command; private configuration was not changed. In PowerShell, set it explicitly before running:

```powershell
$env:TERRAPULSE_DATA_ROOT = 'C:\TerraPulseData'
npm run audit

# Also replace the backend audit report; source CSVs remain read-only.
node scripts/auditModisSource.js --report
```

Missing/relative root, missing/unreadable files, malformed CSV, or inspected-schema drift fails clearly. There is no alternative-path search. A 20 MiB per-summary audit limit prevents accidental loading of large source products. Default `npm run audit` prints the full report; only the explicit `--report` option writes the fixed report file under the backend's `reports` directory. On Windows, the direct Node command above avoids argument-forwarding differences between npm shell wrappers.

Audit results on November 13, 2026:

- **PASS:** 207 composite rows (2017-01-01–2025-12-19) and 108 monthly rows (2017-01–2025-12), with unique, valid, ascending calendar keys and no invalid numbers.
- Each composite has 37,575 total AOI pixels; base-valid counts range from 37,563 to 37,575. Variable-valid and quality-valid counts agree on every composite. Percentages and before/after usefulness histogram sums/subsets reconcile.
- All six NDVI/EVI mean/median/std columns contain 18 nulls in the composite file and 2 nulls in the monthly file. All other columns have zero nulls. Blank measurements remain null; zero pixel counts/percentages remain legitimate zeros. No interpolation or replacement values are produced.
- The 18 zero-quality composites are existing observations, all in December/January/February; their failure cause is not established. February 2019 and January 2021 have existing monthly rows but zero valid values, not absent month records. All 108 calendar months are present.
- Monthly observation counts sum to 207: 99 months have two composite dates and 9 have one. Total/valid pixel-observation counts reconcile exactly across files. These are repeated pixel-observation counts, not unique pixels or county area.
- The independent monthly means use each variable's valid-pixel count as its weight, excluding null/zero-weight values. Maximum absolute differences are 1.1102230246251565e-16 (NDVI) and 2.220446049250313e-16 (EVI), within the declared 1e-9 tolerance. Both zero-data monthly means remain null.
- Monthly standard deviations numerically agree with pooled population variances at floating-point precision. Monthly medians cannot be independently recovered from composite medians/counts. Original processing code, raw QA, exact footprint, observation timezone, and scale/units metadata are not independently verified by the CSVs.
- Source bytes were hashed before and after each audit and remained unchanged. No database connection exists in the audit script; no observations, DatasetAssets, lifecycle changes, vegetation collection/index, or vegetation API were created.

Verification: **117 default tests passed** (the existing 102 regressions plus 15 audit tests); both existing read-only Atlas integration checks passed (Study Areas and Dataset Registry). New tests exercise quoted CSV/JSON fields, dates, numeric/null handling, QA summaries, duplicate detection, calendar gaps, weighted reconciliation, schema drift, missing input, checksum/read-only behavior, and truthful failure reporting. Synthetic test fixtures are confined to temporary test files and are never treated as real NASA data or imported.

The paragraph above records the historical read-only phase. The user subsequently approved ingestion after a complete dry-run. The approved import is now complete, as documented below; exact county coverage and overall dataset readiness remain unverified/incomplete. The old county-masked expected filenames/report are not prerequisites or evidence for this AOI import.

## MODIS ingestion and vegetation APIs (Sprint 4)

The [ingestion report](reports/modis_ingestion_report.md) contains actual first/second import results, asset IDs, complete source mapping, SHA-256 checksums, preservation hashes, and directly verified Atlas indexes. No dependencies were added. The importer consumes only the two approved CSVs beneath `process.env.TERRAPULSE_DATA_ROOT`; application code contains no absolute data-root path. It never fetches or registers the unavailable raw NetCDF product.

```powershell
$env:TERRAPULSE_DATA_ROOT = 'C:\TerraPulseData'
npm run ingest:modis:dry-run
npm run ingest:modis

# Direct invocation defaults to a non-writing dry-run.
node scripts/ingestModis.js

# Read-only live verification, after the approved import:
npm run test:modis:integration
```

Keep `MONGODB_URI` in the existing private environment configuration. The data root must be absolute; absent roots or missing files fail without searching another machine. Source CSVs remain external and read-only, and CSV/NetCDF/raster files are excluded from Git. Checksums and sizes are pinned to this approved delivery: changed files require review and an explicit manifest update, rather than silent replacement. Changing an existing asset's private storage path also produces a conflict for review.

Both commands validate byte sizes, SHA-256, exact ordered schemas, every source row, dates/months, duplicates, counts, finite numeric values, nulls, pixel counts/percentages, QA histograms, and cross-file monthly weighted means. Both check the existing Dataset, pilot StudyArea, index compatibility, and existing stored values. A dry-run creates no collections, indexes, assets, observations, or lifecycle updates. It requires database access to pass the full conflict check; successful source validation alone does not authorize committing.

Commit repeats the read-only preflight, explicitly creates required indexes, and uses a MongoDB transaction with majority writes. Atlas/replica-set transaction support is required; there is no partial-write fallback. Immutable `$setOnInsert` upserts and the unique compound key prevent duplication. Conflicting values stop the import without overwriting them. Full transactional and post-commit read-back comparisons verify all source values and provenance. Source bytes are rechecked before writing and before transaction completion. Index/collection setup occurs outside the transaction, so empty infrastructure can remain after a failed transaction; observations, assets, and lifecycle changes commit together.

Stored collections are `vegetation_observations`, existing `dataset_assets`, and existing `datasets`. One observation collection distinguishes `resolution=16day|monthly`. The stable `aoiKey=modis-summary-aoi-v1` identifies this source pair without inventing its footprint. Every observation records source asset/checksum, unchanged decoded values, QA objects where supplied, original period key, explicit spatial flags, processing provenance, and its initial import time. Monthly `month`/`periodKey` preserve `YYYY-MM`; `observationDate` uses the first day at UTC midnight as a storage convention, not an observed timezone claim.

The first import inserted **207 composites + 108 monthly rows + 2 processed CSV assets**. Re-import inserted **0 observations and 0 assets**, changed no lifecycle fields, and preserved complete stored document hashes including timestamps. Actual indexes are:

| Collection | Name | Keys | Unique |
| --- | --- | --- | --- |
| vegetation_observations | vegetation_source_period_unique | datasetId, aoiKey, resolution, periodKey | Yes |
| vegetation_observations | vegetation_area_resolution_date | studyAreaId, resolution, observationDate | No |
| vegetation_observations | vegetation_geoid_resolution_period | areaGeoid, resolution, periodKey | No |
| dataset_assets | dataset_asset_key_unique | assetKey | Yes |
| dataset_assets | dataset_asset_dataset_type | datasetId, assetType, _id | No |

All keys are ascending and both collections retain MongoDB's `_id_` identity index. MODIS validation is now `validated` and processing `completed`, scoped explicitly to these processed summaries. Acquisition stays `request_completed`, overall readiness stays `not_ready`, and the registry's existing county coverage stays `unknown`. `processedSummaryAvailability` separately reports the available bounding-box summaries and `countyCoverageStatus=unverified`; it appears in dataset details/coverage and matching pilot-context coverage responses.

All three GET endpoints use `{ success, data, requestId }`:

| Endpoint | Behavior |
| --- | --- |
| `/api/v1/observations/vegetation` | Sorted, bounded listing with `data.items`, pagination, and metadata. |
| `/api/v1/observations/vegetation/summary` | Summary for an explicitly required resolution; statistics in `data.statistics`. |
| `/api/v1/observations/vegetation/:date` | Exact period lookup; `data.observation` and metadata. |

Listing and lookup default to `resolution=16day`. All routes accept `areaId` (24 hex characters), `geoid` (5 digits), and `resolution=16day|monthly`. Listing/summary accept inclusive `startDate` and `endDate`: valid `YYYY-MM-DD` for composites, `YYYY-MM` for monthly data. Listing accepts `page=1..10000` (default 1) and `limit=1..100` (default 20). Area filters refer only to pilot project context, never spatial containment; valid nonmatching filters yield an empty list/summary or lookup 404. Unknown/repeated parameters, invalid formats, mixed date granularity, and reversed ranges return 400. Missing lookup periods return 404 and database outages 503.

```powershell
$base = 'http://localhost:5000/api/v1/observations/vegetation'
Invoke-RestMethod "${base}?geoid=19169&limit=100"
Invoke-RestMethod "${base}?resolution=monthly&startDate=2019-01&endDate=2019-12"
Invoke-RestMethod "${base}/summary?resolution=16day"
Invoke-RestMethod "${base}/2019-02?resolution=monthly"
```

Summary `averagePeriodMean`, `minimumPeriodMean`, and `maximumPeriodMean` are **unweighted statistics across available period means**, not raw pixel extrema or a newly pooled monthly estimate. Monthly source means remain their original upstream pooled-pixel values. Nulls are ignored; all-null/empty selections return null statistics, never zero averages. Valid observation count requires both indices; per-index valid period counts are separate. `missingPeriods` identifies existing selected rows with missing measurements, not a fabricated calendar. Pixel coverage totals count repeated pixel-observations, not unique pixels or county area. Pagination totals and items are separate reads and may briefly differ during administrative changes.

All six measurements remain null in 18 composites and in February 2019/January 2021; zero counts/percentages remain zero. Literal CSV NaN/empty measurements are normalized to null, while other invalid numeric values fail validation. There is no interpolation, rescaling, monthly median/std recalculation, or new QA filtering. The upstream Pixel Reliability = 0 and MODLAND QA = 0 rules are recorded as supplied provenance, not independently verified raw QA.

Every vegetation response discloses NASA MOD13Q1.061, native 250 m resolution, selected temporal resolution, area-summary data level, missing-data limitations, and `spatialScope=bounding_box_aoi`, `countyMaskApplied=false`, `exactCountyStatistics=false`, `countyCoverageStatus=unverified`, `studyAreaRelationship=pilot_context_only`. No AOI polygon or exact CRS is inferred; these data cannot render pixel-level raster maps. Public DTOs omit private storage URIs, internal evidence references, private asset metadata, and internal content hashes.

Verification on November 13, 2026: **131 default tests passed**, preserving the earlier 117 tests; **all three opt-in Atlas checks passed** (Study Areas, Dataset Registry, MODIS). Live checks read back and compare all 315 source rows, verify actual unique indexes, exercise real HTTP filtering/pagination/date/summary/error responses, check null-only summaries, and verify unchanged collection hashes. Integration checks are read-only; the two explicitly executed real imports establish idempotency without synthetic data in Atlas. There is no authentication or public write/import endpoint in this sprint.

## Tests

```sh
npm test
```

Tests use Node's built-in test runner, temporary loopback HTTP ports, and no live Atlas credentials. Coverage includes environment validation, HTTP response contracts, CORS, security headers, body limits, redaction, database readiness transitions, retries, shutdown, and startup failures. Controlled connection doubles test successful connection transitions; a real Mongoose connection to an unused loopback port checks outage behavior without an external database. Server-process tests deliver the shutdown event through a test-only IPC wrapper so they can exercise the production handler on Windows too.

The default suite also checks geometry structure and limits, schema/index declarations, query validation, list/detail/validation endpoints, service behavior, official seed parsing, and connected database names. Synthetic coordinates exist only in tests and are never used as official boundaries or seeded into MongoDB. The default test suite never reads or uses your Atlas URI for connections.

Explicit Atlas integration checks require the configured live database and a seeded county:

```powershell
npm run seed:study-areas
npm run test:integration
```

The opt-in check verifies the stored county and actual index keys/options, readiness's database name, list routes with and without trailing slashes, geometry-inclusive listing, filtering/pagination, detail/400/404 responses, invalid geometry, and real inside/outside/boundary-crossing `$geoIntersects` queries. It also checks unchanged document counts and the complete county document after read-only validation. Audit-only `$documents` and `$geoWithin` queries independently verify fixture placement without saving documents; these checks require MongoDB 6.0+ and do not add containment to the public API. Run the seed twice and compare the reported ID to verify idempotence.

Study Areas audit snapshot before Sprint 3, on November 13, 2026: **68 default tests passed; 1 expanded opt-in Atlas integration test passed.** The later Dataset Registry verification above reports the current expanded suite. Re-run the commands after changes rather than treating these records as ongoing verification.

## Final Study Areas audit

The audit inspected the implementation and installed dependency tree, queried indexes directly from Atlas, ran the default and live test suites, and executed `npm run seed:study-areas` twice. Only the Study Areas seed verification, its tests, integration coverage, and this documentation changed; the API implementation and original boundary artifact were preserved.

Actual indexes on `terrapulse.study_areas`:

| Index name | Keys | Properties |
| --- | --- | --- |
| `_id_` | `{ _id: 1 }` | MongoDB's built-in unique identity index. |
| `study_area_slug_unique` | `{ slug: 1 }` | Unique. |
| `study_area_county_geoid_unique` | `{ countryCode: 1, geoid: 1 }` | Unique; partial filter `{ areaType: "county", geoid: { $type: "string" } }`. |
| `study_area_geometry_2dsphere` | `{ geometry: "2dsphere" }` | Actual geometry field; 2dsphere index version 3. |

Exactly one document matched Story County's GEOID and exactly one matched its slug. Both seed runs returned ID `6af71070cca3d14ecfec0aed`. Before/after comparisons preserved the ID, `createdAt`, and SHA-256 hashes of the stored geometry, complete geometry source, and metadata. `updatedAt` may advance when an existing document is reseeded; idempotence means stable identity and data without duplicates. The checked-in GeoJSON file was unchanged (SHA-256 `b40133a15e5f603f7a5968654984942b64c0ec6564e9b3e11648961cbb295e88`).

The official Feature remains structurally valid GeoJSON: Polygon, one closed ring, 1,050 positions. Its declared/transformed CRS is EPSG:4326, ordered longitude/latitude. Observed longitude bounds are [-93.698767, -93.231443] and latitude bounds are [41.862572, 42.209397]. The original source URL, retrieval date, vintage, archive checksum, source attributes, and conversion metadata were preserved.

| Spatial fixture | Public API intersection | Audit-only fixture placement |
| --- | --- | --- |
| Small polygon around the Census internal point | `true` | Within the county. |
| Polygon near longitude/latitude 0, 0 | `false` | Outside the county. |
| Polygon straddling an actual eastern boundary vertex | `true` | Not fully within the county. |
| Official county geometry itself | `true` | Containment not asserted for coincident boundaries. |

Every public response retained `fullContainment: "not_evaluated"`. Boundary-crossing intersection therefore cannot be mistaken for full containment. These fixtures are synthetic test inputs only and are never stored or labeled as official areas. See MongoDB's [intersection semantics](https://www.mongodb.com/docs/manual/reference/operator/query/geointersects/), [within semantics](https://www.mongodb.com/docs/manual/reference/operator/query/geowithin/), and [literal-document aggregation](https://www.mongodb.com/docs/manual/reference/operator/aggregation/documents/).

Verified HTTP behavior: both `GET /api/v1/study-areas` and its trailing-slash form return 200; valid details include geometry; invalid IDs return 400; a nonexistent ID returns 404; valid filtering and pagination produce the expected records/pages; malformed queries return 400. Invalid submitted geometry returns HTTP 200 with `data.valid: false`, meaningful validation errors, and no spatial query. `POST /api/v1/areas/validate` never persists submitted geometry.

The audit fixed an incomplete seed-success check: it previously compared only coordinates/vintage and the geospatial index. It now verifies full geometry/provenance, all required index definitions, and uniqueness of the stored county. Regression tests reject altered source metadata, changed provenance metadata, incorrect unique-index settings, incorrect county partial filters, and duplicate counts. Missing trailing-slash and spatial audit cases were added.

No robust topology validation library is installed in the backend's dependency tree; none was added during the audit. Validation remains structural, MongoDB's acceptance of the county/index is not a full topological certificate, and full containment is not implemented in the public API. Self-intersections, hole relationships, overlap, winding, and global/hemisphere edge cases remain limitations. Boundary-only contact follows MongoDB semantics and is not equivalent to the boundary-crossing fixture above. **Final module status: PASS within the implemented Study Areas scope.**

The Study Areas scope above includes no public geometry persistence, update/delete routes, complete topological validation, or full-containment analysis. MODIS processed-summary ingestion is documented separately above. Authentication, other source ingestion, and rotation/scoring endpoints remain future work.
