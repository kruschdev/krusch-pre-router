import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPreRoute, classifySpecialistRole } from '../dist/index.js';

import fs from 'node:fs';

/**
 * Out-of-Distribution (OOD) & Adversarial Evaluation Dataset
 * Loaded from test/fixtures/ood-prompts.json.
 * Represents open-world conversational chat, subjective reasoning,
 * colloquial language, and adversarial traps containing trigger words used in non-technical contexts.
 *
 * Ground Truth Action for all prompts: delegate_to_l2 (isFastPath: false, role: undefined).
 */
const fixturesPath = new URL('./fixtures/ood-prompts.json', import.meta.url);
const rawFixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const OOD_DATASET = rawFixtures.map(item => (typeof item === 'string' ? item : item.query));


test('OOD Evaluation - Measure Wrong-Specialist (False-Positive) Rate on Non-Holdout Traffic', () => {
  let falsePositives = 0;
  let cleanDelegations = 0;
  const misclassified = [];

  for (const prompt of OOD_DATASET) {
    const res = classifyPreRoute(prompt);

    if (res.isFastPath) {
      falsePositives++;
      misclassified.push({
        prompt: prompt.slice(0, 65) + (prompt.length > 65 ? '...' : ''),
        falselyAssignedRole: res.role,
        suggestedAction: res.suggestedAction,
        confidence: res.confidence
      });
    } else {
      cleanDelegations++;
      assert.equal(res.role, undefined, `Missed prompts must have undefined role`);
      assert.equal(res.suggestedAction, 'delegate_to_l2', `Unclassified prompts must delegate to L2`);
    }
  }

  const wrongSpecialistRate = (falsePositives / OOD_DATASET.length) * 100;
  const delegationAccuracy = (cleanDelegations / OOD_DATASET.length) * 100;

  console.log(`\n========================================================`);
  console.log(`🛡️  Out-of-Distribution (OOD) Wrong-Specialist Evaluation`);
  console.log(`========================================================`);
  console.log(`Total OOD Prompts Evaluated:   ${OOD_DATASET.length}`);
  console.log(`Clean L2 Delegations (True -): ${cleanDelegations}/${OOD_DATASET.length} (${delegationAccuracy.toFixed(1)}%)`);
  console.log(`Wrong-Specialist Rate (FP):    ${falsePositives}/${OOD_DATASET.length} (${wrongSpecialistRate.toFixed(1)}%)`);
  
  if (misclassified.length > 0) {
    console.log(`\n--- False Positive Trigger Breakdown (${misclassified.length}) ---`);
    for (const m of misclassified) {
      console.log(`  ❌ [Triggered: ${m.falselyAssignedRole}] "${m.prompt}"`);
    }
  } else {
    console.log(`\n✨ Perfect 0.0% False-Positive Rate across all ${OOD_DATASET.length} OOD/Adversarial prompts.`);
  }
  console.log(`========================================================\n`);

  // Assertions: False-positive wrong-specialist rate on OOD/adversarial traffic must be <= 3.0%
  assert.ok(
    wrongSpecialistRate <= 3.0, 
    `Wrong-specialist rate must be <= 3.0% (got ${wrongSpecialistRate.toFixed(2)}%)`
  );
  assert.ok(
    delegationAccuracy >= 97.0,
    `L2 delegation accuracy must be >= 97.0% (got ${delegationAccuracy.toFixed(2)}%)`
  );
});
