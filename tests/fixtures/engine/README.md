# SYNTHETIC TEST DATA ONLY

These fixtures exercise the provisional backend manifest adapter, loaders, validation, and API contracts. They are not Data Engineering outputs or agricultural measurements. All `sample_*` field names and values are arbitrary test inputs, not proposed scientific columns or units.

The manifest profile here is `terrapulse.features/1`, a provisional backend integration profile pending agreement with Data Engineering. Its format must not be attributed to the team's final engine.

Tests copy these fixtures to isolated temporary directories before making changes. They never create files in `data/processed/features` and never insert these records into MongoDB. `samples.json` and `samples.ndjson` deliberately contain equivalent synthetic records to exercise both adapters.
