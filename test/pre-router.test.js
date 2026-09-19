import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  classifyPreRoute, 
  classifySpecialistRole, 
  classifyKeywords,
  detectKnowledgeBoundary, 
  isComplexPrompt, 
  evaluateComplexityScore, 
  pruneText,
  PreRouteCache,
  createPreRouter,
  RULE_CATALOG,
  RULES_VERSION
} from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Stage-0 Fast-Path vs L2 Delegation Tests
test('classifyPreRoute - Fast-Path Identification vs L2 Delegation', () => {
  // Explicit golden check: natural language prompt must miss under default preset
  assert.equal(
    classifyPreRoute('Write a Python function to reverse a string.').isFastPath,
    false
  );

  // Pure structural syntax samples (active in default 'structure' preset)
  const structureSamples = [
    { query: '```python\ndef quicksort(arr): pass\n```', expectedRole: 'code', reason: 'fence' },
    { query: 'SELECT u.id, u.email FROM users u WHERE u.active = 1;', expectedRole: 'code', reason: 'sql' },
    { query: 'Calculate \\frac{7}{12} + \\sqrt{81} and find x in the quadratic equation.', expectedRole: 'factual_stem', reason: 'latex' },
    { query: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6', expectedRole: 'games_spatial', reason: 'chess_move' },
    { query: 'Traceback (most recent call last):\nTypeError: Cannot read properties of undefined', expectedRole: 'code', reason: 'stack_trace' }
  ];

  for (const item of structureSamples) {
    const res = classifyPreRoute(item.query);
    assert.equal(res.isFastPath, true, `Expected query "${item.query}" to be Fast-Path`);
    assert.equal(res.role, item.expectedRole, `Expected role ${item.expectedRole} for query "${item.query}"`);
    assert.equal(res.reason, item.reason);
    assert.equal(res.confidence, 'high', `Expected high confidence for query "${item.query}"`);
    assert.equal(res.suggestedAction, 'dispatch_specialist', `Expected dispatch_specialist for query "${item.query}"`);
    assert.ok(res.scanWindowUsed.totalChars > 0);
  }

  // Lexical domain phrasing (active in opt-in 'structure+lexical' or legacy 'anchors-only')
  const lexicalSamples = [
    { query: 'Write a TypeScript function to reverse a linked list.', expectedRole: 'code', reason: 'code_syntax' },
    { query: 'Based on the provided passage, what was the primary cause of the treaty failure?', expectedRole: 'comprehension_rc', reason: 'comprehension' },
    { query: 'Analyze the 10-K balance sheet and calculate the diluted EPS and operating margin.', expectedRole: 'reasoning_deep', reason: 'deep_reasoning' }
  ];

  for (const item of lexicalSamples) {
    // Under default structure, lexical phrasing must miss cleanly
    const defaultMiss = classifyPreRoute(item.query);
    assert.equal(defaultMiss.isFastPath, false, `Lexical query should miss under structure default`);
    assert.equal(defaultMiss.role, undefined);

    // Under structure+lexical, lexical phrasing fast-paths
    const optInHit = classifyPreRoute(item.query, { preset: 'structure+lexical' });
    assert.equal(optInHit.isFastPath, true);
    assert.equal(optInHit.role, item.expectedRole);
    assert.equal(optInHit.reason, item.reason);
  }

  // Keyword samples under opt-in preset
  const keywordSamples = [
    { query: 'Translate "Where is the library?" into Spanish.', expectedRole: 'general_fast', reason: 'keyword' },
    { query: 'Convert 100 miles to km.', expectedRole: 'general_fast', reason: 'closed_world' },
    { query: 'Prettify this JSON string: {"key":"value"}', expectedRole: 'general_fast', reason: 'closed_world' }
  ];

  for (const item of keywordSamples) {
    // Under default structure, keywords must miss cleanly
    const defaultMiss = classifyPreRoute(item.query);
    assert.equal(defaultMiss.isFastPath, false, `Keyword query should miss under default structure`);
    assert.equal(defaultMiss.role, undefined);
    assert.equal(defaultMiss.reason, 'miss');

    // Under 'structure+lexical+keywords' (and 'all') opt-in, keywords fast-path
    const optInHit = classifyPreRoute(item.query, { preset: 'structure+lexical+keywords' });
    assert.equal(optInHit.isFastPath, true);
    assert.equal(optInHit.role, item.expectedRole);
    assert.equal(optInHit.reason, item.reason);

    const helperHit = classifyKeywords(item.query);
    assert.equal(helperHit.isFastPath, true);
    assert.equal(helperHit.role, item.expectedRole);
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
    assert.equal(res.role, undefined, `Expected role to be undefined on miss for query "${query}"`);
    assert.equal(res.suggestedAction, 'delegate_to_l2', `Expected delegate_to_l2 for query "${query}"`);
    assert.equal(res.reason, 'miss');
  }
});

// 2. Precedence as Data: Parity with Shared Routing Fixtures Spec
test('classifyPreRoute - Parity with Shared Routing Fixtures and Precedence Data', () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'routing-spec.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  let passed = 0;
  for (const item of fixtures) {
    const res = classifyPreRoute(item.query, { preset: item.preset });
    
    if (item.isFastPath) {
      assert.equal(res.isFastPath, true, `Query "${item.query}" expected fast path`);
      assert.equal(res.role, item.domain, `Query "${item.query}" expected role ${item.domain} but got ${res.role}`);
      assert.equal(res.reason, item.reason, `Query "${item.query}" expected reason ${item.reason} but got ${res.reason}`);
    } else {
      assert.equal(res.isFastPath, false, `Query "${item.query}" expected miss`);
      assert.equal(res.role, undefined, `Query "${item.query}" expected undefined role on miss`);
      assert.equal(res.reason, item.reason, `Query "${item.query}" expected reason ${item.reason}`);
    }
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
  assert.equal(detectKnowledgeBoundary(''), 'open');
  assert.equal(detectKnowledgeBoundary('   '), 'open');
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

// 5. In-Memory LRU Cache & Default Hits-Only Memoization
test('PreRouteCache - LRU storage, whitespace normalization, and eviction', () => {
  const cache = new PreRouteCache({ maxSize: 2 });

  const res1 = classifyPreRoute('```python\ndef quicksort(arr): pass\n```');
  const res2 = classifyPreRoute('SELECT * FROM users;');
  const res3 = classifyPreRoute('1. e4 e5 2. Nf3 Nc6');

  cache.set('```python\ndef quicksort(arr): pass\n```', res1);
  cache.set('SELECT * FROM users;', res2);

  assert.equal(cache.size, 2);
  assert.ok(cache.has('SELECT   *   FROM   users;')); // normalized whitespace matches
  assert.equal(cache.get('```python\ndef quicksort(arr): pass\n```')?.role, 'code');

  // Adding 3rd item should evict 'SELECT * FROM users;' because '```python...' was refreshed by get()
  cache.set('1. e4 e5 2. Nf3 Nc6', res3);
  assert.equal(cache.size, 2);
  assert.ok(cache.has('```python\ndef quicksort(arr): pass\n```'));
  assert.ok(cache.has('1. e4 e5 2. Nf3 Nc6'));
  assert.equal(cache.has('SELECT * FROM users;'), false);
});

test('PreRouteCache - cachePolicy hits vs all', () => {
  // Default cachePolicy is 'hits': misses are NOT stored
  const hitsCache = new PreRouteCache();
  const missRes = classifyPreRoute('Tell me a bedtime story about dragons');
  assert.equal(missRes.isFastPath, false);

  hitsCache.set('Tell me a bedtime story about dragons', missRes);
  assert.equal(hitsCache.has('Tell me a bedtime story about dragons'), false, 'Miss should not be cached under hits policy');

  // Explicit cachePolicy: 'all' caches misses
  const allCache = new PreRouteCache({ cachePolicy: 'all' });
  allCache.set('Tell me a bedtime story about dragons', missRes);
  assert.equal(allCache.has('Tell me a bedtime story about dragons'), true, 'Miss should be cached under all policy');
});

test('createPreRouter - Stateful cached routing wrapper', () => {
  const router = createPreRouter({ cache: { maxSize: 10 } });
  assert.ok(router.cache);

  const q = '```cpp\nint binary_search(int arr[], int x);\n```';
  const res1 = router.classify(q);
  assert.equal(res1.isFastPath, true);
  assert.equal(res1.role, 'code');

  // Verify result is cached
  assert.ok(router.cache.has(q));
  const res2 = router.classify(q);
  assert.deepEqual(res1, res2);

  // Clear cache
  router.clearCache();
  assert.equal(router.cache.size, 0);

  // Test opt-in preset structure+lexical with natural language phrases
  const lexicalRouter = createPreRouter({ preset: 'structure+lexical' });
  const nlQuery = 'Write a fast binary search in C++';
  const nlRes1 = lexicalRouter.classify(nlQuery);
  assert.equal(nlRes1.isFastPath, true);
  assert.equal(nlRes1.role, 'code');
  assert.ok(lexicalRouter.cache?.has(nlQuery));
});

// 6. classifySpecialistRole Miss Behavior
test('classifySpecialistRole - Returns undefined on conversational/unstructured queries', () => {
  assert.equal(classifySpecialistRole('Hey, how are you today?'), undefined);
  assert.equal(classifySpecialistRole('Tell me what you think about modern abstract art.'), undefined);
  assert.equal(classifySpecialistRole('What advice do you have for unwinding after work?'), undefined);
  assert.equal(classifySpecialistRole('Who was the world chess champion in 1972?'), undefined);
  assert.equal(classifySpecialistRole('Who invented the Sicilian Defense?'), undefined);
  assert.equal(classifySpecialistRole('Search engine ranking factors for e-commerce sites'), undefined);
});

// 7. Defensive Copying & Immutability Test
test('PreRouteCache - Defensive cloning prevents cache corruption from caller mutation', () => {
  const router = createPreRouter();
  const q = '```go\nfunc quicksort(arr []int) {}\n```';

  const res1 = router.classify(q);
  assert.equal(res1.role, 'code');

  // Attempt to mutate the returned result
  res1.role = 'factual_stem';
  res1.isFastPath = false;

  // Verify that the cached result was NOT corrupted
  const res2 = router.classify(q);
  assert.equal(res2.role, 'code');
  assert.equal(res2.isFastPath, true);
});

// 8. Message[] Role Differentiation and Rules Version in Cache Keys
test('PreRouteCache - Message[] role differentiation and rule versioning in cache keys', () => {
  const router = createPreRouter();

  const userMsg = [{ role: 'user', content: 'What is 2 + 2?' }];
  const assistantMsg = [{ role: 'assistant', content: 'What is 2 + 2?' }];

  const key1 = router.cache?.normalizeKey(userMsg);
  const key2 = router.cache?.normalizeKey(assistantMsg);

  assert.notEqual(key1, key2);
  assert.equal(key1, `[v${RULES_VERSION}:structure]user:What is 2 + 2?`);
  assert.equal(key2, `[v${RULES_VERSION}:structure]assistant:What is 2 + 2?`);

  // Explicit golden rule version invalidation test
  const cacheV1 = new PreRouteCache({ rulesVersion: 1 });
  const cacheV2 = new PreRouteCache({ rulesVersion: 2 });
  const prompt = 'SELECT * FROM users';
  const k1 = cacheV1.normalizeKey(prompt);
  const k2 = cacheV2.normalizeKey(prompt);
  assert.equal(k1, '[v1:structure]SELECT * FROM users');
  assert.equal(k2, '[v2:structure]SELECT * FROM users');
  assert.notEqual(k1, k2);

  // Storing under v1 does NOT hit under v2
  const dummyRes = classifyPreRoute(prompt);
  cacheV1.set(prompt, dummyRes);
  assert.ok(cacheV1.has(prompt));
  assert.equal(cacheV2.has(prompt), false, 'Cache entry stored under v1 must not hit in v2 cache');
});

// 9. Cache Namespacing Isolation
test('PreRouteCache - Namespace isolation prevents collision across configurations', () => {
  const cacheA = new PreRouteCache({ namespace: 'tenant-alpha' });
  const cacheB = new PreRouteCache({ namespace: 'tenant-beta' });
  const cacheDefault = new PreRouteCache();

  const prompt = 'What is the sum of 10 and 20?';
  const keyA = cacheA.normalizeKey(prompt);
  const keyB = cacheB.normalizeKey(prompt);
  const keyDefault = cacheDefault.normalizeKey(prompt);

  assert.equal(keyA, `[v${RULES_VERSION}:structure][tenant-alpha]What is the sum of 10 and 20?`);
  assert.equal(keyB, `[v${RULES_VERSION}:structure][tenant-beta]What is the sum of 10 and 20?`);
  assert.equal(keyDefault, `[v${RULES_VERSION}:structure]What is the sum of 10 and 20?`);
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, keyDefault);

  // Cross-tenant router isolation test
  const routerA = createPreRouter({ namespace: 'profile-a' });
  const routerB = createPreRouter({ namespace: 'profile-b' });

  assert.equal(routerA.cache?.namespace, 'profile-a');
  assert.equal(routerB.cache?.namespace, 'profile-b');

  const q = '```python\ndef foo(): pass\n```';
  routerA.classify(q);
  assert.ok(routerA.cache?.has(q));
  assert.equal(routerB.cache?.has(q), false);
});

// 10. Non-blocking Telemetry Hook (onRoute) with Schema v1
test('createPreRouter - onRoute non-blocking telemetry hook fires with v1 schema and sampling', () => {
  const events = [];
  const router = createPreRouter({
    namespace: 'audit-test',
    onRoute: (telemetry) => {
      events.push(telemetry);
    }
  });

  const query = '```go\nfunc quicksort(arr []int) {}\n```';

  // 1st call: Miss path from cache
  const res1 = router.classify(query);
  assert.equal(events.length, 1);
  assert.equal(events[0].version, '1');
  assert.equal(events[0].fromCache, false);
  assert.equal(events[0].result.role, 'code');
  assert.equal(events[0].namespace, 'audit-test');
  assert.equal(events[0].reason, 'fence');
  assert.ok(events[0].timestamp > 0);

  // 2nd call: Hit path from cache
  const res2 = router.classify(query);
  assert.equal(events.length, 2);
  assert.equal(events[1].fromCache, true);
  assert.equal(events[1].result.role, 'code');
  assert.equal(events[1].namespace, 'audit-test');
  assert.deepEqual(res1, res2);
});

// 11. Resilience: Telemetry Hook Exceptions are Swallowed
test('createPreRouter - onRoute exceptions are swallowed and do not disrupt routing', () => {
  const router = createPreRouter({
    onRoute: () => {
      throw new Error('Simulated external logger / disk failure');
    }
  });

  assert.doesNotThrow(() => {
    const res = router.classify('```rust\nfn quicksort() {}\n```');
    assert.equal(res.role, 'code');
    assert.equal(res.isFastPath, true);
  });
});

// 12. Precision: Markdown Code Fence Tightening
test('classifyPreRoute - code fence requires language tag or code constructs to trigger code role', () => {
  const plainProse = '```\nDear team,\nPlease review the minutes from our all-hands meeting.\n```';
  const proseRes = classifyPreRoute(plainProse);
  assert.equal(proseRes.isFastPath, false);
  assert.equal(proseRes.role, undefined);

  const taggedCode = '```python\nx = 1\n```';
  const taggedRes = classifyPreRoute(taggedCode);
  assert.equal(taggedRes.isFastPath, true);
  assert.equal(taggedRes.role, 'code');

  const untaggedCode = '```\nfunction calculateTax(subtotal) {\n  return subtotal * 0.08;\n}\n```';
  const untaggedRes = classifyPreRoute(untaggedCode);
  assert.equal(untaggedRes.isFastPath, true);
  assert.equal(untaggedRes.role, 'code');
});

// 13. Precision: STEM Qualified Keyword Gating
test('classifyPreRoute - conversational probability and metaphorical DNA cleanly delegate to L2', () => {
  const weatherRes = classifyPreRoute('There is a high probability of heavy rain this afternoon.', { preset: 'structure+lexical' });
  assert.equal(weatherRes.isFastPath, false);
  assert.equal(weatherRes.role, undefined);

  const mathProbRes = classifyPreRoute('Calculate the probability of drawing three red aces from the deck.', { preset: 'structure+lexical' });
  assert.equal(mathProbRes.isFastPath, true);
  assert.equal(mathProbRes.role, 'factual_stem');

  const metaphorDnaRes = classifyPreRoute('Collaboration and kindness are deeply woven into the DNA of our culture.', { preset: 'structure+lexical' });
  assert.equal(metaphorDnaRes.isFastPath, false);
  assert.equal(metaphorDnaRes.role, undefined);

  const bioDnaRes = classifyPreRoute('Explain how CRISPR-Cas9 induces double-strand DNA breaks.', { preset: 'structure+lexical' });
  assert.equal(bioDnaRes.isFastPath, true);
  assert.equal(bioDnaRes.role, 'factual_stem');
});

// 14. Precision: Multiple-Choice Decoupling from STEM
test('classifyPreRoute - non-STEM multiple choice questions do not dump into factual_stem', () => {
  const historyMCQ = `Options:
A. Paris
B. London
C. Rome
D. Madrid
Which city hosted the 1908 Olympic Games?`;
  const res = classifyPreRoute(historyMCQ);
  assert.notEqual(res.role, 'factual_stem');

  const managementMCQ = `Which style of leadership is most effective for creative agencies?
A. Authoritarian
B. Democratic
C. Laissez-faire
D. Paternalistic`;
  const res2 = classifyPreRoute(managementMCQ);
  assert.equal(res2.isFastPath, false);
  assert.equal(res2.role, undefined);
});

// 15. Safety: Large Payload Bounded Scanning
test('classifyPreRoute - large payloads (>10KB) evaluate safely without latency regression or ReDoS', () => {
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(400);
  const largePrompt = `\`\`\`python\ndef fib(n):\n    return n\n\`\`\`\n${filler}`;
  
  const start = performance.now();
  const res = classifyPreRoute(largePrompt);
  const elapsedMs = performance.now() - start;

  assert.equal(res.isFastPath, true);
  assert.equal(res.role, 'code');
  assert.equal(res.scanWindowUsed.truncated, true);
  assert.ok(elapsedMs < 5.0, `Expected elapsed time < 5ms, got ${elapsedMs}ms`);
});

// 16. Custom Domain Roles
test('createPreRouter - supports custom domain role taxonomies and overrides', () => {
  const router = createPreRouter({
    customSpecialistRules: [
      { role: 'billing_ops', pattern: /\b(?:stripe invoice|chargeback|mrr|refund request)\b/i },
      { role: 'compliance_legal', pattern: /\b(?:gdpr deletion|ccpa request|subprocessor agreement)\b/i }
    ]
  });

  const billingRes = router.classify('Please check the stripe invoice for customer 451.');
  assert.equal(billingRes.isFastPath, true);
  assert.equal(billingRes.role, 'billing_ops');
  assert.equal(billingRes.reason, 'custom');

  const legalRes = router.classify('We received a gdpr deletion request from an EU resident.');
  assert.equal(legalRes.isFastPath, true);
  assert.equal(legalRes.role, 'compliance_legal');
  assert.equal(legalRes.reason, 'custom');
});

// 17. Code-over-Games Precedence
test('classifyPreRoute - code-over-games precedence, tightened chess/JSON/fences', () => {
  const pythonPgn = classifyPreRoute('Write a Python script to parse a chess PGN and validate legal moves.', { preset: 'structure+lexical' });
  assert.equal(pythonPgn.isFastPath, true);
  assert.equal(pythonPgn.role, 'code');
  assert.equal(pythonPgn.reason, 'code_syntax');

  const chessHistory = classifyPreRoute('Who was the world chess champion in 1972?');
  assert.equal(chessHistory.isFastPath, false);
  assert.equal(chessHistory.role, undefined);

  const chessMoves = classifyPreRoute('1. e4 e5 2. Nf3 Nc6');
  assert.equal(chessMoves.isFastPath, true);
  assert.equal(chessMoves.role, 'games_spatial');
  assert.equal(chessMoves.reason, 'chess_move');
});

// 18. OOD Harvest Pipeline Verification
test('harvest:ood - Sample traffic log ingestion and stage-0 trap detection', async () => {
  const { execSync } = await import('node:child_process');
  const sampleLogPath = path.join(__dirname, 'fixtures', 'sample-traffic.jsonl');
  
  const output = execSync(`node scripts/harvest-ood.js "${sampleLogPath}" --dry-run`, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.ok(output.includes('Krusch Pre-Router OOD Harvest Pipeline'));
  assert.ok(output.includes('Total Log Lines Parsed:    7'));
  assert.ok(output.includes('Dry-run complete. No changes were written.'));
});

// 19. Clinical Medicine & Pharmacology Safety (Deny List Block)
test('classifyPreRoute - clinical medicine and pharmacology trigger deny list and force honest miss', () => {
  const clinicalQueries = [
    'A 45-year-old patient presents with sudden severe chest pain radiating to the left shoulder.',
    'patient presents with crushing chest pain',
    'What are the typical clinical symptoms and treatment options for Lyme disease?',
    'What are the main pharmacological differences between acetaminophen and ibuprofen?',
    'Prescribe antibiotics and recommend pediatric dosage for acute otitis media.',
    'Patient presents with high fever, neck stiffness, and photophobia.'
  ];

  for (const query of clinicalQueries) {
    const res = classifyPreRoute(query);
    assert.equal(res.isFastPath, false, `Clinical query "${query}" must NOT be fast-pathed`);
    assert.equal(res.role, undefined, `Clinical query "${query}" must have undefined role`);
    assert.equal(res.suggestedAction, 'delegate_to_l2');
    assert.equal(res.reason, 'deny');
    assert.ok(res.ruleId?.startsWith('deny:'));
    assert.equal(classifySpecialistRole(query), undefined);
  }
});

// 20. Total Precedence Invariant Test (deny > custom > anchors > keywords > miss)
test('classifyPreRoute - total precedence invariant: deny > custom > anchors > keywords > miss', () => {
  // 1a. Deny beats Python code fence with dosing
  const codeFencePharma = '```python\n# Calculate pediatric dosage of vancomycin for acute infection\ndef dose(weight):\n    return weight * 15\n```';
  const denyPharmaRes = classifyPreRoute(codeFencePharma);
  assert.equal(denyPharmaRes.isFastPath, false, 'Deny must override code fence with pharmacology');
  assert.equal(denyPharmaRes.reason, 'deny');
  assert.equal(denyPharmaRes.ruleId, 'deny:pharmacology_dosing');

  // 1b. Deny beats TypeScript code fence with cardiac clinical emergency
  const codeFenceEmergency = '```typescript\n// Patient presents with sudden severe crushing chest pain\nfunction triagePatient() { return "critical"; }\n```';
  const denyEmergencyRes = classifyPreRoute(codeFenceEmergency);
  assert.equal(denyEmergencyRes.isFastPath, false, 'Deny must override code fence containing emergency');
  assert.equal(denyEmergencyRes.reason, 'deny');
  assert.equal(denyEmergencyRes.ruleId, 'deny:clinical_emergency');

  // 1c. Deny beats SQL DDL/DML with legal directives
  const sqlLegal = 'SELECT * FROM complaints; -- should I sue my former employer and evaluate my legal liability under statute';
  const denySqlRes = classifyPreRoute(sqlLegal);
  assert.equal(denySqlRes.isFastPath, false, 'Deny must override SQL code token');
  assert.equal(denySqlRes.reason, 'deny');
  assert.equal(denySqlRes.ruleId, 'deny:legal_counsel');

  // 2. Deny beats custom rule
  const customPharmaRouter = createPreRouter({
    customSpecialistRules: [
      { role: 'pharma_agent', pattern: /\bvancomycin\b/i }
    ]
  });
  const denyCustomRes = customPharmaRouter.classify('Calculate pediatric dosage of vancomycin');
  assert.equal(denyCustomRes.isFastPath, false, 'Deny must override custom specialist rule');
  assert.equal(denyCustomRes.reason, 'deny');

  // 3. Custom rule beats standard anchor
  const customSqlRouter = createPreRouter({
    customSpecialistRules: [
      { role: 'custom_data_lake', pattern: /\bSELECT\b/i }
    ]
  });
  const customSqlRes = customSqlRouter.classify('SELECT * FROM users');
  assert.equal(customSqlRes.isFastPath, true);
  assert.equal(customSqlRes.role, 'custom_data_lake');
  assert.equal(customSqlRes.reason, 'custom');

  // 4. Syntactic Anchor beats keywords
  const anchorPlusKeywordPrompt = 'Translate this document and calculate \\frac{15}{3} + \\sqrt{81}';
  const anchorBeatsKeyword = classifyPreRoute(anchorPlusKeywordPrompt, { preset: 'all' });
  assert.equal(anchorBeatsKeyword.isFastPath, true);
  assert.equal(anchorBeatsKeyword.role, 'factual_stem');
  assert.equal(anchorBeatsKeyword.reason, 'latex');
});

// 21. Message-Aware Scope (last_user turn vs all turns)
test('classifyPreRoute - message-aware scoping prevents tool noise from causing false positives', () => {
  // Conversation where user asks a casual question, but previous assistant/tool output had a stack trace and code fence
  const conversation = [
    { role: 'system', content: 'You are a helpful programming assistant.' },
    { role: 'user', content: 'Can you help me format this text?' },
    { role: 'assistant', content: '```python\ndef buggy(): pass\n```\nI tried but hit an internal error.' },
    { role: 'tool', content: 'Traceback (most recent call last):\nTypeError: Cannot read properties of undefined' },
    { role: 'user', content: 'No problem, what is the best Italian restaurant in town?' }
  ];

  // Under default 'last_user' scope, only the last user turn is evaluated -> Clean Miss!
  const scopedRes = classifyPreRoute(conversation);
  assert.equal(scopedRes.isFastPath, false, 'Tool stack trace must not pollute last user turn');
  assert.equal(scopedRes.role, undefined);
  assert.equal(scopedRes.reason, 'miss');

  // Under explicit 'all' scope, tool stack trace / code fence triggers code
  const allTurnRes = classifyPreRoute(conversation, { messageScope: 'all' });
  assert.equal(allTurnRes.isFastPath, true);
  assert.equal(allTurnRes.role, 'code');
});

// 22. Pluggable CacheAdapter Composition (Sync)
test('createPreRouter - pluggable CacheAdapter sync integration', () => {
  const storage = new Map();
  const customAdapter = {
    get: (key) => storage.get(key),
    set: (key, val) => { storage.set(key, val); },
    has: (key) => storage.has(key),
    clear: () => { storage.clear(); }
  };

  const router = createPreRouter({ adapter: customAdapter });
  const query = 'SELECT count(*) FROM orders;';

  const res1 = router.classify(query);
  assert.equal(res1.isFastPath, true);
  assert.equal(res1.role, 'code');

  // Verify stored in custom adapter
  assert.equal(storage.size, 1);

  // Verify retrieved from adapter
  const res2 = router.classify(query);
  assert.deepEqual(res1, res2);

  router.clearCache();
  assert.equal(storage.size, 0);
});

// 23. Pluggable CacheAdapter Composition (Async with classifyAsync)
test('createPreRouter - async CacheAdapter integration with classifyAsync', async () => {
  const remoteStore = new Map();
  let remoteGetCalls = 0;
  let remoteSetCalls = 0;

  const asyncRedisMock = {
    async get(key) {
      remoteGetCalls++;
      await new Promise(r => setTimeout(r, 2));
      return remoteStore.get(key);
    },
    async set(key, val) {
      remoteSetCalls++;
      await new Promise(r => setTimeout(r, 2));
      remoteStore.set(key, val);
    },
    async has(key) {
      return remoteStore.has(key);
    },
    async clear() {
      remoteStore.clear();
    }
  };

  const router = createPreRouter({ adapter: asyncRedisMock });
  const query = 'SELECT count(*) FROM orders;';

  // 1. First call to classifyAsync -> misses remote, runs cold classifier, sets remote
  const res1 = await router.classifyAsync(query);
  assert.equal(res1.isFastPath, true);
  assert.equal(res1.role, 'code');
  assert.equal(remoteGetCalls, 1);
  assert.equal(remoteSetCalls, 1);
  assert.equal(remoteStore.size, 1);

  // 2. Second call to classifyAsync -> hits in-memory LRU cache (0 remote calls!)
  const res2 = await router.classifyAsync(query);
  assert.deepEqual(res1, res2);
  assert.equal(remoteGetCalls, 1, 'In-process cache should serve 2nd call without hitting remote adapter');

  // 3. Clear in-process cache only, call classifyAsync -> hits remote adapter and re-hydrates in-process cache
  router.cache?.clear();
  const res3 = await router.classifyAsync(query);
  assert.deepEqual(res1, res3);
  assert.equal(remoteGetCalls, 2, 'Remote adapter hit after in-process eviction');
  assert.ok(router.cache?.has(query), 'In-process LRU cache should be re-hydrated after remote adapter hit');

  // 4. Synchronous classify does not hang on Promise, falls through safely
  const resSync = router.classify(query);
  assert.equal(resSync.isFastPath, true);

  // 5. Clear all
  await router.clearCache();
  assert.equal(remoteStore.size, 0);
  assert.equal(router.cache?.size, 0);
});

// 24. Worst-Case Bounded Regex Catalog Execution Budget (<2ms per pattern)
test('catalog - every pattern in catalog executes in < 2ms on worst-case 8KB adversarial input', () => {
  // Construct worst-case backtracking adversarial strings
  const evilWhitespace = 'a'.repeat(4000) + ' '.repeat(4000);
  const evilBackticks = '```'.repeat(2700);
  const evilUnclosedFence = '```python\n' + 'const a = 1;\n'.repeat(500);
  const evilBrackets = '{[('.repeat(1000) + '\n'.repeat(500);

  const adversarialInputs = [evilWhitespace, evilBackticks, evilUnclosedFence, evilBrackets];

  for (const rule of RULE_CATALOG) {
    const allPatterns = [
      ...rule.patterns,
      ...(rule.excludePatterns ?? []),
      ...(rule.conjunctions ? rule.conjunctions.flat() : [])
    ];
    for (const pattern of allPatterns) {
      for (const input of adversarialInputs) {
        const start = performance.now();
        pattern.test(input);
        const elapsed = performance.now() - start;
        assert.ok(
          elapsed < 2.0, 
          `Pattern ${pattern} in rule ${rule.id} exceeded 2ms budget on adversarial input (took ${elapsed.toFixed(3)}ms)`
        );
      }
    }
  }
});
