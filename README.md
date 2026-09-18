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
  1. **LRU Memo Table**: O(1) in-memory lookup (~1.5µs p50) with defensive cloning for repeated prompts, evaluation templates, and agent retry loops.
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

`createPreRouter()` wraps heuristic evaluation with an optional in-memory LRU memoization table (useful for agent retry loops and repeated templates):

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
    // Fast-path internal billing/finance queries
    { role: 'reasoning_deep', pattern: /\b(?:stripe invoice|chargeback|mrr|arr)\b/i },
    // Route customer support ticket tags
    { role: 'general_fast', pattern: /\b(?:ticket #\d+|support refund|account password)\b/i }
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

## 🧪 Evaluation & Accuracy Testing

The test suite validates performance across both in-domain specialist traffic and out-of-distribution conversational traffic:

```bash
npm test
```

* **Holdout Specialist Dataset (100 prompts)**: Evaluates template-free prompts across all 6 target domains (Code, STEM, Deep Reasoning, Reading Comprehension, Chess/Spatial, General Fast). Target domain accuracy: **100% (100/100)**.
* **Out-of-Distribution (OOD) Dataset (100 prompts)**: Evaluates open-world conversational chat, subjective advice, creative writing, and adversarial traps (e.g. colloquial "force", "mass", "pipeline", "function of sleep").
  * **Clean L2 Delegation**: **100.0% (100/100)**
  * **Wrong-Specialist Rate (False-Positive Rate)**: **0.0% (0/100)**

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
