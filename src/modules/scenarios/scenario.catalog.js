// Strategy definitions only. No crop sequences, measured outcomes, or recommendations.
const scenarios = Object.freeze([
  {
    id: 'current_rotation',
    name: 'Current Rotation',
    description: 'The current corn-soybean rotation, used as the comparison baseline.',
    type: 'baseline',
    objective: 'Provide the baseline for future comparisons in Story County, Iowa.',
  },
  {
    id: 'water_first',
    name: 'Water First',
    description: 'An alternative comparison strategy prioritizing water management; crop sequence is not defined.',
    type: 'alternative',
    objective: 'Explore water-management priorities once verified inputs and evaluation methods are available.',
  },
  {
    id: 'soil_first',
    name: 'Soil First',
    description: 'An alternative comparison strategy prioritizing soil health; crop sequence is not defined.',
    type: 'alternative',
    objective: 'Explore soil-health priorities once verified inputs and evaluation methods are available.',
  },
].map((scenario) => Object.freeze({
  ...scenario,
  evaluationStatus: 'not_implemented',
  scientificEvidenceStatus: 'pending_verification',
})));

export function getScenarioReadiness() {
  // Reviewed delivery milestones; Engine endpoints report runtime dataset availability separately.
  return {
    stage: 'foundation',
    scenarioDefinitionsAvailable: true,
    preferenceValidationAvailable: true,
    dataContractStatus: 'supported',
    dataContractVersion: '1.0.0',
    structuralValidationStatus: 'passed',
    scientificValidationStatus: 'not_assessed',
    scientificEvaluationReady: false,
    scientificEvaluationStatus: 'not_implemented',
    finalDataDependenciesStatus: 'available',
    recommendationGenerationEnabled: false,
    blockers: ['scientific_validation_not_assessed', 'scenario_inputs_pending', 'evaluation_methodology_pending'],
    limitation: 'Comparison strategies only; no validated agricultural evaluation or recommendation is available.',
  };
}

export function getScenarioCatalog() {
  return { items: structuredClone(scenarios), readiness: getScenarioReadiness() };
}
