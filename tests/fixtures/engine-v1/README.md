# SYNTHETIC CONTRACT 1.0.0 TEST DATA ONLY

`tests/helpers/engine-v1.js` builds isolated synthetic manifests, CSVs, and schemas under `tests/.tmp-engine/`. The field names exercise the real contract, but the values, dates, counts, units, and scope labels are arbitrary test inputs. They are not scientific observations or Engine deliveries.

No fixture is written to the Engine repository, a project output directory, or MongoDB. Cleanup verifies the resolved temporary path belongs to the backend's test directory before removing only the test-owned directory.
