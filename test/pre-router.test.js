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
  pruneText,
  PreRouteCache,
  createPreRouter
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
    assert.equal(res.role, undefined, `Expected role to be undefined on miss for query "${query}"`);
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
  // Empty and whitespace queries default to 'open'
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

// 5. In-Memory LRU Cache & createPreRouter
test('PreRouteCache - LRU storage, whitespace normalization, and eviction', () => {
  const cache = new PreRouteCache({ maxSize: 2 });

  const res1 = classifyPreRoute('Write a Python function');
  const res2 = classifyPreRoute('Calculate 2 + 2');
  const res3 = classifyPreRoute('Translate hello to Spanish');

  cache.set('Write a Python function', res1);
  cache.set('Calculate 2 + 2', res2);

  assert.equal(cache.size, 2);
  assert.ok(cache.has('Write  a   Python   function')); // normalized whitespace matches
  assert.equal(cache.get('Write a Python function')?.role, 'code');

  // Adding 3rd item should evict 'Calculate 2 + 2' because 'Write a Python function' was refreshed by get()
  cache.set('Translate hello to Spanish', res3);
  assert.equal(cache.size, 2);
  assert.ok(cache.has('Write a Python function'));
  assert.ok(cache.has('Translate hello to Spanish'));
  assert.equal(cache.has('Calculate 2 + 2'), false);
});

test('createPreRouter - Stateful cached routing wrapper', () => {
  const router = createPreRouter({ cache: { maxSize: 10 } });
  assert.ok(router.cache);

  const q = 'Write a fast binary search in C++';
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
});

// 6. classifySpecialistRole Miss Behavior (No STEM fallback footgun)
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
  const q = 'Write a quicksort function in Go';

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

// 8. Message[] Role Differentiation in Cache Keys
test('PreRouteCache - Message[] role differentiation prevents cross-role cache collision', () => {
  const router = createPreRouter();

  const userMsg = [{ role: 'user', content: 'What is 2 + 2?' }];
  const assistantMsg = [{ role: 'assistant', content: 'What is 2 + 2?' }];

  const key1 = router.cache?.normalizeKey(userMsg);
  const key2 = router.cache?.normalizeKey(assistantMsg);

  assert.notEqual(key1, key2);
  assert.equal(key1, 'user:What is 2 + 2?');
  assert.equal(key2, 'assistant:What is 2 + 2?');
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

  assert.equal(keyA, '[tenant-alpha]What is the sum of 10 and 20?');
  assert.equal(keyB, '[tenant-beta]What is the sum of 10 and 20?');
  assert.equal(keyDefault, 'What is the sum of 10 and 20?');
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, keyDefault);

  // Cross-tenant router isolation test
  const routerA = createPreRouter({ namespace: 'profile-a' });
  const routerB = createPreRouter({ namespace: 'profile-b' });

  assert.equal(routerA.cache?.namespace, 'profile-a');
  assert.equal(routerB.cache?.namespace, 'profile-b');

  const q = 'Write a Python function';
  routerA.classify(q);
  assert.ok(routerA.cache?.has(q));
  // routerB should not have routerA's entry even though prompt is identical
  assert.equal(routerB.cache?.has(q), false);
});

// 10. Non-blocking Telemetry Hook (onRoute)
test('createPreRouter - onRoute non-blocking telemetry hook fires on hit and miss', () => {
  const events = [];
  const router = createPreRouter({
    namespace: 'audit-test',
    onRoute: (telemetry) => {
      events.push(telemetry);
    }
  });

  const query = 'Translate "bonjour" into English';

  // 1st call: Miss path from cache
  const res1 = router.classify(query);
  assert.equal(events.length, 1);
  assert.equal(events[0].fromCache, false);
  assert.equal(events[0].prompt, query);
  assert.equal(events[0].result.role, 'general_fast');
  assert.equal(events[0].namespace, 'audit-test');
  assert.ok(events[0].timestamp > 0);

  // 2nd call: Hit path from cache
  const res2 = router.classify(query);
  assert.equal(events.length, 2);
  assert.equal(events[1].fromCache, true);
  assert.equal(events[1].result.role, 'general_fast');
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

  // Routing should succeed cleanly despite error thrown inside onRoute
  assert.doesNotThrow(() => {
    const res = router.classify('Write a quicksort in Rust');
    assert.equal(res.role, 'code');
    assert.equal(res.isFastPath, true);
  });
});

// 12. Precision: Markdown Code Fence Tightening
test('classifyPreRoute - code fence requires language tag or code constructs to trigger code role', () => {
  // Untagged plain prose inside backticks must delegate to L2
  const plainProse = '```\nDear team,\nPlease review the minutes from our all-hands meeting.\n```';
  const proseRes = classifyPreRoute(plainProse);
  assert.equal(proseRes.isFastPath, false, 'Plain prose in backticks must not fast-path to code');
  assert.equal(proseRes.role, undefined);

  // Tagged code block routes to code
  const taggedCode = '```python\nx = 1\n```';
  const taggedRes = classifyPreRoute(taggedCode);
  assert.equal(taggedRes.isFastPath, true);
  assert.equal(taggedRes.role, 'code');

  // Untagged block with explicit code constructs routes to code
  const untaggedCode = '```\nfunction calculateTax(subtotal) {\n  return subtotal * 0.08;\n}\n```';
  const untaggedRes = classifyPreRoute(untaggedCode);
  assert.equal(untaggedRes.isFastPath, true);
  assert.equal(untaggedRes.role, 'code');
});

// 13. Precision: STEM Qualified Keyword Gating
test('classifyPreRoute - conversational probability and metaphorical DNA cleanly delegate to L2', () => {
  // Conversational probability must delegate to L2
  const weatherRes = classifyPreRoute('There is a high probability of heavy rain this afternoon.');
  assert.equal(weatherRes.isFastPath, false);
  assert.equal(weatherRes.role, undefined);

  // Mathematical probability routes to factual_stem
  const mathProbRes = classifyPreRoute('Calculate the probability of drawing three red aces from the deck.');
  assert.equal(mathProbRes.isFastPath, true);
  assert.equal(mathProbRes.role, 'factual_stem');

  // Metaphorical DNA must delegate to L2
  const metaphorDnaRes = classifyPreRoute('Collaboration and kindness are deeply woven into the DNA of our culture.');
  assert.equal(metaphorDnaRes.isFastPath, false);
  assert.equal(metaphorDnaRes.role, undefined);

  // Biological DNA routes to factual_stem
  const bioDnaRes = classifyPreRoute('Explain how CRISPR-Cas9 induces double-strand DNA breaks.');
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
  // Should NOT be factual_stem
  assert.notEqual(res.role, 'factual_stem', 'Non-STEM MCQ must not be dumped into factual_stem');

  const managementMCQ = `Which style of leadership is most effective for creative agencies?
A. Authoritarian
B. Democratic
C. Laissez-faire
D. Paternalistic`;
  const res2 = classifyPreRoute(managementMCQ);
  assert.equal(res2.isFastPath, false, 'Subjective management MCQ should delegate to L2');
  assert.equal(res2.role, undefined);
});

// 15. Safety: Large Payload Bounded Scanning
test('classifyPreRoute - large payloads (>10KB) evaluate safely without latency regression or ReDoS', () => {
  // Construct a 20KB payload of repetitive text with code instruction at top
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(400);
  const largePrompt = `Write a Python function to compute Fibonacci numbers.\n${filler}`;
  
  const start = performance.now();
  const res = classifyPreRoute(largePrompt);
  const elapsedMs = performance.now() - start;

  assert.equal(res.isFastPath, true);
  assert.equal(res.role, 'code');
  // Bounded scan must execute well under 5ms even on cold run
  assert.ok(elapsedMs < 5.0, `Expected elapsed time < 5ms, got ${elapsedMs}ms`);
});

// 16. Custom Domain Roles: Arbitrary string taxonomies via customSpecialistRules
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
  assert.equal(billingRes.confidence, 'high');

  const legalRes = router.classify('We received a gdpr deletion request from an EU resident.');
  assert.equal(legalRes.isFastPath, true);
  assert.equal(legalRes.role, 'compliance_legal');

  // Verify caching of custom roles
  const cachedBilling = router.classify('Please check the stripe invoice for customer 451.');
  assert.equal(cachedBilling.role, 'billing_ops');

  // Unmatched queries still cleanly delegate to L2 with undefined role
  const missRes = router.classify('Tell me a bedtime story about dragons.');
  assert.equal(missRes.isFastPath, false);
  assert.equal(missRes.role, undefined);
  assert.equal(missRes.suggestedAction, 'delegate_to_l2');
});

// 17. Code-over-Games Precedence, Tightened Chess/JSON/Fences, and Unified Complexity
test('classifyPreRoute - code-over-games precedence, tightened chess/JSON/fences, and unified complexity', () => {
  // 1. Code intent involving chess/PGN must route to code, not games_spatial
  const pythonPgn = classifyPreRoute('Write a Python script to parse a chess PGN and validate legal moves.');
  assert.equal(pythonPgn.isFastPath, true);
  assert.equal(pythonPgn.role, 'code');

  const cppEngine = classifyPreRoute('Implement a chess minimax engine in C++ with alpha-beta pruning.');
  assert.equal(cppEngine.isFastPath, true);
  assert.equal(cppEngine.role, 'code');

  // 2. Bare chess historical trivia must cleanly miss to L2
  const chessHistory = classifyPreRoute('Who was the world chess champion in 1972?');
  assert.equal(chessHistory.isFastPath, false);
  assert.equal(chessHistory.role, undefined);
  assert.equal(chessHistory.suggestedAction, 'delegate_to_l2');
  assert.equal(classifySpecialistRole('Who was the world chess champion in 1972?'), undefined);

  // Chess opening trivia must cleanly miss to L2
  const sicilianTrivia = classifyPreRoute('Who invented the Sicilian Defense?');
  assert.equal(sicilianTrivia.isFastPath, false);
  assert.equal(sicilianTrivia.role, undefined);
  assert.equal(sicilianTrivia.suggestedAction, 'delegate_to_l2');
  assert.equal(classifySpecialistRole('Who invented the Sicilian Defense?'), undefined);

  // 3. Discrete chess move notation routes to games_spatial
  const chessMoves = classifyPreRoute('1. e4 e5 2. Nf3 Nc6');
  assert.equal(chessMoves.isFastPath, true);
  assert.equal(chessMoves.role, 'games_spatial');

  // 4. Loose braces/quotes must not trigger JSON complexity inflation
  const notesText = 'In my notes {I wrote "todo"}';
  const notesScore = evaluateComplexityScore(notesText);
  assert.ok(notesScore < 0.15, `Casual braces should have near-zero complexity, got ${notesScore}`);
  assert.equal(isComplexPrompt(notesText), false);

  // Short markup alone must not trigger boolean complexity
  assert.equal(isComplexPrompt('<div>hello</div>'), false);

  // 5. Prose in markdown code fences must NOT route to code
  const markdownProse = classifyPreRoute('```markdown\n# Hello\nThis is pure prose documentation.\n```');
  assert.equal(markdownProse.role, undefined);
  assert.equal(markdownProse.isFastPath, false);
  assert.equal(classifySpecialistRole('```markdown\n# Hello\nThis is pure prose documentation.\n```'), undefined);

  // 6. Legitimate code fence routes to code
  const pythonFence = classifyPreRoute('```python\ndef foo():\n  pass\n```');
  assert.equal(pythonFence.isFastPath, true);
  assert.equal(pythonFence.role, 'code');
});

// 18. OOD Harvest Pipeline Verification
test('harvest:ood - Sample traffic log ingestion and stage-0 trap detection', async () => {
  const { execSync } = await import('node:child_process');
  const sampleLogPath = path.join(__dirname, 'fixtures', 'sample-traffic.jsonl');
  
  // Execute dry-run harvest
  const output = execSync(`node scripts/harvest-ood.js "${sampleLogPath}" --dry-run`, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.ok(output.includes('Krusch Pre-Router OOD Harvest Pipeline'));
  assert.ok(output.includes('Total Log Lines Parsed:    7'));
  assert.ok(output.includes('Dry-run complete. No changes were written.'));
});

// 19. Clinical Medicine & Pharmacology Safety (Strict L2 Delegation)
test('classifyPreRoute - clinical medicine, symptoms, and pharmacology strictly delegate to L2', () => {
  const clinicalQueries = [
    'A 45-year-old patient presents with sudden severe chest pain radiating to the left shoulder.',
    'What are the typical clinical symptoms and treatment options for Lyme disease?',
    'What are the main pharmacological differences between acetaminophen and ibuprofen?',
    'Prescribe antibiotics and recommend pediatric dosage for acute otitis media.',
    'Patient presents with high fever, neck stiffness, and photophobia.'
  ];

  for (const query of clinicalQueries) {
    const res = classifyPreRoute(query);
    assert.equal(res.isFastPath, false, `Clinical query "${query}" must NOT be fast-pathed`);
    assert.equal(res.role, undefined, `Clinical query "${query}" must have undefined role`);
    assert.equal(res.suggestedAction, 'delegate_to_l2', `Clinical query "${query}" must delegate to L2`);
    assert.equal(classifySpecialistRole(query), undefined, `classifySpecialistRole must return undefined for "${query}"`);
  }
});



