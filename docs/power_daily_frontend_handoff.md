# NASA POWER Daily — frontend handoff (Sprint 15)

## Request

`GET /api/v1/engine/climate/daily?startDate=2024-01-01&endDate=2024-01-31&page=1&limit=31`

Backend origin in the verified local environment: `http://localhost:5000`. Use the frontend origin allowed by the existing backend CORS configuration. No new authentication or frontend changes are introduced.

| Query | Rules |
| --- | --- |
| startDate, endDate | Optional inclusive ISO dates, YYYY-MM-DD; real calendar days; start must not follow end. |
| page | Default 1; 1–10000. |
| limit | Default 20; 1–100. |

Only these four parameters are supported. No year, location_id, areaId, scenario or weight filters. The dataset is a fixed single point. Outside-coverage selections return successful empty pages; no clipping or invented observations. Dates remain UTC date strings; do not convert date-only labels through local timezone offsets.

## Data contract

- Dataset ID: power_daily_context; optional supplement outside the unchanged eight-dataset manifest/catalog.
- Source: NASA POWER Daily Point API; date coverage 2021-01-01 through 2025-12-31; 1,826 unique daily records.
- Point: latitude 42.0375, longitude -93.4661. This is not a county average or field measurement and is separate from DG001–DG004 monthly POWER locations.
- date is ISO text; latitude/longitude and weather fields are numbers; YEAR/DOY are integers. Original weather parameter names are unchanged. Numeric CSV strings are decoded without unit conversion, rounding or imputation.
- Eight required weather parameters plus optional delivered T2MDEW: nine actual weather columns.

| Field | Unit / meaning |
| --- | --- |
| date | UTC YYYY-MM-DD |
| YEAR / DOY | Source year / day-of-year |
| latitude / longitude | degrees north / east |
| T2M_MAX / T2M_MIN / T2M | C; daily maximum/minimum/mean 2 m temperature |
| RH2M | %; 2 m relative humidity |
| WS10M | m/s; wind at 10 m, not automatically a 2 m wind value |
| ALLSKY_SFC_SW_DWN | MJ/m^2/day; incoming shortwave, not net radiation |
| PRECTOTCORR | mm/day; corrected precipitation |
| PS | kPa; pressure |
| T2MDEW | C; optional Dew/Frost Point at 2 m, present in this delivery |

Blank weather cells and documented numeric fill -999 are exposed as null, with missing/fill counts in dataset.metadata. Raw source files remain untouched; source hashes identify original bytes. Zero precipitation is valid zero. Do not use `value || 0` for missing data. No undocumented NULL/NaN/Infinity/string values are silently coerced. Actual delivery has zero missing and zero fill values in all nine weather fields.

## Response

Exact envelope: `{success:true,data:{dataset,items,pagination},requestId}`. The request ID matches X-Request-ID; Cache-Control is no-store.

dataset contains id, optional, status, structurallyReady, recordCount, verification, metadata and provenance. metadata contains source, temporalGrain, timeStandard, coordinates, coverage, primaryKey, sourceGridCellCenterCoordinates (null when undocumented), coordinateNote, spatialScope, fields (type/unit/description), missingValues, fillValues, missingValuePolicy and limitations. provenance carries CSV/metadata/audit/checksums-file hashes and the raw-source checksum if documented. No private filesystem paths or complete retrieval headers are exposed. Scientific verification remains not_assessed.

Actual HTTP 200 response from the running backend, for January 2024 with limit=1 (full dataset metadata included):

```json
{
  "success": true,
  "data": {
    "dataset": {
      "id": "power_daily_context",
      "optional": true,
      "status": "available",
      "structurallyReady": true,
      "recordCount": 1826,
      "verification": {
        "file": "verified",
        "metadata": "verified",
        "records": "verified",
        "scientific": "not_assessed"
      },
      "metadata": {
        "source": "NASA POWER Daily Point API",
        "temporalGrain": "Daily UTC",
        "timeStandard": "UTC",
        "coordinates": {
          "latitude": 42.0375,
          "longitude": -93.4661
        },
        "coverage": {
          "start": "2021-01-01",
          "end": "2025-12-31",
          "inclusive": true
        },
        "primaryKey": [
          "date"
        ],
        "sourceGridCellCenterCoordinates": null,
        "coordinateNote": "The CSV header echoes the request point; it does not disclose the contributing grid-cell centers. Matching coordinates do not imply field-scale observations.",
        "spatialScope": "One representative point requested at 42.0375, -93.4661, retaining POWER native source resolution; not a county-wide spatial average. No averaging/substitution of the four existing points.",
        "fields": {
          "date": {
            "type": "string",
            "unit": null,
            "description": null
          },
          "latitude": {
            "type": "number",
            "unit": "degrees_north",
            "description": null
          },
          "longitude": {
            "type": "number",
            "unit": "degrees_east",
            "description": null
          },
          "YEAR": {
            "type": "integer",
            "unit": null,
            "description": null
          },
          "DOY": {
            "type": "integer",
            "unit": null,
            "description": null
          },
          "T2M_MAX": {
            "type": [
              "number",
              "null"
            ],
            "unit": "C",
            "description": "MERRA-2 Temperature at 2 Meters Maximum"
          },
          "T2M_MIN": {
            "type": [
              "number",
              "null"
            ],
            "unit": "C",
            "description": "MERRA-2 Temperature at 2 Meters Minimum"
          },
          "T2M": {
            "type": [
              "number",
              "null"
            ],
            "unit": "C",
            "description": "MERRA-2 Temperature at 2 Meters"
          },
          "RH2M": {
            "type": [
              "number",
              "null"
            ],
            "unit": "%",
            "description": "MERRA-2 Relative Humidity at 2 Meters"
          },
          "WS10M": {
            "type": [
              "number",
              "null"
            ],
            "unit": "m/s",
            "description": "MERRA-2 Wind Speed at 10 Meters"
          },
          "ALLSKY_SFC_SW_DWN": {
            "type": [
              "number",
              "null"
            ],
            "unit": "MJ/m^2/day",
            "description": "CERES SYN1deg All Sky Surface Shortwave Downward Irradiance"
          },
          "PRECTOTCORR": {
            "type": [
              "number",
              "null"
            ],
            "unit": "mm/day",
            "description": "MERRA-2 Precipitation Corrected"
          },
          "PS": {
            "type": [
              "number",
              "null"
            ],
            "unit": "kPa",
            "description": "MERRA-2 Surface Pressure"
          },
          "T2MDEW": {
            "type": [
              "number",
              "null"
            ],
            "unit": "C",
            "description": "MERRA-2 Dew/Frost Point at 2 Meters"
          }
        },
        "missingValues": {
          "T2M_MAX": 0,
          "T2M_MIN": 0,
          "T2M": 0,
          "RH2M": 0,
          "WS10M": 0,
          "ALLSKY_SFC_SW_DWN": 0,
          "PRECTOTCORR": 0,
          "PS": 0,
          "T2MDEW": 0
        },
        "fillValues": {
          "T2M_MAX": 0,
          "T2M_MIN": 0,
          "T2M": 0,
          "RH2M": 0,
          "WS10M": 0,
          "ALLSKY_SFC_SW_DWN": 0,
          "PRECTOTCORR": 0,
          "PS": 0,
          "T2MDEW": 0
        },
        "missingValuePolicy": {
          "sourceFillValue": -999,
          "responseMissingValue": null,
          "imputation": "none"
        },
        "limitations": [
          "One representative point, not a county-wide average or field measurement.",
          "Separate from the four existing POWER monthly locations; no spatial averaging or substitution.",
          "Historical daily UTC source-product evidence, not a forecast or scenario-performance evaluation.",
          "No ET0, ETc, irrigation requirement, water savings, yield prediction or recommendation is calculated."
        ]
      },
      "provenance": {
        "checksumAlgorithm": "sha256",
        "checksum": "b0d5515c546e8e1b69262880a625cbb8e54a4eb86231efbe53c39c2f73649ae3",
        "metadataChecksum": "224336e9b99f8ee6d4d495d06aee1acd15021af3dc1d8ce6e70046b32e99b8d6",
        "auditChecksum": "54de48055d0bcd470b030a1b90471c11213fc31aef524c639513a1ff9b296532",
        "checksumsFileChecksum": "a4189e217c4781ffb94077a96b57d7a5c0c79c188b58d683c6a8bcfe9cfb8bcb",
        "rawSourceChecksum": "24754903063ef71e9f833b216c3bdbf0524a4ad477d82b081a044733bdeba041",
        "originalSourceVerification": "not_independently_verified"
      }
    },
    "items": [
      {
        "date": "2024-01-01",
        "latitude": 42.0375,
        "longitude": -93.4661,
        "YEAR": 2024,
        "DOY": 1,
        "T2M_MAX": 0.91,
        "T2M_MIN": -5.94,
        "T2M": -3.5,
        "RH2M": 74.58,
        "WS10M": 2.63,
        "ALLSKY_SFC_SW_DWN": 6.05,
        "PRECTOTCORR": 0,
        "PS": 98.92,
        "T2MDEW": -7.71
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 1,
      "total": 31,
      "totalPages": 31
    }
  },
  "requestId": "99c1c8d7-045f-48a0-a6d8-e8ea79833dec"
}
```

## Frontend usage

```javascript
const query = new URLSearchParams({
  startDate: "2024-01-01", endDate: "2024-01-31", page: "1", limit: "31"
});
const response = await fetch(`http://localhost:5000/api/v1/engine/climate/daily?${query}`);
const body = await response.json();
if (!response.ok || !body.success) {
  throw new Error(`${body.error?.message ?? "Daily weather unavailable"} [${body.requestId}]`);
}
const { dataset, items, pagination } = body.data;
// Plot item.date directly against unchanged parameter names, e.g. item.T2M.
// Get units from dataset.metadata.fields.T2M.unit.
// Render null as unavailable; retain actual zero values.
```

Show loading, empty success and unavailable states separately. Invalid queries return 400 INVALID_ENGINE_QUERY. Missing root/supplement, bad checksum, invalid records or changed/unreadable sources return 503 ENGINE_DATASET_UNAVAILABLE with datasetId=power_daily_context and optional=true. Retain the request ID and safe reason; do not render failure as empty weather.

## Integrity, caching and runtime setup

CSV SHA-256: `b0d5515c546e8e1b69262880a625cbb8e54a4eb86231efbe53c39c2f73649ae3`. The metadata and audit also match checksums.sha256. Each load validates the declared checksum, metadata/header/types, full chronological calendar, unique dates, YEAR/DOY, coordinates, units, missingness declarations and documented plausibility screens. No values are clipped. Existing bounded snapshot caching and filesystem guards are reused; there is no second caching layer. The shared eight-entry cache may evict a least-recently-used dataset when the daily supplement is also accessed.

Paths resolve relative to TERRAPULSE_ENGINE_ROOT. No hardcoded local repository path or .env edit is used. The audit shell fresh-start configuration had no Engine root; the already running backend successfully served the new endpoint. For a new launch, provide the actual absolute repository path in that process/deployment environment:

```powershell
$env:TERRAPULSE_ENGINE_ROOT = '<absolute local Engine repository directory>'
npm.cmd start
```

A missing daily supplement does not affect the eight-entry Engine catalog, mandatory Engine readiness, monthly POWER, the three scenarios or existing comparison/analytics responses. Consume daily data separately. No daily ingestion into MongoDB or supplement registration in the original manifest occurs.

## Scientific limits

Historical source-product evidence only. The request point retains NASA native spatial support; contributing grid-cell centers are undocumented and remain null. It does not establish county or field-scale weather, future forecasts, crop-rotation superiority, ET0/ETc, irrigation requirements, water savings, yield improvement, soil-health improvement, scores or recommendations. Original monthly locations, comparison responses and historical analytics remain unchanged.
