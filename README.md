<p align="center">
  <img src="https://raw.githubusercontent.com/kruschdev/krusch-cascade-router/main/docs/assets/banner.png" alt="Krusch Pre-Router" width="800" />
</p>

<p align="center">
  <strong>Deterministic Regex Pre-Router & In-Memory Memoization Table for LLM Swarms.</strong><br>
  <span>Zero dependencies. &lt;20KB bundle size. Microsecond CPU classification & LRU memoization. $0.00 routing tax.</span>
</p>

<p align="center">
  <a href="https://github.com/kruschdev/krusch-pre-router/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kruschdev/krusch-pre-router.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/classification%20p50-6.5%C2%B5s-blue.svg?style=flat-square" alt="Classification p50 6.5us">
  <img src="https://img.shields.io/badge/memo%20hit%20p50-1.5%C2%B5s-brightgreen.svg?style=flat-square" alt="LRU Memo Hit p50 1.5us">
  <img src="https://img.shields.io/badge/cost-%240.00-purple.svg?style=flat-square" alt="Zero Routing Cost">
</p>

---

## ⚡ Architecture: Stage-0 Pre-Router Gate

### **"Don't spend a model call just to pick a model. Check Stage 0 first."**

In multi-model AI swarms, querying an embedding model or LLM just to decide whether an obvious Python function, SQL query, LaTeX equation, or JSON transform belongs to a code or math specialist introduces unnecessary latency and cost:
* **The Neural Routing Tax**: Neural routers (e.g. RouteLLM, NotDiamond) typically introduce **15ms–50ms of vectorization and MLP overhead**, while LLM-as-a-router introduces **300ms–1,200ms TTFT** plus prompt token billing.
* **The Stage-0 Architecture**: `krusch-pre-router` provides a zero-dependency **deterministic regex classifier + optional in-memory LRU memo table**:
  1. **LRU Memo Table**: O(1) in-memory lookup (~1.5µs p50) with defensive cloning for repeated prompts, identical evaluations, and agent retry loops (exact string keys after whitespace normalization).
  2. **Deterministic Regex Stack**: Cold CPU keyword and syntax analysis (~6.5µs p50) for unseen prompts.
  3. **Explicit Miss Delegation**: Unstructured conversational chat cleanly passes through (`isFastPath: false`, `role: undefined`) to your Stage-1 neural router or frontier model.

```
                  ┌───────────────────────────────┐
                  │        Incoming Prompt        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  Stage 0: Pre-Router Gate (krusch-pre-router)          │
      │  LRU Memo Table Hit:  ~ 1.5 µs (Map get + clone)       │
      │  Cold Regex Stack:    ~ 6.5 µs (CPU string analysis)   │
      │  Cost:                $0.00 (0 tokens, 0 network hops) │
      └───────┬────────────────────────────────────────┬───────┘
              │                                        │
    High-Confidence Fast-Path                Gate Miss / Unstructured
    (Code, SQL, LaTeX, Math, JSON)           (General Chat, Nuanced Semantics)
    isFastPath: true                         isFastPath: false (role: undefined)
              │                                        │
              ▼                                        ▼
    ┌───────────────────┐                 ┌─────────────────────────┐
    │ Direct Specialist │                 │  Stage 1: L2 Classifier │
    │ (e.g. Qwen-Coder, │                 │  (RouteLLM, NotDiamond, │
    │  DeepSeek-Flash)  │                 │   Vector Embedding MLP) │
    └───────────────────┘                 └────────────┬────────────┘
                                                       │
                                                       ▼
                                          ┌─────────────────────────┐
                                          │     Frontier Route      │
                                          └─────────────────────────┘
```

---

## 📦 Installation

Install directly from GitHub:

```bash
npm install github:kruschdev/krusch-pre-router
```

Or from local checkout:
```bash
npm install ../path/to/krusch-pre-router
```

> **Requirements**: Zero runtime dependencies. ESM and CommonJS exports with full TypeScript definitions (`.d.ts`). Compatible with Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, and modern browsers.

---

## 🚀 Usage

### 1. Stateful Pre-Router with In-Memory LRU Memo Table (Recommended)

`createPreRouter()` wraps heuristic evaluation with an optional in-memory LRU memoization table (useful for agent retry loops and identical prompt repeats; keys are literal whitespace-normalized strings, not parameterized variable template abstractions):

```javascript
import { createPreRouter } from 'krusch-pre-router';

// Create pre-router instance (LRU memo table size defaults to 1,000 entries)
const router = createPreRouter({
  cache: { maxSize: 2000 }
});

async function handlePrompt(prompt) {
  // Checks LRU memo table (~1.5µs), evaluates cold heuristics on miss (~6.5µs)
  const route = router.classify(prompt);

  if (route.isFastPath) {
    // ⚡ Direct specialist dispatch
    console.log(`Fast-Path Hit! Role: ${route.role} (confidence: ${route.confidence})`);
    return callSpecialist(route.role, prompt);
  }

  // 🔍 Pass through to L2 / Frontier
  console.log('Stage-0 Miss -> Passing to L2 Neural Router or Frontier Model');
  return callFrontier(prompt);
}
```

### 2. Stateless Heuristic Evaluation

```javascript
import { classifyPreRoute } from 'krusch-pre-router';

const route = classifyPreRoute('Write a Python function to compute Fibonacci numbers.');
// {
//   isFastPath: true,
//   role: 'code',
//   confidence: 'high',
//   complexityScore: 0.15,
//   suggestedAction: 'dispatch_specialist'
// }

const chat = classifyPreRoute('How are you feeling today?');
// {
//   isFastPath: false,
//   role: undefined,
//   confidence: 'unstructured',
//   complexityScore: 0.0,
//   suggestedAction: 'delegate_to_l2'
// }
```

### 3. Custom Domain Rules

Adapt the pre-router to your application's domain with custom regex overrides:

```javascript
const router = createPreRouter({
  customSpecialistRules: [
    // Fast-path internal billing/finance queries directly to your billing specialist
    { role: 'billing_ops', pattern: /\b(?:stripe invoice|chargeback|mrr|arr)\b/i },
    // Route customer support ticket tags directly to support triage
    { role: 'support_triage', pattern: /\b(?:ticket #\d+|support refund|account password)\b/i }
  ]
});
```

---

## 📊 Benchmark Results

Reproduce anytime locally with:
```bash
npm run bench
```

Benchmarked on **Intel Core i7-5820K (12 cores @ 3.30GHz), 32GB RAM, Linux x86_64, Node.js v22.23.2** (10,000 iterations):

| Stage | Scope | Average | Min | p50 | p90 | p99 | Throughput |
|---|---|---|---|---|---|---|---|
| **Warm LRU Memo Hit** (`router.classify`) | In-memory Map lookup + defensive copy for repeated templates | **1.60 µs** | 0.75 µs | **1.46 µs** | 1.92 µs | 3.78 µs | **~583,000 ops/sec** |
| **Cold Regex Heuristic** (`classifyPreRoute`) | Full CPU regex stack evaluation on unseen prompts | **8.38 µs** | 1.30 µs | **6.55 µs** | 14.56 µs | 23.81 µs | **~116,000 ops/sec** |

> **Note**: Latencies measure **local CPU classification and lookup overhead**. They do not represent end-to-end model dispatch latency, which is dominated by downstream inference (100ms–2,000ms).

---

## 🎯 When to Use (and When NOT to Use)

`krusch-pre-router` is an **opinionated Stage-0 syntactic gate**, not a semantic intelligence layer.

### ✅ When to Use
* **In front of neural routers**: Place it directly before RouteLLM, NotDiamond, or an LLM-as-a-router to bypass 15ms–50ms embedding calculations on syntactically obvious prompts (code fences, SQL, LaTeX formulas, chess FEN, language translations).
* **Agent retry loops & evaluation swarms**: Use `createPreRouter()` to cache repeated prompts and benchmark templates at ~1.5 µs latency with zero network overhead.
* **Living domain configuration**: Extend with `customSpecialistRules` for your proprietary tags, ticket schemas, or internal API calls, and use `harvest:ood` to turn production misroutes into regression tests.

### ❌ When NOT to Use
* **As a standalone semantic router**: Deterministic heuristics cannot infer nuanced communicative intent. Prompts without syntax footprints must miss to an L2 neural or frontier model.
* **For medical or legal dispatch**: Never rely on regex keywords for clinical diagnosis or legal advice. The default `general_fast` classification for medical terminology is a lightweight swarm heuristic; production systems should override it or allow medical queries to delegate to L2.
* **When expecting 100% recall**: This gate is intentionally designed for **high precision, low recall**. If a query is ambiguous, it cleanly returns `isFastPath: false` and `role: undefined`.

---

## 🧪 Evaluation & Regression Hygiene

The test suite validates performance across both in-domain specialist traffic and out-of-distribution adversarial traffic:

```bash
npm test
```

* **Holdout Specialist Dataset (100 prompts)**: Author-curated regression suite across all 6 target domains (Code, STEM, Deep Reasoning, Reading Comprehension, Chess/Spatial, General Fast). Target domain accuracy: **100% (100/100)**.
* **Out-of-Distribution (OOD) Adversarial Dataset (115 prompts)**: Regression suite evaluating conversational chat, subjective advice, and colloquial keyword traps (e.g. conversational "probability of rain", corporate "DNA", plain prose in backticks, non-STEM multiple-choice questions, and metaphorical "symptoms of burnout").
  * **Clean L2 Delegation**: **100.0% (115/115)**
  * **Wrong-Specialist Rate (False-Positive Rate)**: **0.0% (0/115)**

> **Important Note on Accuracy Numbers**: 100% holdout accuracy and 0% FPR reflect regression suite hygiene against author test fixtures, not an external, independent benchmark. A regex classifier tuned to fixed fixtures will only stay accurate if maintained as a **living configuration**. Run `npm run harvest:ood` against your actual production logs to capture false positives and continuously harden your rules.

---

## 🛡️ Large Payload & ReDoS Safety

Large pasted documents, multi-megabyte error dumps, or log files can degrade regex engines through catastrophic backtracking or unbounded string scanning:
* **Bounded Scanning Window**: `classifyPreRoute` bounds heuristic analysis to a max 8,000-character window (sampling the first 4,000 and last 4,000 characters). Syntactic markers, code fences, imports, and task instructions reside at the boundaries.
* **Deterministic Execution**: Bounded sampling guarantees sub-15µs CPU execution even on 5MB payloads, eliminating ReDoS vectors. Full text length is preserved for complexity scoring.

---

## ⚖️ Pipeline Comparison: Stage 0 vs Stage 1 Routers

| Dimension | Stage-0 Pre-Router (`krusch-pre-router`) | Stage-1 Embedding Routers (RouteLLM, NotDiamond) | LLM-as-a-Router (e.g. Orca) |
|---|---|---|---|
| **Gate / Classification Latency (CPU)** | **1.5 µs – 7 µs (Local CPU)** | 15 ms – 50 ms (Vectorization + MLP) | 300 ms – 1,200 ms (API pre-flight) |
| **Routing Cost** | **$0.00 (0 tokens)** | ~$0.0001 (Embedding tokens) | ~$0.002 (Prompt tokens) |
| **Runtime Dependencies** | **0 dependencies (<20KB)** | Vector DB / ONNX runtime | Full LLM API client |
| **Deterministic Syntax (Code, Math, SQL)** | **Instant Fast-Path** | Evaluates embedding distance | Prompt-based classification |
| **Ambiguous Conversational Chat** | **Delegates to L2 (`isFastPath: false`)** | High (Learns nuanced semantics) | Very High |
| **Execution Environment** | **Anywhere (Edge, Workers, Browser)** | Server / Python container | Server / Cloud API |

*\* Note: Classification latency measures the time required to choose a route. End-to-end response latency includes downstream model inference.*

---

## 🔌 Architecture: Stage-0 Front Gate to Downstream Routers

`krusch-pre-router` is an in-process, zero-dependency **front gate (syntactic reverse proxy)**, not an adapter SDK or client wrapper for downstream routers. It does not embed RouteLLM, NotDiamond, or vendor SDKs.

Anything that consumes `PreRouteResult` can sit behind it:

```typescript
import { createPreRouter } from 'krusch-pre-router';

const router = createPreRouter();

async function handlePrompt(prompt: string) {
  const route = router.classify(prompt);

  if (route.isFastPath) {
    // ⚡ Fast-path hit: Dispatch immediately to your mapped specialist
    return dispatchSpecialist(route.role, prompt);
  }

  // 🔍 Stage-0 miss (isFastPath: false, role: undefined):
  // Delegate unopinionated traffic to your neural router or frontier model
  return l2Router.route(prompt); // RouteLLM, NotDiamond, or Frontier
}
```

### Role Taxonomy & Custom Domains

* **Agnostic Miss Contract**: On misses, `role` is `undefined` and `suggestedAction` is `'delegate_to_l2'`. Downstream routers receive traffic the gate did not claim without requiring any role translation.
* **Default Specialist Taxonomy**: Provides 6 core archetypes (`code`, `factual_stem`, `reasoning_deep`, `games_spatial`, `comprehension_rc`, `general_fast`). Map these roles to your specific models or provider endpoints.
* **Custom Domain Taxonomies**: Define arbitrary string roles via `customSpecialistRules` without forking or shoehorning:

```typescript
const router = createPreRouter({
  customSpecialistRules: [
    { role: 'billing_ops', pattern: /\b(?:stripe invoice|chargeback|mrr)\b/i },
    { role: 'legal_compliance', pattern: /\b(?:gdpr deletion|subprocessor)\b/i },
    { role: 'claude-3-5-haiku', pattern: /\b(?:quick translation|format json)\b/i }
  ]
});
```

---

## 🛠️ API Reference

### `createPreRouter(options?: PreRouterOptions): PreRouter`

Factory creating a stateful pre-router instance with an integrated LRU cache.

```typescript
interface PreRouterOptions extends ClassifierOptions {
  cache?: boolean | CacheOptions; // Cache enabled by default (maxSize: 1000)
  namespace?: string;             // Optional namespace prefix to isolate cache across tenants/configs
  onRoute?: (telemetry: RouteTelemetry) => void; // Non-blocking audit hook for logging traffic to disk/SQLite
}

interface RouteTelemetry {
  prompt: Message[] | string;
  result: PreRouteResult;
  fromCache: boolean;
  namespace?: string;
  timestamp: number;
}

interface PreRouter {
  classify(messages: Message[] | string): PreRouteResult;
  cache: PreRouteCache | null;
  clearCache(): void;
}
```

#### Production Telemetry & Audit Tap

Use `onRoute` to log Stage-0 traffic directly to an audit database or JSONL stream without impacting routing latency (errors inside the hook are automatically swallowed to ensure zero router downtime):

```javascript
const router = createPreRouter({
  namespace: 'customer-support-agent',
  onRoute: ({ prompt, result, fromCache, timestamp }) => {
    // Ship to asynchronous telemetry / logger
    telemetryLogger.log({ prompt, result, fromCache, timestamp });
  }
});
```

#### Living OOD Regression Suite & Harvest CLI

Capture false positives from production logs and automatically feed them back into the OOD regression suite:

```bash
# Ingest production logs (JSONL) and append newly discovered traps to test/fixtures/ood-prompts.json
npm run harvest:ood -- /path/to/production-traffic.jsonl

# Dry-run inspection without modifying fixtures
npm run harvest:ood -- /path/to/production-traffic.jsonl --dry-run
```


### `classifyPreRoute(prompt, options?): PreRouteResult`

Evaluates prompt structure and returns classification metadata:

```typescript
interface PreRouteResult {
  isFastPath: boolean;             // True if matched a deterministic specialist domain
  role?: SpecialistRole;           // Defined on fast-path ('code' | 'factual_stem' | 'general_fast' | 'reasoning_deep' | 'games_spatial' | 'comprehension_rc'); undefined on miss
  confidence: 'high' | 'borderline' | 'unstructured';
  complexityScore: number;         // [0.0, 1.0] continuous complexity indicator
  suggestedAction: 'dispatch_specialist' | 'delegate_to_l2';
}
```

### `detectKnowledgeBoundary(text): 'closed' | 'open'`

Identifies closed-world self-contained transformations (e.g. arithmetic, unit conversion, code formatting, regex generation) that do not require open-world reasoning:

```javascript
import { detectKnowledgeBoundary } from 'krusch-pre-router';

detectKnowledgeBoundary("Convert 75 F to C"); // 'closed'
detectKnowledgeBoundary("What are the ethical dilemmas of AI?"); // 'open'
```

---

### ⛓️ Rule Precedence & Priority Ordering

Evaluation follows a deterministic, priority-ordered chain:
1. **Custom Specialist Rules** (`options.customSpecialistRules`) — *Always evaluate first*
2. **Grounded Reading Comprehension** (`role: 'comprehension_rc'`)
3. **Code Generation & SQL** (`role: 'code'`)
4. **Chess & Spatial Games** (`role: 'games_spatial'`)
5. **Deep Financial Reasoning & Proofs** (`role: 'reasoning_deep'`)
6. **General Fast** (`role: 'general_fast'`)
7. **Explicit STEM & Math** (`role: 'factual_stem'`)
8. **Closed-World Transforms** (`role: 'general_fast'`)
9. **Unstructured Miss** (`isFastPath: false`, `role: undefined`)

> **Multi-Domain Precedence**: If a prompt spans multiple domains (e.g. *"Write a Python script to parse a chess PGN"* or *"Based on the provided passage, write a SQL query"*), earlier rules take precedence (`code` precedes `games_spatial`; `comprehension_rc` precedes `code`). To enforce custom domain priority, define rules in `customSpecialistRules`.

---

### 📐 Complexity Scoring vs. Domain Fast-Pathing

`evaluateComplexityScore` (and `isComplexPrompt`) measures **cognitive workload and prompt size** (token length, analytical verbs, nested XML/JSON data structures), which is orthogonal to **deterministic domain specialization**:
* A prompt can be recognized as code (`role: 'code'`) while simultaneously exhibiting high complexity (`complexityScore: 0.85`, `isComplexPrompt: true`).
* In an agent swarm, high complexity on a fast-pathed role signals that the task should be dispatched to a **flagship specialist** (e.g., Claude 3.7 Sonnet or Qwen-2.5-Coder-32B) rather than a lightweight coding model.

---

## 🌐 Looking for an End-to-End Cascade Swarm?

If you want an end-to-end multi-model execution layer powered by `krusch-pre-router` with:
* 5 specialized domain models routed via OpenRouter
* Speculative parallel hedging for borderline queries
* Mid-stream token repetition and entropy collapse loop guards
* Automatic fallback cascades

Check out **[`krusch-cascade-router`](https://github.com/kruschdev/krusch-cascade-router)**.

---

## 📄 License

MIT © [Kevin Krusch](https://github.com/kruschdev)
