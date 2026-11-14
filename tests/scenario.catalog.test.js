import assert from 'node:assert/strict';
import test from 'node:test';
import { getScenarioCatalog, getScenarioReadiness } from '../src/modules/scenarios/scenario.catalog.js';

test('catalog contains exactly the three strategy definitions with an unevaluated baseline', () => {
  const { items } = getScenarioCatalog();
  assert.deepEqual(items.map(({ id, type }) => ({ id, type })), [
    { id: 'current_rotation', type: 'baseline' },
    { id: 'water_first', type: 'alternative' },
    { id: 'soil_first', type: 'alternative' },
  ]);
  for (const scenario of items) {
    assert.deepEqual(Object.keys(scenario).sort(), ['id', 'name', 'description', 'type', 'objective', 'evaluationStatus', 'scientificEvidenceStatus'].sort());
    for (const field of ['name', 'description', 'objective']) assert.ok(scenario[field].length > 0);
    assert.equal(scenario.evaluationStatus, 'not_implemented');
    assert.equal(scenario.scientificEvidenceStatus, 'pending_verification');
  }
  assert.match(items[0].description, /corn-soybean/);
  for (const scenario of items.slice(1)) assert.match(scenario.description, /crop sequence is not defined/);
});

test('readiness distinguishes working foundation capabilities from unavailable science and recommendations', () => {
  assert.deepEqual(getScenarioReadiness(), {
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
  });
});

test('callers cannot mutate subsequent catalog or readiness responses', () => {
  const expected = getScenarioCatalog();
  const response = getScenarioCatalog();
  response.items[0].name = 'Changed';
  response.items.pop();
  response.readiness.blockers.length = 0;
  response.readiness.recommendationGenerationEnabled = true;
  assert.deepEqual(getScenarioCatalog(), expected);
});
