# Scenario Engine Foundation — readiness after Sprints 9–10

## Scope and current capabilities

The scenario engine provides a strategy catalog, stateless preference validation, and a Sprint 11 descriptive comparison of existing Engine evidence for Story County, Iowa. It does not evaluate agricultural performance, rank scenarios, predict outcomes, or generate recommendations. Scientific evaluation remains a foundation capability awaiting implementation and review. The descriptive endpoint is documented in [Scenario comparison API](scenario_comparison_api_contract.md).

| Identifier | Type | Definition |
| --- | --- | --- |
| `current_rotation` | baseline | Current corn-soybean rotation, used as the comparison baseline. |
| `water_first` | alternative | Strategy prioritizing water management; detailed crop sequence and interventions remain undefined. |
| `soil_first` | alternative | Strategy prioritizing soil health; detailed crop sequence and interventions remain undefined. |

Each definition has `id`, `name`, `description`, `type`, `objective`, `evaluationStatus: "not_implemented"`, and `scientificEvidenceStatus: "pending_verification"`. Objectives describe intended comparison priorities, not evidence of benefit. No alternative is asserted to be superior. No alternative crop sequence, yield, water saving, soil outcome, score, or ranking is supplied.

## Implemented architecture

```text
Express application
  -> existing request ID, security, CORS, logging, and JSON middleware
  -> /api/v1 router
     -> scenario router
        -> catalog + foundation readiness
        -> request-envelope validation -> reusable preference validator
        -> comparison query validation -> shared Engine service -> descriptive evidence
           -> pure historical analytics over validated evidence (Sprint 12)
  -> existing AppError handler / safe response envelope
```

| Module | Responsibility |
| --- | --- |
| `src/modules/scenarios/scenario.catalog.js` | Fixed catalog, copies for callers, and explicit foundation readiness. |
| `src/modules/scenarios/scenario.validation.js` | Independent weight validation and normalization; HTTP envelope validation is a separate exported function. |
| `src/modules/scenarios/scenario.routes.js` | GET catalog, POST preference validation, and GET descriptive comparison using existing response/error conventions. |
| `src/modules/scenarios/scenario.comparison.js` | Bounded reads through the existing Engine service, year selection, source-preserving evidence grouping, missingness counts, and explicit limitations. |
| `src/modules/analytics/historical.analytics.js` | Pure descriptive annual/seasonal statistics and historical differences over existing validated evidence; no extra reads or scientific evaluation. |
| `src/routes/index.js` | Mounts the new router alongside the existing modules. |

The scenario modules have no database, registry, ingestion, or observation-service dependency. All scenario routes work while MongoDB is unavailable; the comparison route additionally depends on readable, validated Engine files. The Engine and comparison routes share the existing configured Engine service. `/health/ready` and existing database routes retain their own database readiness semantics. No scenario data or preferences are persisted. No suitable user/profile architecture exists in this backend, so no preference model, collection, cookie, session, or storage mechanism is introduced.

The internal catalog is frozen and callers receive fresh copies, including readiness blockers. Validation does not mutate inputs or retain state between requests. The existing request logger records route/status/request ID, not submitted preference bodies. Successful preference responses use `Cache-Control: no-store`.

## Preference semantics

Supported criteria are exactly `water`, `soilHealth`, and `productivity`. Each must be an own property containing a finite JavaScript number from 0 to 100 inclusive. Decimal weights and totals other than 100 are accepted. Missing criteria, unknown criteria, strings, booleans, nulls, containers, non-finite numbers, out-of-range values, and all-zero configurations are rejected. HTTP requests must contain exactly the `weights` field.

For a valid configuration, each normalized weight is its original value divided by the sum of the three weights. The original values are copied unchanged. Zero is valid for an individual criterion when another weight is positive. Normalized weights sum to one within ordinary floating-point precision; they are not rounded for display by the backend.

For example, `{water: 50, soilHealth: 30, productivity: 20}` produces `{water: 0.5, soilHealth: 0.3, productivity: 0.2}`. `{water: 1, soilHealth: 1, productivity: 1}` produces approximately one third for each. These are expressions of user priorities, not agricultural measurements, probabilities, performance scores, or scientific confidence values. They do not select a scenario or establish the meaning of a future metric.

Errors use HTTP 400, `INVALID_PREFERENCES`, and the existing `AppError` envelope. Details contain an array of application-controlled field/code/message entries. Unknown keys and submitted invalid values are not reflected. JSON parser, body-size, CORS, request ID, and unexpected-error handling remain shared with the rest of the application. See [Scenario API contract](scenario_api_contract.md).

## Foundation readiness

The catalog and preference-validation routes expose the same foundation readiness metadata. The descriptive comparison has separate evidence metadata and does not enable scientific evaluation:

- Scenario definitions and preference validation are available.
- Stage is `foundation`.
- Data contract `1.0.0` is supported (`dataContractStatus: "supported"`, `dataContractVersion: "1.0.0"`).
- Structural validation of the delivered Engine data passed (`structuralValidationStatus: "passed"`).
- Scientific validation remains `not_assessed` (`scientificValidationStatus`); scenario evaluation remains `not_implemented` (`scientificEvaluationStatus`) and `scientificEvaluationReady` is false.
- The existing `finalDataDependenciesStatus` field is retained as `available`, referring to the delivered Engine inputs, not completeness of scenario-specific scientific inputs.
- Recommendation generation is disabled.
- Remaining blockers are scientific validation, scenario-specific inputs and evaluation methodology (`scientific_validation_not_assessed`, `scenario_inputs_pending`, `evaluation_methodology_pending`).

These static capability/delivery milestones reflect the completed Sprint 9 integration and Sprint 10 assessment, not a runtime filesystem or database health probe. They do not alter Dataset Registry lifecycle states or reuse their `ready` value as proof that a comparison is scientifically supported. Preference validity does not remove any scientific blocker. Per-scenario `scientificEvidenceStatus: "pending_verification"` is retained; delivery validation does not establish scientific evidence for an alternative.

## Future explainable evaluation architecture — design only

The following are proposed responsibility boundaries and acceptance gates, not implemented interfaces or a proposed final Data Engine payload schema. Their field names, storage representation, transport, and versioning must be agreed with Data Engineering before implementation.

1. **Data contract and provenance boundary.** Consume the supported Engine contract `1.0.0` through the existing integration layer. Preserve its verified structure, identifiers, types, units, missing-data semantics, periods, spatial grain, quality flags and provenance. Scientific applicability and independent source evidence remain separate checks.
2. **Eligibility and alignment boundary.** Verify that inputs cover the intended area and comparable periods; preserve missing values and quality limitations. Record unavailable/unsupported evidence explicitly instead of replacing it with zero. A registry lifecycle flag alone cannot establish spatial or scientific suitability.
3. **Scientific evaluation boundary.** Implement only reviewed, versioned methods linking specific scenario interventions to supported metrics. Observations of existing conditions do not by themselves estimate alternative-scenario outcomes. Detailed alternative definitions and a defensible baseline/counterfactual method are prerequisites.
4. **Preference application boundary.** After metric direction, scaling, comparability, missing-data behavior, and aggregation are scientifically approved, apply validated user priorities using an approved decision method. This sprint implements only preference normalization; it defines no scoring or aggregation formula for agricultural performance.
5. **Explanation and decision boundary.** Retain traceable inputs, methods, versions, uncertainty, and limitations for every result. Any ranking or recommendation requires separate scientific review and explicit implementation approval. Fail with an explicit unavailable status when evidence or methodology is insufficient.

### Explainability acceptance requirements

Every future evaluated metric needs the following information. This is an information checklist, not a final API or Data Engine schema.

| Information | Required meaning |
| --- | --- |
| Metric name | Agreed definition and associated scenario/criterion; distinguish observations from modeled outcomes. |
| Metric value | Supported observed or calculated value; explicit absence when unsupported, with a reason. |
| Unit | Verified unit, scale, conversions, and direction of improvement. |
| Data source | Provider/product/version and identifiers resolving to verified inputs. |
| Observation period | Start/end, temporal resolution, timezone/calendar, and any modeled horizon distinguished from observations. |
| Spatial scope | Actual footprint and relationship to Story County, including masking, aggregation, and coverage limits. |
| Calculation method | Reviewed method and version, transformations, parameters, aggregation, and missing-data treatment. |
| Evidence reference | Reproducible input/artifact identifiers and scientific justification; public references must not expose private storage paths or credentials. |
| Confidence or quality status | Agreed quality/uncertainty interpretation and basis; no invented confidence percentage. |
| Limitations | Coverage gaps, missingness, assumptions, uncertainty, applicability, and unsupported conclusions. |

Future comparative outputs must explain the role of each criterion, retain user weights separately from scientific metrics, and expose why an outcome cannot be evaluated. Any claim of superiority must be supported by evidence and a reviewed comparison method.

## Unresolved dependencies and limitations

- Final Engine contract `1.0.0`, schemas and eight datasets have been delivered and integrated; structural validation passed. Their availability does not establish scientific suitability for scenario comparisons. SMAP remains out of scope.
- Scientific work remains on temporal/spatial alignment, study-area applicability, reviewed metric definitions, method-specific missing inputs and independent evidence. Preserve the delivered units, quality flags, missing-data handling and provenance.
- Agree scientifically meaningful metrics for water, soil health, and productivity, including whether the available sources can support them at the relevant scale. NDVI/EVI are not automatically crop yield, productivity, soil health, or evidence of an intervention's benefit.
- Define and review the Water First and Soil First interventions and crop sequences with the scientific team. Their names alone are insufficient to model outcomes.
- Agree baseline/counterfactual methods, calibration, validation evidence, uncertainty reporting, score transformations, trade-off rules, and release criteria before enabling evaluation.
- Legacy MongoDB MODIS bounding-box observations remain separate from the new file-backed Engine MODIS summaries with their declared county pixel-center methodology. Preserve each source's scope, missing values and provenance; neither establishes scenario effects.
- Dataset lifecycle readiness and area-specific coverage remain separate from scientific evaluation readiness. This sprint reads or updates neither lifecycle states nor observations.
- No NASA POWER or MERRA-2 ingestion, source-data change, new dependency, or environment edit is included. Authentication, user profiles, saved preferences, agricultural outcome comparisons, and recommendations remain outside the implemented scope. The descriptive comparison exposes existing evidence without those capabilities.

## Verification

New unit/API tests cover exact catalog definitions, copy isolation, unavailable evaluation metadata, strict validation, per-criterion ranges/types/missingness, all-zero rejection, normalization, input preservation, malformed bodies, safe errors, shared middleware, database independence, and statelessness. Existing regression tests and the existing read-only Atlas suites are run separately; execution results are recorded in `reports/scenario_engine_foundation_report.md`.

Sprint 11 comparison tests additionally cover all three evidence sections, default/custom periods, original transition denominators, separate POWER points and MERRA-2 cells, MODIS filtering/QA/nulls, static soil availability, optional-source failures, pagination, provenance consistency, query errors, bounded reads and compatibility with the foundation responses. The full captured real-data response is linked from the comparison API contract. No Atlas connection is needed for this endpoint or its fixture-based tests.

Sprint 12 adds `descriptiveAnalytics` without changing existing comparison fields. Tests cover day-weighted climate summaries, leap years/completeness, pixel-weighted MODIS summaries at separate resolutions, percentage-point crop changes, original pair denominators, unweighted soil statistics/null distributions, source/QA preservation and database independence. [Historical analytics methodology](historical_analytics_methodology.md) defines every derived statistic and its denominator.
