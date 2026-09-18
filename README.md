<p align="center">
  <img src="https://raw.githubusercontent.com/kruschdev/krusch-cascade-router/main/docs/assets/banner.png" alt="Krusch Pre-Router" width="800" />
</p>

<p align="center">
  <strong>The L1 Cache & Fast-Path Pre-Router for LLM Architectures.</strong><br>
  <span>Zero dependencies. &lt;20KB bundle size. Sub-15 microsecond CPU classification. $0.00 routing tax.</span>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/krusch-pre-router"><img src="https://img.shields.io/npm/v/krusch-pre-router.svg?style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/kruschdev/krusch-pre-router/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kruschdev/krusch-pre-router.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/latency-%3C15%C2%B5s-blue.svg?style=flat-square" alt="Sub-15us Latency">
  <img src="https://img.shields.io/badge/cost-%240.00-purple.svg?style=flat-square" alt="Zero Routing Cost">
</p>

---

## ⚡ Why Krusch Pre-Router?

### **"Don't spend a model call just to pick a model. Check L1 first."**

In modern computer architecture, the CPU does not query main RAM or NVMe storage for every instruction—it queries the **L1 cache** in 1 clock cycle. If there is a cache hit, execution completes instantly with zero memory bus overhead.

In multi-model AI architectures, using an LLM or neural embedding model to decide where to route an obvious Python function, SQL query, LaTeX math expression, or JSON transform is an expensive anti-pattern:
* **The Routing Tax**: Heavy routers introduce **300ms–800ms of Time-To-First-Token (TTFT)** and auxiliary billing per step.
* **The L1 Solution**: `krusch-pre-router` acts as an in-memory **L1 Pre-Filter Gate**. It evaluates deterministic syntax and closed-world boundaries in **<15 microseconds** on CPU for **$0.00**, immediately dispatching high-confidence structured traffic to cheap domain specialists (`Qwen3-Coder-Next`, `deepseek-v4-flash`, `gemini-3.1-flash-lite`), while cleanly delegating ambiguous natural language to secondary **L2 Neural Routers** (e.g. RouteLLM, NotDiamond) or frontier models.

```
                  ┌───────────────────────────────┐
                  │        Incoming Prompt        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  Stage 1: L1 Pre-Router (krusch-pre-router)           │
      │  Latency: < 15 microseconds (CPU)                      │
      │  Cost:    $0.00 (0 tokens, 0 network hops)             │
      └───────┬────────────────────────────────────────┬───────┘
              │                                        │
    High Confidence Syntax                   Low Confidence / Ambiguous
    (Code, SQL, LaTeX, Math, JSON)           (Chat, Nuanced Semantics)
              │                                        │
              ▼                                        ▼
    ┌───────────────────┐                 ┌─────────────────────────┐
    │ Direct Specialist │                 │  Stage 2: L2 Classifier │
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

> **Requirement**: Zero runtime dependencies. Compatible with Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge, and modern browsers.

---

## 🚀 3-Line Drop-In Quick Start

Add an L1 fast-path gate in front of your existing OpenAI, Anthropic, or Vercel AI SDK pipeline:

```javascript
import { classifyPreRoute } from 'krusch-pre-router';

async function handlePrompt(prompt) {
  // 1. Check L1 in <15 microseconds ($0.00, 0 tokens)
  const preRoute = classifyPreRoute(prompt);

  if (preRoute.isFastPath) {
    // ⚡ L1 Fast-Path Hit: Direct dispatch to domain specialist
    console.log(`L1 Hit! Routing directly to specialist: ${preRoute.role}`);
    return callSpecialist(preRoute.role, prompt);
  }

  // 🔍 L1 Miss: Ambient / ambiguous natural language
  console.log('L1 Miss -> Passing through to L2 Neural Router / Frontier LLM');
  return callFrontierModel(prompt);
}
```

---

## ⚖️ Architectural Trade-offs: L1 vs L2 Routers

| Dimension | Krusch Pre-Router (L1 Gate) | Embedding Routers (RouteLLM, NotDiamond) | LLM-as-a-Router (Orca) |
|---|---|---|---|
| **Dispatch Latency** | **< 15 microseconds (CPU)** | 15 – 50 ms (Vectorization + MLP) | 400 – 1,200 ms (LLM pre-flight) |
| **Routing Cost** | **$0.00 (0 tokens)** | ~$0.0001 (Embedding tokens) | ~$0.002 (Prompt tokens) |
| **Runtime Dependencies** | **0 dependencies (<20KB)** | Vector DB / ONNX runtime | Full LLM API client |
| **Structured Prompts (Code, Math, SQL)** | **High Precision (>95%)** | High (>90%) | High (>95%) |
| **Ambiguous Conversational Chat** | **Delegates to L2 (`isFastPath: false`)** | High (Learns nuanced semantics) | Very High |
| **Execution Environment** | **Anywhere (Edge, Workers, Browser)** | Server / Python container | Server / Cloud API |

---

## 🛠️ API Reference

### `classifyPreRoute(prompt, options?): PreRouteResult`

Evaluates prompt structure and returns a classification result:

```typescript
interface PreRouteResult {
  isFastPath: boolean;             // True if matched a high-confidence deterministic specialist domain
  role: SpecialistRole;            // 'code' | 'factual_stem' | 'general_fast' | 'reasoning_deep' | 'games_spatial' | 'comprehension_rc'
  confidence: 'high' | 'borderline' | 'unstructured';
  complexityScore: number;         // [0.0, 1.0] continuous complexity
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

### `classifySpecialistRole(prompt, options?): SpecialistRole`

Direct deterministic role classifier:

```javascript
import { classifySpecialistRole } from 'krusch-pre-router';

classifySpecialistRole("def quicksort(arr): ..."); // 'code'
classifySpecialistRole("Calculate \\frac{3}{4} + \\sqrt{16}"); // 'factual_stem'
classifySpecialistRole("Translate this sentence to French"); // 'general_fast'
```

---

## 🌐 Looking for a Turnkey Swarm Runtime?

If you want an end-to-end multi-model execution layer powered by `krusch-pre-router` with:
* 5 specialized domain models routed via OpenRouter
* Speculative parallel hedging for borderline queries
* Mid-stream token repetition and entropy collapse loop guards
* Automatic fallback cascades

Check out **[`krusch-cascade-router`](https://github.com/kruschdev/krusch-cascade-router)**.

---

## 📄 License

MIT © [Kevin Krusch](https://github.com/kruschdev)
