import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  classifySpecialistRole, 
  classifyPreRoute,
  detectKnowledgeBoundary, 
  evaluateComplexityScore 
} from '../dist/index.js';

// --- Holdout Prompt Dataset (100 Real-World, Template-Free Prompts) ---

const HOLDOUT_DATASET = [
  // --- 1. Code Generation, Debugging & Systems (25 prompts) ---
  { prompt: 'How do I implement a circular buffer in Rust using a fixed-size array?', expected: 'code' },
  { prompt: 'Can you write a TypeScript generic type that flattens deeply nested object keys into dot notation?', expected: 'code' },
  { prompt: 'Why is my React useEffect causing an infinite re-render loop with an object in the dependency array?', expected: 'code' },
  { prompt: 'Write a Python async generator that batches items from a Redis stream every 500ms.', expected: 'code' },
  { prompt: 'Here is my SQL query:\nSELECT u.id, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING COUNT(o.id) > 5;\nHow can I optimize this with an index?', expected: 'code' },
  { prompt: 'How to fix this error:\nTypeError: Cannot read properties of undefined (reading \'map\')\n  at UserList (components/UserList.tsx:24:18)', expected: 'code' },
  { prompt: 'Implement Dijkstra\'s shortest path algorithm in Go using container/heap.', expected: 'code' },
  { prompt: 'Refactor this callback hell into async/await with proper Promise.allSettled error handling.', expected: 'code' },
  { prompt: 'Write a bash script to rotate log files older than 7 days and compress them with gzip.', expected: 'code' },
  { prompt: '```python\ndef merge_intervals(intervals):\n    intervals.sort(key=lambda x: x[0])\n    merged = []\n    for interval in intervals:\n        if not merged or merged[-1][1] < interval[0]:\n            merged.append(interval)\n        else:\n            merged[-1][1] = max(merged[-1][1], interval[1])\n    return merged\n```\nWhat is the time complexity of this code?', expected: 'code' },
  { prompt: 'Write a unit test using vitest to test a debounced search input component.', expected: 'code' },
  { prompt: 'How do I configure a multi-stage Dockerfile for a Next.js standalone build?', expected: 'code' },
  { prompt: 'Write a regex pattern that matches valid semantic versioning (SemVer) strings.', expected: 'code' },
  { prompt: 'Explain the difference between Arc<Mutex<T>> and RwLock<T> in concurrent Rust.', expected: 'code' },
  { prompt: 'Fix this Python stack trace:\nTraceback (most recent call last):\n  File "app.py", line 12, in <module>\n    import httpx\nModuleNotFoundError: No module named \'httpx\'', expected: 'code' },
  { prompt: 'Create a custom CSS flexbox layout that wraps cards with equal height and centered alignment.', expected: 'code' },
  { prompt: 'How do I mock a private function in Jest when testing a legacy CommonJS module?', expected: 'code' },
  { prompt: 'Implement a rate limiter middleware in Express using the token bucket algorithm.', expected: 'code' },
  { prompt: 'Write an SQL migration script in PostgreSQL to add a UUID primary key with gen_random_uuid().', expected: 'code' },
  { prompt: 'In C++, why does std::vector::push_back invalidate existing iterators when capacity is exceeded?', expected: 'code' },
  { prompt: 'Write a Python script using pandas to join two large CSV files on customer_id and calculate rolling 30-day spend.', expected: 'code' },
  { prompt: 'Debug this GraphQL resolver: it throws "Cannot return null for non-nullable field User.email".', expected: 'code' },
  { prompt: 'Implement an LRU Cache class in TypeScript with get(key) and put(key, value) in O(1) time.', expected: 'code' },
  { prompt: 'How can I prevent memory leaks when using event emitters in a Node.js worker thread?', expected: 'code' },
  { prompt: 'Write a GitHub Actions workflow that runs linter, executes tests, and builds a Docker image on pull request.', expected: 'code' },

  // --- 2. Factual STEM, Mathematics & Science (20 prompts) ---
  { prompt: 'What is the eigenvalues and eigenvectors of the matrix [[2, 1], [1, 2]]?', expected: 'factual_stem' },
  { prompt: 'Calculate the derivative of f(x) = x^3 * e^(2x) with respect to x.', expected: 'factual_stem' },
  { prompt: 'Explain the mechanism of ATP synthesis via oxidative phosphorylation across the inner mitochondrial membrane.', expected: 'factual_stem' },
  { prompt: 'A 5kg block rests on an incline of 30 degrees with a coefficient of friction of 0.2. What is its acceleration down the plane?', expected: 'factual_stem' },
  { prompt: 'What is the difference between a SN1 and SN2 reaction mechanism in organic chemistry?', expected: 'factual_stem' },
  { prompt: 'Solve the system of linear equations:\n3x + 2y = 12\nx - 4y = -10', expected: 'factual_stem' },
  { prompt: 'Explain how CRISPR-Cas9 utilizes guide RNA to induce double-strand DNA breaks.', expected: 'factual_stem' },
  { prompt: 'What is Heisenberg\'s uncertainty principle and what are its physical implications for electron orbitals?', expected: 'factual_stem' },
  { prompt: 'Calculate the probability of getting at least two 6s when rolling 5 fair six-sided dice.', expected: 'factual_stem' },
  { prompt: 'What causes gravitational wave emission during binary black hole mergers?', expected: 'factual_stem' },
  { prompt: 'Explain the role of mycorrhizal fungi in terrestrial nitrogen and phosphorus cycles.', expected: 'factual_stem' },
  { prompt: 'Derive the Navier-Stokes continuity equation for incompressible fluid flow.', expected: 'factual_stem' },
  { prompt: 'What is the Henderson-Hasselbalch equation and how is it used to prepare buffer solutions?', expected: 'factual_stem' },
  { prompt: 'Solve the integral of x * sin(x) dx from 0 to pi.', expected: 'factual_stem' },
  { prompt: 'Explain the difference between mitosis and meiosis in eukaryotic cell division.', expected: 'factual_stem' },
  { prompt: 'What is the Stefan-Boltzmann law and how does blackbody radiation scale with temperature?', expected: 'factual_stem' },
  { prompt: 'Explain how transformer models utilize self-attention mechanisms mathematically.', expected: 'factual_stem' },
  { prompt: 'What is the speed of sound in air at 20 degrees Celsius and standard atmospheric pressure?', expected: 'factual_stem' },
  { prompt: 'Why is liquid water denser at 4 degrees Celsius than at its freezing point of 0 degrees Celsius?', expected: 'factual_stem' },
  { prompt: 'What is the cosmological constant in Einstein\'s field equations and why is it associated with dark energy?', expected: 'factual_stem' },

  // --- 3. Deep Reasoning, Financial Valuation & Formal Logic (15 prompts) ---
  { prompt: 'Analyze this company\'s balance sheet: Net income rose 12% to $45M, but operating cash flow dropped from $60M to $15M due to inventory build. What does this divergence signal?', expected: 'reasoning_deep' },
  { prompt: 'Explain how to construct a discounted cash flow (DCF) model, including WACC calculation and terminal value estimation.', expected: 'reasoning_deep' },
  { prompt: 'Provide a formal mathematical proof by contradiction that the square root of 2 is irrational.', expected: 'reasoning_deep' },
  { prompt: 'Calculate the diluted EPS for a firm with $100M net income, 50M basic shares, and 5M stock options at a strike of $20 with average stock price of $40.', expected: 'reasoning_deep' },
  { prompt: 'Analyze the Nash equilibrium in a repeated Prisoner\'s Dilemma under grim trigger vs tit-for-tat strategies.', expected: 'reasoning_deep' },
  { prompt: 'What are the balance sheet and cash flow statement implications of capitalizing versus expensing R&D investments under US GAAP?', expected: 'reasoning_deep' },
  { prompt: 'Evaluate whether an enterprise with EBITDA of $25M and net debt of $100M is at risk of covenant breach if leverage covenants are capped at 4.5x.', expected: 'reasoning_deep' },
  { prompt: 'Construct a formal deductive logic proof showing that ((P -> Q) & (Q -> R)) implies (P -> R).', expected: 'reasoning_deep' },
  { prompt: 'How does changes in working capital impact free cash flow to firm (FCFF) vs free cash flow to equity (FCFE)?', expected: 'reasoning_deep' },
  { prompt: 'Explain Pareto optimality in welfare economics and why a competitive market achieves Pareto efficiency under the First Fundamental Theorem.', expected: 'reasoning_deep' },
  { prompt: 'Analyze the impact of a debt-financed stock repurchase on return on equity (ROE) and earnings per share (EPS).', expected: 'reasoning_deep' },
  { prompt: 'Conduct a counterfactual analysis: What would be the macroeconomic consequences if the Federal Reserve had not instituted quantitative easing in 2008?', expected: 'reasoning_deep' },
  { prompt: 'Explain the difference between operating margin and gross margin, and how inflationary pressure disproportionately affects each.', expected: 'reasoning_deep' },
  { prompt: 'Analyze the game theory dynamics of OPEC quota compliance when marginal production costs vary widely among members.', expected: 'reasoning_deep' },
  { prompt: 'In a 10-K SEC filing, how do you verify whether reported revenue growth was driven by volume increases or price hikes?', expected: 'reasoning_deep' },

  // --- 4. Reading Comprehension & Text Verification (15 prompts) ---
  { prompt: 'According to the article provided above, what were the two primary factors that led to the decline of the Byzantine empire\'s fiscal revenue?', expected: 'comprehension_rc' },
  { prompt: 'Based on the passage, does the author support or reject the proposed carbon taxation policy? Cite specific sentences.', expected: 'comprehension_rc' },
  { prompt: 'Summarize the excerpt regarding the treaty negotiations in no more than three bullet points.', expected: 'comprehension_rc' },
  { prompt: 'In the text above, what does the author imply when describing the architect as "reluctant to embrace modern glass monoliths"?', expected: 'comprehension_rc' },
  { prompt: 'Based on the context of the clinical trial summary, how many patients experienced adverse reactions in the treatment group compared to the placebo control?', expected: 'comprehension_rc' },
  { prompt: 'What is the main thesis of the author in the provided text regarding the role of public libraries in digital literacy?', expected: 'comprehension_rc' },
  { prompt: 'According to the document, what are the three criteria required for an applicant to qualify for the research grant?', expected: 'comprehension_rc' },
  { prompt: 'Evaluate if the given statement is consistent with the information provided in the preceding case study.', expected: 'comprehension_rc' },
  { prompt: 'From the excerpt above, identify the key disagreement between the defense counsel and the prosecuting attorney.', expected: 'comprehension_rc' },
  { prompt: 'Based on this historical account, what immediate strategic goal did the general hope to achieve by crossing the river at dawn?', expected: 'comprehension_rc' },
  { prompt: 'Summarize the author\'s argument regarding algorithmic bias in automated hiring platforms based on the text.', expected: 'comprehension_rc' },
  { prompt: 'According to the passage, why did the scientists conclude that the subterranean aquifer was formed during the Pleistocene epoch?', expected: 'comprehension_rc' },
  { prompt: 'What does the author suggest was the primary unintended consequence of the industrial deregulation bill described in the article?', expected: 'comprehension_rc' },
  { prompt: 'In paragraph 3 of the text, what metaphor does the narrator use to describe the winter morning in Prague?', expected: 'comprehension_rc' },
  { prompt: 'Based on the document provided, is it true or false that the company achieved carbon neutrality by 2024?', expected: 'comprehension_rc' },

  // --- 5. General Fast, Translation, Medicine & Geography (15 prompts) ---
  { prompt: 'Translate this paragraph from English into Spanish: "The sun was rising over the misty hills as the expedition departed."', expected: 'general_fast' },
  { prompt: 'How do you say "Where is the nearest train station?" in Japanese?', expected: 'general_fast' },
  { prompt: 'Translate into German: "We need to finalize the quarterly review before the board meeting on Friday."', expected: 'general_fast' },
  { prompt: 'What is the capital of Mongolia and what is its average elevation above sea level?', expected: 'general_fast' },
  { prompt: 'A 45-year-old patient presents with sudden severe chest pain radiating to the left shoulder and shortness of breath. What clinical conditions must be ruled out immediately?', expected: 'general_fast' },
  { prompt: 'Name the countries that border Switzerland and describe its primary mountain ranges.', expected: 'general_fast' },
  { prompt: 'Write a short haiku about autumn leaves falling in Kyoto.', expected: 'general_fast' },
  { prompt: 'Please proofread and correct the grammar of this introductory email: "Dear Mr Smith, I hope this email finds you well. Me and my team has reviewed the proposal."', expected: 'general_fast' },
  { prompt: 'What are the typical clinical symptoms and treatment options for Lyme disease?', expected: 'general_fast' },
  { prompt: 'Who was the primary architect behind the design of St. Peter\'s Basilica in Rome?', expected: 'general_fast' },
  { prompt: 'Translate this French sentence into English: "Il vaut mieux prévenir que guérir."', expected: 'general_fast' },
  { prompt: 'Write an opening dialogue between two astronauts waking up from cryosleep near Saturn.', expected: 'general_fast' },
  { prompt: 'What are the main pharmacological differences between acetaminophen and ibuprofen?', expected: 'general_fast' },
  { prompt: 'Identify the geographical coordinates and highest elevation of Mount Kilimanjaro.', expected: 'general_fast' },
  { prompt: 'Does sentence A imply sentence B? Sentence A: "Alice visited Paris in June." Sentence B: "Alice has been to France."', expected: 'general_fast' },

  // --- 6. Chess & Spatial Board Games (10 prompts) ---
  { prompt: 'What is the recommended chess move for White after 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6?', expected: 'games_spatial' },
  { prompt: 'Given the chess FEN string "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", what are the legal pawn moves?', expected: 'games_spatial' },
  { prompt: 'Explain the difference between stalemate and checkmate in a chess game.', expected: 'games_spatial' },
  { prompt: 'In chess, what are the conditions required for White to perform castling queenside (O-O-O)?', expected: 'games_spatial' },
  { prompt: 'Evaluate this chess board position: White has Queen on d1 and Rook on e1, Black has King on e8 with no escape square.', expected: 'games_spatial' },
  { prompt: 'How does the en passant pawn capture rule work in international chess tournament rules?', expected: 'games_spatial' },
  { prompt: 'In the Italian Game (1. e4 e5 2. Nf3 Nc6 3. Bc4), what are Black\'s two main responses?', expected: 'games_spatial' },
  { prompt: 'What is a Zugzwang position in a chess endgame?', expected: 'games_spatial' },
  { prompt: 'In chess notation, what does the sequence 1. d4 d5 2. c4 e6 represent?', expected: 'games_spatial' },
  { prompt: 'Can a king move into check during a chess game under FIDE regulations?', expected: 'games_spatial' }
];

// --- Tests ---

test('Holdout Evaluation - 100+ Template-Free Prompts Domain Accuracy', () => {
  let correct = 0;
  const misclassified = [];
  const domainStats = {};

  // Warm-up pass to trigger V8 JIT compilation of regex patterns
  for (const item of HOLDOUT_DATASET) {
    classifySpecialistRole(item.prompt);
  }

  const startTime = performance.now();

  for (const item of HOLDOUT_DATASET) {
    const predicted = classifySpecialistRole(item.prompt);
    
    if (!domainStats[item.expected]) {
      domainStats[item.expected] = { total: 0, correct: 0 };
    }
    domainStats[item.expected].total++;

    if (predicted === item.expected) {
      correct++;
      domainStats[item.expected].correct++;
    } else {
      misclassified.push({
        prompt: item.prompt.slice(0, 60) + '...',
        expected: item.expected,
        predicted
      });
    }
  }

  const elapsedMs = performance.now() - startTime;
  const avgUsPerPrompt = (elapsedMs / HOLDOUT_DATASET.length) * 1000;
  const accuracy = (correct / HOLDOUT_DATASET.length) * 100;

  console.log(`\n========================================`);
  console.log(`🎯 Holdout Prompt Evaluation Results`);
  console.log(`========================================`);
  console.log(`Total Prompts Evaluated: ${HOLDOUT_DATASET.length}`);
  console.log(`Overall Accuracy:        ${accuracy.toFixed(2)}% (${correct}/${HOLDOUT_DATASET.length})`);
  console.log(`Average Latency:         ${avgUsPerPrompt.toFixed(2)} µs / prompt`);
  console.log(`\n--- Per-Domain Performance ---`);
  for (const [domain, stats] of Object.entries(domainStats)) {
    const pct = ((stats.correct / stats.total) * 100).toFixed(1);
    console.log(`• ${domain.padEnd(18)}: ${pct}% (${stats.correct}/${stats.total})`);
  }
  if (misclassified.length > 0) {
    console.log(`\n--- Misclassifications (${misclassified.length}) ---`);
    for (const m of misclassified) {
      console.log(`  [Expected: ${m.expected}, Got: ${m.predicted}] "${m.prompt}"`);
    }
  }
  console.log(`========================================\n`);

  // Assertions: Zero-template accuracy must exceed 90% and latency must be sub-millisecond (< 500 µs)
  assert.ok(accuracy >= 90.0, `Holdout classification accuracy must be >= 90% (got ${accuracy.toFixed(2)}%)`);
  assert.ok(avgUsPerPrompt < 500, `Average classification latency must be < 500 µs (got ${avgUsPerPrompt.toFixed(2)} µs)`);
});

test('Holdout Evaluation - Conversational Wrapper Invariance', () => {
  const wrappers = [
    (p) => `Hey! Could you please help me with this? ${p} Thanks in advance!`,
    (p) => `Hi assistant, quick question: ${p}`,
    (p) => `Please look at this: ${p}\nLet me know what you think!`
  ];

  let totalWrapped = 0;
  let correctWrapped = 0;

  for (const item of HOLDOUT_DATASET.slice(0, 30)) { // Sample across diverse prompts
    for (const wrap of wrappers) {
      const wrappedPrompt = wrap(item.prompt);
      const predicted = classifySpecialistRole(wrappedPrompt, { prunePreRouting: true });
      totalWrapped++;
      if (predicted === item.expected) {
        correctWrapped++;
      }
    }
  }

  const wrapperAccuracy = (correctWrapped / totalWrapped) * 100;
  console.log(`Conversational Noise Invariance: ${wrapperAccuracy.toFixed(2)}% (${correctWrapped}/${totalWrapped})`);
  assert.ok(wrapperAccuracy >= 88.0, `Noise-wrapped accuracy must be >= 88% (got ${wrapperAccuracy.toFixed(2)}%)`);
});

test('Holdout Evaluation - Knowledge Boundary Gating on Closed-World Tasks', () => {
  const closedWorldQueries = [
    'What is 15 * 42 + 18?',
    'Convert 75 degrees Fahrenheit to Celsius',
    'Translate "hello friend" into Spanish',
    'Prettify this JSON string: {"name":"John","age":30}',
    'What is the regular expression for matching phone numbers?',
    'Convert 150 miles to km',
    'Solve 24 / 3 + 7 - 2',
    'What is the synonym for industrious?'
  ];

  for (const query of closedWorldQueries) {
    const boundary = detectKnowledgeBoundary(query);
    assert.equal(boundary, 'closed', `Query "${query}" should be classified as closed-world`);
    
    const complexity = evaluateComplexityScore(query);
    assert.ok(complexity <= 0.35, `Closed-world query "${query}" should have low complexity (got ${complexity})`);
  }
});

test('L1 Pre-Router - classifyPreRoute Fast-Path vs L2 Delegation', () => {
  // Fast-Path queries (code, math, translation, chess, comprehension)
  const fastPathSamples = [
    { query: 'Write a Python function to compute the Fibonacci sequence using memoization.', expectedRole: 'code' },
    { query: 'Calculate \\frac{5}{8} + \\sqrt{64} and solve the resulting quadratic equation.', expectedRole: 'factual_stem' },
    { query: 'Translate "Good morning, hope you have a productive day" into German.', expectedRole: 'general_fast' },
    { query: 'White to move: 1. e4 e5 2. Nf3 Nc6 3. Bb5. Is this the Ruy Lopez opening?', expectedRole: 'games_spatial' },
    { query: 'Based on the provided passage, what was the primary thesis of the author?', expectedRole: 'comprehension_rc' },
    { query: 'Analyze the 10-K balance sheet and calculate the diluted EPS and EBITDA.', expectedRole: 'reasoning_deep' },
    { query: 'Convert 120 km to miles.', expectedRole: 'general_fast' }
  ];

  for (const item of fastPathSamples) {
    const res = classifyPreRoute(item.query);
    assert.equal(res.isFastPath, true, `Expected query "${item.query}" to be Fast-Path`);
    assert.equal(res.role, item.expectedRole, `Expected role ${item.expectedRole} for query "${item.query}"`);
    assert.equal(res.confidence, 'high', `Expected high confidence for query "${item.query}"`);
    assert.equal(res.suggestedAction, 'dispatch_specialist', `Expected dispatch_specialist for query "${item.query}"`);
  }

  // Unstructured / Conversational queries requiring L2 delegation
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

