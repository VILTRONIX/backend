# Scenario API contract — Sprint 7 foundation

Base path: `/api/v1`. The two foundation endpoints below are stateless and database-independent. They provide definitions and preference validation only. They require no new authentication/profile architecture and do not persist preferences. Sprint 11 adds the read-only descriptive [GET scenario comparison endpoint](scenario_comparison_api_contract.md), with its own evidence response; existing foundation contracts are unchanged.

Successful responses follow the existing `{success: true, data, requestId}` envelope. Errors follow `{success: false, error: {code, message, details?}, requestId}`. `requestId` matches the `X-Request-ID` response header. Existing security headers, configured CORS policy, JSON parsing, and 100 KB JSON body limit apply.

## GET /api/v1/scenarios

Returns HTTP 200 with exactly three scenario definitions, in the order below. No pagination or filters are defined. Query parameters do not change the catalog.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "current_rotation",
        "name": "Current Rotation",
        "description": "The current corn-soybean rotation, used as the comparison baseline.",
        "type": "baseline",
        "objective": "Provide the baseline for future comparisons in Story County, Iowa.",
        "evaluationStatus": "not_implemented",
        "scientificEvidenceStatus": "pending_verification"
      },
      {
        "id": "water_first",
        "name": "Water First",
        "description": "An alternative comparison strategy prioritizing water management; crop sequence is not defined.",
        "type": "alternative",
        "objective": "Explore water-management priorities once verified inputs and evaluation methods are available.",
        "evaluationStatus": "not_implemented",
        "scientificEvidenceStatus": "pending_verification"
      },
      {
        "id": "soil_first",
        "name": "Soil First",
        "description": "An alternative comparison strategy prioritizing soil health; crop sequence is not defined.",
        "type": "alternative",
        "objective": "Explore soil-health priorities once verified inputs and evaluation methods are available.",
        "evaluationStatus": "not_implemented",
        "scientificEvidenceStatus": "pending_verification"
      }
    ],
    "readiness": {
      "stage": "foundation",
      "scenarioDefinitionsAvailable": true,
      "preferenceValidationAvailable": true,
      "dataContractStatus": "supported",
      "dataContractVersion": "1.0.0",
      "structuralValidationStatus": "passed",
      "scientificValidationStatus": "not_assessed",
      "scientificEvaluationReady": false,
      "scientificEvaluationStatus": "not_implemented",
      "finalDataDependenciesStatus": "available",
      "recommendationGenerationEnabled": false,
      "blockers": [
        "scientific_validation_not_assessed",
        "scenario_inputs_pending",
        "evaluation_methodology_pending"
      ],
      "limitation": "Comparison strategies only; no validated agricultural evaluation or recommendation is available."
    }
  },
  "requestId": "<server-generated-request-id>"
}
```

Catalog membership does not mean a scenario is scientifically validated. No alternative crop sequence, measurements, scores, ranking, or claims of superiority are returned.

## POST /api/v1/scenarios/preferences/validate

Use `Content-Type: application/json`. The body must be an object with exactly one own field, `weights`, whose value is an object with exactly these three own fields:

| Criterion | Accepted value |
| --- | --- |
| `water` | Finite number, 0–100 inclusive |
| `soilHealth` | Finite number, 0–100 inclusive |
| `productivity` | Finite number, 0–100 inclusive |

All three fields are required and case-sensitive. Decimal values are accepted. Numeric strings, booleans, nulls, arrays, extra fields/criteria, negative numbers, numbers above 100, and an all-zero configuration are rejected. No coercion or default weight is applied. Totals need not equal 100. A single zero is allowed if at least one other weight is positive.

Request example:

```json
{
  "weights": { "water": 50, "soilHealth": 30, "productivity": 20 }
}
```

HTTP 200 response, with `Cache-Control: no-store`:

```json
{
  "success": true,
  "data": {
    "valid": true,
    "originalWeights": { "water": 50, "soilHealth": 30, "productivity": 20 },
    "normalizedWeights": { "water": 0.5, "soilHealth": 0.3, "productivity": 0.2 },
    "readiness": {
      "stage": "foundation",
      "scenarioDefinitionsAvailable": true,
      "preferenceValidationAvailable": true,
      "dataContractStatus": "supported",
      "dataContractVersion": "1.0.0",
      "structuralValidationStatus": "passed",
      "scientificValidationStatus": "not_assessed",
      "scientificEvaluationReady": false,
      "scientificEvaluationStatus": "not_implemented",
      "finalDataDependenciesStatus": "available",
      "recommendationGenerationEnabled": false,
      "blockers": [
        "scientific_validation_not_assessed",
        "scenario_inputs_pending",
        "evaluation_methodology_pending"
      ],
      "limitation": "Comparison strategies only; no validated agricultural evaluation or recommendation is available."
    }
  },
  "requestId": "<server-generated-request-id>"
}
```

Each normalized weight equals its original value divided by the sum of all three. The sum is one within floating-point precision. The API does not round weights for display. For `{water: 1, soilHealth: 1, productivity: 1}`, each result is approximately `0.3333333333333333`. For `{water: 0, soilHealth: 100, productivity: 0}`, results are `0`, `1`, `0`.

`valid: true` means only that the submitted preferences are valid. It does not mean that scientific inputs are ready, that any scenario is selected, or that a recommendation is available. No preferences are saved or reused on a later request.

### Preference validation errors

Invalid preferences return HTTP 400. Example for an all-zero configuration:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_PREFERENCES",
    "message": "Preference weights are invalid.",
    "details": {
      "errors": [
        {
          "field": "weights",
          "code": "ALL_ZERO",
          "message": "At least one weight must be greater than zero."
        }
      ]
    }
  },
  "requestId": "<server-generated-request-id>"
}
```

| Detail code | Meaning | Field |
| --- | --- | --- |
| `REQUIRED` | Missing body/weights or missing required criterion | `weights` or `weights.<supported criterion>` |
| `INVALID_TYPE` | Invalid weights container or non-finite/non-number criterion | `weights` or `weights.<supported criterion>` |
| `OUT_OF_RANGE` | Criterion below 0 or above 100 | `weights.<supported criterion>` |
| `UNSUPPORTED_CRITERIA` | Extra or misspelled weight criteria | `weights` |
| `UNSUPPORTED_FIELD` | Extra top-level body field | `body` |
| `ALL_ZERO` | All three valid numeric weights equal zero | `weights` |

Criterion errors are aggregated after container validation. Envelope errors may stop validation before criterion inspection. Details never include submitted invalid values or unknown field names. Invalid responses contain no normalized result and no `data` property.

### Shared middleware and unavailable routes

| Condition | HTTP status | Error code |
| --- | --- | --- |
| Malformed JSON or JSON primitive rejected by the shared strict parser | 400 | `INVALID_JSON` |
| JSON payload exceeds the shared limit | 413 | `PAYLOAD_TOO_LARGE` |
| Origin rejected by configured CORS policy | 403 | `CORS_ORIGIN_DENIED` |
| Undefined endpoint, including scientific evaluation or recommendation routes | 404 | `NOT_FOUND` |

A preference validation request without a parsed JSON object is invalid; send the documented content type. The descriptive GET comparison endpoint organizes existing source evidence. There is no scientific evaluation or recommendation endpoint, preference persistence API, agricultural score, or outcome calculation.

Scenario endpoints can return 200 while `/health/ready` returns 503 because the latter represents database readiness. Foundation `readiness` describes scenario capabilities, not database or Dataset Registry lifecycle state. The comparison endpoint additionally requires readable, validated Engine files.

## Remaining scientific dependencies

Engine contract 1.0.0 is supported and structural validation of the delivered data passed. Scientific validation is not_assessed, scenario evaluation is not_implemented, and recommendation generation remains disabled. The retained finalDataDependenciesStatus field now reports available for the Engine delivery; it does not assert that scenario-specific scientific inputs or methods are complete. These are reviewed capability/delivery milestones, not runtime filesystem or database health checks. Comparisons of agricultural outcomes still require verified metric definitions, spatial/temporal applicability, scenario-specific inputs, reviewed methods, evidence and uncertainty reporting. See [Scenario engine architecture](scenario_engine_architecture.md). SMAP remains out of scope.
