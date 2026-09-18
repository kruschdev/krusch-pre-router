import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  classifyPreRoute, 
  classifySpecialistRole, 
  detectKnowledgeBoundary, 
  isComplexPrompt, 
  evaluateComplexityScore, 
  pruneText 
} from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. L1 Fast-Path vs L2 Delegation Tests
test('classifyPreRoute - Fast-Path Identification vs L2 Delegation', () => {
  const fastPathSamples = [
    { query: 'Write a TypeScript function to reverse a linked list.', expectedRole: 'code' },
    { query: '```python\ndef quicksort(arr): pass\n```', expectedRole: 'code' },
    { query: 'Calculate \\frac{7}{12} + \\sqrt{81} and find x in the quadratic equation.', expectedRole: 'factual_stem' },
    { query: 'Translate "Where is the library?" into Spanish.', expectedRole: 'general_fast' },
    { query: 'Given board position with FEN rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR, what is the best move?', expectedRole: 'games_spatial' },
    { query: 'Based on the provided passage, what was the primary cause of the treaty failure?', expectedRole: 'comprehension_rc' },
    { query: 'Analyze the 10-K balance sheet and calculate the diluted EPS and operating margin.', expectedRole: 'reasoning_deep' },
    { query: 'Convert 100 miles to km.', expectedRole: 'general_fast' },
    { query: 'Prettify this JSON string: {"key":"value"}', expectedRole: 'general_fast' }
  ];

  for (const item of fastPathSamples) {
    const res = classifyPreRoute(item.query);
    assert.equal(res.isFastPath, true, `Expected query "${item.query}" to be Fast-Path`);
    assert.equal(res.role, item.expectedRole, `Expected role ${item.expectedRole} for query "${item.query}"`);
    assert.equal(res.confidence, 'high', `Expected high confidence for query "${item.query}"`);
    assert.equal(res.suggestedAction, 'dispatch_specialist', `Expected dispatch_specialist for query "${item.query}"`);
  }

  const unstructuredSamples = [
    'Hey, how are you feeling today?',
    'Tell me what you think about modern abstract art in contemporary galleries.',
    'Can we brainstorm some fun themes for an upcoming family reunion?',
    'I feel a little overwhelmed with work lately, what advice do you have for unwinding?'
  ];

  for (const query of unstructuredSamples) {
    const res = classifyPreRoute(query);
    assert.equal(res.isFastPath, false, `Expected query "${query}" to NOT be Fast-Path`);
    assert.equal(res.suggestedAction, 'delegate_to_l2', `Expected delegate_to_l2 for query "${query}"`);
  }
});

// 2. Cross-Language Parity Fixture Validation
test('classifySpecialistRole - Parity with Shared Routing Fixtures', () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'routing-spec.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  let passed = 0;
  for (const item of fixtures) {
    const role = classifySpecialistRole(item.query);
    assert.equal(
      role, 
      item.domain, 
      `Prompt [${item.query}] expected role [${item.domain}] but got [${role}]`
    );
    passed++;
  }
  assert.equal(passed, fixtures.length);
});

// 3. Knowledge Boundary Detection
test('detectKnowledgeBoundary - Closed-World vs Open-World', () => {
  assert.equal(detectKnowledgeBoundary('Calculate 15 * 42 + 18'), 'closed');
  assert.equal(detectKnowledgeBoundary('Convert 75 degrees Fahrenheit to Celsius'), 'closed');
  assert.equal(detectKnowledgeBoundary('Translate "hello world" into French'), 'closed');
  assert.equal(detectKnowledgeBoundary('Prettify this JSON string'), 'closed');
  assert.equal(detectKnowledgeBoundary('What is the regular expression for email validation?'), 'closed');
  assert.equal(detectKnowledgeBoundary('What are the ethical dilemmas in autonomous vehicles?'), 'open');
  assert.equal(detectKnowledgeBoundary('Explain the history of the Silk Road'), 'open');
});

// 4. Complexity Scoring & Pruning
test('evaluateComplexityScore and pruneText', () => {
  const noisy = 'Hey! Could you please help me with this? Write a quicksort in Go. Thanks in advance!';
  const pruned = pruneText(noisy);
  assert.equal(pruned.includes('Hey!'), false);
  assert.equal(pruned.includes('quicksort in Go'), true);

  const simpleScore = evaluateComplexityScore('What is 2 + 2?');
  assert.ok(simpleScore < 0.35, `Simple arithmetic should have low complexity, got ${simpleScore}`);

  const complexScore = evaluateComplexityScore('Analyze and architect a fault-tolerant distributed raft consensus algorithm with formal proofs.');
  assert.ok(complexScore > 0.35, `Complex prompt should have higher complexity, got ${complexScore}`);
});
