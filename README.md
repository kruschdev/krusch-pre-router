<p align="center">
  <img src="https://raw.githubusercontent.com/kruschdev/krusch-cascade-router/main/docs/assets/banner.png" alt="Krusch Pre-Router" width="800" />
</p>

<p align="center">
  <strong>The L1 Cache & Fast-Path Pre-Router for LLM Architectures.</strong><br>
  <span>Zero dependencies. &lt;20KB bundle size. Microsecond CPU classification & LRU caching. $0.00 routing tax.</span>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/krusch-pre-router"><img src="https://img.shields.io/npm/v/krusch-pre-router.svg?style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/kruschdev/krusch-pre-router/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kruschdev/krusch-pre-router.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/latency-%3C10%C2%B5s-blue.svg?style=flat-square" alt="Sub-10us Latency">
  <img src="https://img.shields.io/badge/cache-LRU%20%3C2%C2%B5s-brightgreen.svg?style=flat-square" alt="LRU Cache <2us">
  <img src="https://img.shields.io/badge/cost-%240.00-purple.svg?style=flat-square" alt="Zero Routing Cost">
</p>

---

## ⚡ Why Krusch Pre-Router?

### **"Don't spend a model call just to pick a model. Check L1 first."**

In modern computer architecture, the CPU does not query main RAM or NVMe storage for every instruction—it queries the **L1 cache** first. If there is a cache hit, execution completes in nanoseconds with zero memory bus overhead.

In multi-model AI architectures, using an LLM or embedding model to decide where to route an obvious Python function, SQL query, LaTeX math expression, or JSON transform is wasteful:
* **The Routing Tax**: Neural routers introduce **30ms–500ms of Time-To-First-Token (TTFT)** and auxiliary token billing.
* **The L1 Solution**: `krusch-pre-router` acts as an in-memory **L1 Pre-Filter & Cache Gate**. It pairs an in-memory LRU cache (<2µs hits) with deterministic CPU heuristic classification (<10µs cold) for **$0.00**. High-confidence structured traffic is fast-pathed immediately to cheap domain specialists (`Qwen3-Coder-Next`, `deepseek-v4-flash`, `gemini-3.1-flash-lite`), while unstructured conversational chat passes cleanly through (`isFastPath: false`, `role: undefined`) to your secondary **L2 Neural Router** (e.g. RouteLLM, NotDiamond) or frontier model.

```
                  ┌───────────────────────────────┐
                  │        Incoming Prompt        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  Stage 0: L1 Pre-Router (krusch-pre-router)            │
      │  LRU Cache Hit:   < 2 microseconds (O(1))              │
      │  Cold Heuristic:  < 10 microseconds (CPU)              │
      │  Cost:            $0.00 (0 tokens, 0 network hops)     │
      └───────┬────────────────────────────────────────┬───────┘
              │                                        │
    High Confidence Fast-Path                L1 Miss / Ambiguous
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

```bash
npm install krusch-pre-router
```

> **Requirement**: Zero runtime dependencies. ESM and CommonJS exports with full TypeScript definitions (`.d.ts`). Compatible with Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, and modern browsers.

---

## 🚀 Usage

### 1. Stateful Pre-Router with In-Memory LRU Cache (Recommended)

`createPreRouter()` wraps heuristic evaluation with a built-in, zero-dependency LRU cache with whitespace normalization:

```javascript
import { createPreRouter } from 'krusch-pre-router';

// Create pre-router instance (LRU cache size defaults to 1,000 prompts)
const router = createPreRouter({
  cache: { maxSize: 2000 }
});

async function handlePrompt(prompt) {
  // Checks LRU cache first (<2µs), evaluates heuristics on miss (<10µs)
  const route = router.classify(prompt);

  if (route.isFastPath) {
    // ⚡ Direct specialist dispatch
    console.log(`L1 Hit! Role: ${route.role} (confidence: ${route.confidence})`);
    return callSpecialist(route.role, prompt);
  }

  // 🔍 Pass through to L2 / Frontier
  console.log('L1 Miss -> Passing to L2 Neural Router or Frontier Model');
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

Benchmarked on Node.js v20 (10,000 iterations across code, STEM, closed-world, and unstructured chat prompts):

| Stage | Average | Min | p50 | p90 | p99 | Throughput |
|---|---|---|---|---|---|---|
| **Warm LRU Cache Hit** (`router.classify`) | **1.75 µs** | 0.74 µs | **1.50 µs** | 2.15 µs | 4.15 µs | **~534,000 ops/sec** |
| **Cold Regex Heuristic** (`classifyPreRoute`) | **6.99 µs** | 1.08 µs | **5.69 µs** | 11.68 µs | 24.68 µs | **~139,000 ops/sec** |

---

## ⚖️ Pipeline Comparison: L1 vs L2 Routers

| Dimension | Krusch Pre-Router (L1 Gate) | Embedding Routers (RouteLLM, NotDiamond) | LLM-as-a-Router (e.g. Orca) |
|---|---|---|---|
| **Dispatch Latency** | **1.5 µs – 7 µs (CPU)** | 15 ms – 50 ms (Vectorization + MLP) | 300 ms – 1,200 ms (API pre-flight) |
| **Routing Cost** | **$0.00 (0 tokens)** | ~$0.0001 (Embedding tokens) | ~$0.002 (Prompt tokens) |
| **Runtime Dependencies** | **0 dependencies (<20KB)** | Vector DB / ONNX runtime | Full LLM API client |
| **Deterministic Syntax (Code, Math, SQL)** | **Instant Fast-Path** | Evaluates embedding distance | Prompt-based classification |
| **Ambiguous Conversational Chat** | **Delegates to L2 (`isFastPath: false`)** | High (Learns nuanced semantics) | Very High |
| **Execution Environment** | **Anywhere (Edge, Workers, Browser)** | Server / Python container | Server / Cloud API |

---

## 🛠️ API Reference

### `createPreRouter(options?: PreRouterOptions): PreRouter`

Factory creating a stateful pre-router instance with an integrated LRU cache.

```typescript
interface PreRouterOptions extends ClassifierOptions {
  cache?: boolean | CacheOptions; // Cache enabled by default (maxSize: 1000)
}

interface PreRouter {
  classify(messages: Message[] | string): PreRouteResult;
  cache: PreRouteCache | null;
  clearCache(): void;
}
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
