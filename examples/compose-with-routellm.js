/**
 * End-to-End Composition Recipe: krusch-pre-router (Stage 0) + RouteLLM (Stage 1)
 *
 * This example demonstrates:
 * 1. Using createPreRouter as a microsecond syntactic front-gate (<10µs, $0.00).
 * 2. Instant fast-path dispatch for unambiguous syntax (SQL, code, LaTeX, translations).
 * 3. Delegating unstructured / conversational / clinical queries to RouteLLM (L2) only on gate misses.
 * 4. Non-blocking onRoute telemetry streaming directly to an audit log file (examples/traffic-audit.jsonl).
 * 5. Feeding real audit traffic into the OOD harvest loop: npm run harvest:ood.
 *
 * Run with:
 *   npm run example:routellm
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createPreRouter } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIT_LOG_PATH = path.join(__dirname, 'traffic-audit.jsonl');

// Clear existing audit log for clean demo run
if (fs.existsSync(AUDIT_LOG_PATH)) {
  fs.unlinkSync(AUDIT_LOG_PATH);
}

// 1. Initialize Stage-0 Pre-Router with in-memory LRU memoization and telemetry
const preRouter = createPreRouter({
  cache: { maxSize: 500, namespace: 'production-gateway' },
  // Non-blocking telemetry tap: writes directly to JSONL audit stream
  onRoute: ({ prompt, result, fromCache, namespace, timestamp }) => {
    const record = JSON.stringify({
      timestamp: new Date(timestamp).toISOString(),
      namespace,
      fromCache,
      isFastPath: result.isFastPath,
      role: result.role,
      suggestedAction: result.suggestedAction,
      confidence: result.confidence,
      complexityScore: Number(result.complexityScore.toFixed(3)),
      prompt: typeof prompt === 'string' ? prompt : prompt.map(m => m.content).join('\n')
    });
    fs.appendFileSync(AUDIT_LOG_PATH, record + '\n', 'utf8');
  }
});

// 2. Simulated Downstream Handlers (Specialists vs RouteLLM Neural Gateway)

/**
 * Direct specialist invocation (bypasses vectorization, embeddings, and router fees)
 */
async function callSpecialist(role, prompt) {
  // Map Stage-0 archetypes to your preferred cost-effective specialist model
  const specialistMap = {
    code: 'qwen/qwen-2.5-coder-32b-instruct',
    factual_stem: 'deepseek/deepseek-chat',
    comprehension_rc: 'google/gemini-2.5-flash',
    games_spatial: 'meta-llama/llama-3.3-70b-instruct',
    general_fast: 'anthropic/claude-3-5-haiku',
    reasoning_deep: 'deepseek/deepseek-r1'
  };
  const model = specialistMap[role] || 'general-specialist';
  return {
    source: 'stage_0_fast_path',
    model,
    role,
    cost: '$0.00 router tax'
  };
}

/**
 * Simulated Stage-1 Neural Router (RouteLLM / NotDiamond / Vector MLP)
 * Only called on Stage-0 miss (isFastPath: false, role: undefined).
 */
async function callRouteLLM(prompt) {
  // Simulating neural embedding lookup + threshold routing (15ms - 40ms)
  await new Promise(resolve => setTimeout(resolve, 15));

  const isComplex = prompt.length > 120 || /\b(?:macroeconomic|ethical|triage|protocol)\b/i.test(prompt);
  const selectedModel = isComplex 
    ? 'anthropic/claude-3-7-sonnet' 
    : 'openai/gpt-4o-mini';

  return {
    source: 'stage_1_routellm',
    model: selectedModel,
    cost: '~$0.0001 router tax (embeddings + MLP)'
  };
}

// 3. Unified Gateway Handler
async function handleIncomingRequest(prompt) {
  const start = performance.now();

  // Stage 0: In-process syntactic gate & LRU memo table
  const preRoute = preRouter.classify(prompt);
  const stage0DurationUs = ((performance.now() - start) * 1000).toFixed(1);

  if (preRoute.isFastPath) {
    // ⚡ Fast-path hit: bypass RouteLLM completely!
    const dispatch = await callSpecialist(preRoute.role, prompt);
    return {
      prompt,
      gateAction: 'FAST_PATH_DISPATCH',
      stage0Us: stage0DurationUs,
      resolvedModel: dispatch.model,
      role: preRoute.role,
      confidence: preRoute.confidence,
      source: dispatch.source,
      routerTax: dispatch.cost
    };
  }

  // 🔍 Stage-0 miss: Clean pass-through to RouteLLM / L2
  const routeLLMRes = await callRouteLLM(prompt);
  const totalDurationMs = (performance.now() - start).toFixed(1);

  return {
    prompt,
    gateAction: 'DELEGATE_TO_L2',
    stage0Us: stage0DurationUs,
    totalDurationMs: `${totalDurationMs}ms`,
    resolvedModel: routeLLMRes.model,
    role: 'unassigned (l2 handled)',
    confidence: preRoute.confidence,
    source: routeLLMRes.source,
    routerTax: routeLLMRes.cost
  };
}

// 4. Run Sample Workload
async function run() {
  console.log('='.repeat(80));
  console.log('🚀 krusch-pre-router + RouteLLM Composition Pipeline Demo');
  console.log('='.repeat(80));

  const prompts = [
    // 1. High-confidence code syntax -> Stage 0 Fast-Path
    'SELECT u.id, u.email, count(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > NOW() - INTERVAL \'30 days\' GROUP BY u.id, u.email;',
    
    // 2. Fenced Python code -> Stage 0 Fast-Path
    '```python\ndef quicksort(arr):\n    if len(arr) <= 1: return arr\n    pivot = arr[len(arr) // 2]\n    return quicksort([x for x in arr if x < pivot]) + [x for x in arr if x == pivot] + quicksort([x for x in arr if x > pivot])\n```\nExplain time complexity.',

    // 3. LaTeX mathematics -> Stage 0 Fast-Path
    'Calculate the definite integral: \\int_{0}^{\\pi} \\sin(x) \\, dx and verify with the fundamental theorem of calculus.',

    // 4. Natural language translation -> Stage 0 Fast-Path
    'Translate this customer notification into French: "Your delivery is scheduled for tomorrow between 9am and 1pm."',

    // 5. Clinical medical query -> Stage 0 MISS (strictly delegates to L2)
    'A 52-year-old patient presents with acute crushing substernal chest pain and diaphoresis. Outline emergency triage protocol.',

    // 6. Conversational / subjective debate -> Stage 0 MISS (delegates to RouteLLM)
    'What are the macroeconomic trade-offs between quantitative easing and targeted fiscal stimulus during stagflation?',

    // 7. General management advice -> Stage 0 MISS (delegates to RouteLLM)
    'How should an engineering manager handle a performance review with an underperforming senior engineer?',

    // 8. EXACT REPEAT of Prompt #1 -> Stage 0 LRU MEMO HIT (~1.5µs!)
    'SELECT u.id, u.email, count(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > NOW() - INTERVAL \'30 days\' GROUP BY u.id, u.email;'
  ];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const res = await handleIncomingRequest(prompt);
    const label = i === 7 ? 'PROMPT #8 (REPEAT PROMPT #1 - LRU HIT)' : `PROMPT #${i + 1}`;

    console.log(`\n[${label}]`);
    console.log(`  Input:        "${prompt.slice(0, 68)}${prompt.length > 68 ? '...' : ''}"`);
    console.log(`  Stage 0 Gate: ${res.gateAction} in ${res.stage0Us} µs`);
    console.log(`  Target Layer: ${res.source}`);
    console.log(`  Final Model:  ${res.resolvedModel}`);
    console.log(`  Router Cost:  ${res.routerTax}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 Audit Telemetry Stream Written: ${AUDIT_LOG_PATH}`);
  console.log(`   Lines Logged: ${fs.readFileSync(AUDIT_LOG_PATH, 'utf8').trim().split('\n').length}`);
  console.log('='.repeat(80));
  console.log('\n💡 You can now feed this real traffic log directly into the OOD harvest loop:');
  console.log(`   npm run harvest:ood -- "${AUDIT_LOG_PATH}" --dry-run\n`);
}

run().catch(console.error);
