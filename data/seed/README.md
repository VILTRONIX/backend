# Story County boundary provenance

`story-county.geojson` is an actual extracted **US Census Bureau TIGER/Line 2026** boundary, not an illustrative polygon. The official [release page](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) lists 2026 as the current release at acquisition; it was released October 14, 2026, with boundaries as of January 1, 2026.

- Download: [tl_2026_us_county.zip](https://www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip).
- Archive SHA-256: `b527c9ba7aeb8f17ef118f026eae5e5a938aa1d00b873bc32342d0dce59321c0`.
- Retrieved: November 13, 2026; exact UTC time is in `properties.geometrySource.retrievedAt`.
- Selection: exactly one DBF record with `GEOID == "19169"`, checked against `NAME == "Story"` and `STATEFP == "19"`.
- Source geometry: the matching record from `tl_2026_us_county.shp`; attributes from its DBF and source CRS from its PRJ.
- Source CRS: EPSG:4269 (NAD83); output CRS: EPSG:4326 (WGS84), always longitude before latitude.
- Conversion: pyshp 3.1.8 read the shapefile's GeoJSON representation; pyproj 3.8.0 transformed every coordinate with `always_xy=True`, `allow_ballpark=False`, and transformation errors enabled.
- Actual selected operation: `NAD83 to WGS 84 (1) (with axis order normalized for visualization)`. Its PROJ definition is `proj=noop ellps=GRS80`, with published transformation accuracy of 4 metres. This regional transformation can leave the numeric coordinates unchanged; it is an explicit datum transformation, not relabeling arbitrary projected coordinates. Transformation accuracy does not describe the survey accuracy of the source boundary.
- Output: Polygon, 1,050 positions including the closing position, no coordinate simplification, rounding, or invented vertices.

The Python conversion tools were installed in a temporary external tool directory for this one-time data preparation. They are not backend dependencies; runtime, seeding, and all application tests use the existing Node.js stack. The full national ZIP remains outside the project and is never inserted into MongoDB.

To reproduce acquisition with a GIS conversion tool, download the exact archive, verify its SHA-256, select the SHP record via its DBF GEOID, read the accompanying PRJ rather than assuming a CRS, convert the complete Polygon/MultiPolygon to EPSG:4326 without simplification, and preserve all provenance properties. With pyproj, inspect `get_last_used_operation()` after transforming a county position to record the actual operation rather than an unresolved transformer description. Reacquisition of newer vintages requires reviewing the release/source and updating provenance and tests.

The backend validates coordinate structure and ranges. It does not establish complete topological validity. The seed also requires MongoDB to accept the geometry under the `2dsphere` index and reads back the stored geometry before reporting success. Run `npm run seed:study-areas` from the project root; never substitute mock geometry if official acquisition fails.
