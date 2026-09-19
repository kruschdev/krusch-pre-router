<p align="center">
  <img src="https://raw.githubusercontent.com/kruschdev/krusch-cascade-router/main/docs/assets/banner.png" alt="Krusch Pre-Router" width="800" />
</p>

<p align="center">
  <strong>Deterministic Stage-0 Syntactic Gate & Exact-Match LRU Memoization Table for LLM Swarms.</strong><br>
  <span>High-precision syntactic intercept + honest miss. Zero runtime dependencies. &lt;20KB bundle size. $0.00 routing tax.</span>
</p>

<p align="center">
  <a href="https://github.com/kruschdev/krusch-pre-router/blob/main/LICENSE"><img src="https://img.shields.io/github/license/kruschdev/krusch-pre-router.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/default%20preset-anchors--only-blue.svg?style=flat-square" alt="Default Preset: anchors-only">
  <img src="https://img.shields.io/badge/precedence-deny%20%3E%20custom%20%3E%20anchors%20%3E%20keywords-purple.svg?style=flat-square" alt="Strict Precedence">
  <img src="https://img.shields.io/badge/classification%20p50-7.3%C2%B5s-blue.svg?style=flat-square" alt="Classification p50 7.3us">
  <img src="https://img.shields.io/badge/memo%20hit%20p50-5.5%C2%B5s-brightgreen.svg?style=flat-square" alt="LRU Memo Hit p50 5.5us">
</p>

---

## ⚡ Product Contract: Syntactic Intercept + Honest Miss

`krusch-pre-router` is a **deterministic Stage-0 syntactic gate** for multi-model AI swarms. Its job is not to guess intent through semantic embeddings, but to:
1. **Intercept unambiguous structural syntax** on the CPU in single-digit microseconds (`<10µs`) for `$0.00` before expensive neural routers or LLM judges are invoked.
2. **Enforce honest misses**: When a prompt lacks deterministic grammatical anchors or triggers safety exclusions, it cleanly yields (`isFastPath: false`, `role: undefined`, `suggestedAction: 'delegate_to_l2'`) to Stage-1 neural routers (e.g. RouteLLM, NotDiamond) or frontier models.
3. **Explain every routing decision**: Every result emits a specific `reason` (`fence`, `sql`, `latex`, `stack_trace`, `deny`, `miss`), an auditable `ruleId`, the exact `scanWindowUsed`, and the active `rulesVersion`.

```
                  ┌───────────────────────────────┐
                  │        Incoming Prompt        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  Stage 0: Syntactic Gate (krusch-pre-router)           │
      │  Total Precedence: deny > custom > anchors > keywords  │
      │  Default Preset:   anchors-only (zero drift)           │
      │  Cold Regex Stack: ~ 7.3 µs (CPU syntax scan)          │
      │  LRU Memo Table:   ~ 5.5 µs (Hits-only exact match)    │
      │  Cost:             $0.00 (0 tokens, 0 network hops)    │
      └───────┬────────────────────────────────────────┬───────┘
              │                                        │
    High-Confidence Fast-Path                Gate Miss / Unstructured / Deny
    (Code, SQL, LaTeX, Math, FEN)            (Chat, Clinical, Nuanced Semantics)
    isFastPath: true                         isFastPath: false (role: undefined)
              │                                        │
              ▼                                        ▼
    ┌───────────────────┐                 ┌─────────────────────────┐
    │ Direct Specialist │                 │  Stage 1: L2 Classifier │
    │ (e.g. Qwen-Coder, │                 │  (RouteLLM, NotDiamond, │
    │  DeepSeek-Math)   │                 │   Frontier Guardrails)  │
    └───────────────────┘                 └────────────┬────────────┘
                                                       │
                                                       ▼
                                          ┌─────────────────────────┐
                                          │     Frontier Route      │
                                          └─────────────────────────┘
```

---

## 📦 Installation

Directly from GitHub (recommended for git-pinned tags):
```bash
npm install github:kruschdev/krusch-pre-router#v1.0.0
```

Or from local submodule/checkout:
```bash
npm install ../path/to/krusch-pre-router
```

> **Requirements**: Zero runtime dependencies. ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) exports with full TypeScript definitions (`.d.ts`). Tested across Node 18, 20, 22, Bun, Deno, and Edge runtimes.

---

## 🛡️ Core Invariants & Safety Guarantees

### 1. Conservative Profile by Default (`anchors-only`)
Heuristic keyword matching (`general_fast`: translation, trivia, unit conversion) is where colloquial false-positives originate. To prevent heuristic drift in production, `krusch-pre-router` ships with **`preset: 'anchors-only'` as the default**:
* **`anchors-only` (Default)**: Only fast-paths unambiguous syntactic structures (code fences, SQL, LaTeX equations, language function signatures/imports, stack traces, chess FEN/moves, structured reading comprehension).
* **`anchors+keywords` (Opt-in)**: Enables natural language translation, geography, closed-world transformations, and trivia keywords. Use `{ preset: 'anchors+keywords' }` or `classifyKeywords()`.

### 2. Strict Precedence Order (Enforced as Data)
Rule evaluation follows a verified total order encoded in the rules catalog:
```
deny > custom > syntactic anchors > keywords > miss
```
* **Clinical & Legal Deny List**: Queries describing acute clinical emergencies (e.g., crushing chest pain), medical pharmacology / drug dosing (e.g., vancomycin dosing, pediatric titration), or legal liability strictly trigger the top-level deny list. They **force an immediate miss** (`reason: 'deny'`, `isFastPath: false`), even if wrapped inside code fences or custom rules.
* **Code-over-Games Invariant**: Programming instructions involving chess (e.g., *"Write a Python script to parse a chess PGN"*) route to `code`, never `games_spatial`.

### 3. Hits-Only Memoization (No Miss Lock-in)
Exact-match caching of misses (`isFastPath: false`) causes dangerous stale cache locks when rules are deployed.
* `PreRouteCache` defaults to **`cachePolicy: 'hits'`**: Only fast-pathed queries (`isFastPath: true`) are memoized.
* Cache keys automatically prefix the rule version and preset: `[v${rulesVersion}:${preset}][${namespace}]${key}`, ensuring that rule deployments immediately invalidate previous memoized entries.

### 4. Message-Aware Classification (Tool Noise Invariance)
When passing `Message[]`, `classifyPreRoute` defaults to **`messageScope: 'last_user'`**. Tool crashes, API error logs, or stack traces emitted by previous assistant/tool turns will **not** cause false-positive fast-paths on conversational user queries.

---

## 🚀 Usage

### 1. Stateful Pre-Router with In-Memory LRU Memo Table (Recommended)

```typescript
import { createPreRouter } from 'krusch-pre-router';

// Create pre-router instance (hits-only LRU cache by default)
const router = createPreRouter({
  cache: { maxSize: 2000 }
});

async function handleRequest(prompt: string) {
  // Checks LRU memo table (~5.5µs), evaluates cold heuristics on miss (~7.3µs)
  const route = router.classify(prompt);

  if (route.isFastPath) {
    // ⚡ Direct specialist dispatch
    console.log(`Fast-Path Hit [${route.ruleId}]: role=${route.role} reason=${route.reason}`);
    return callSpecialist(route.role, prompt);
  }

  // 🔍 Stage-0 Miss -> Pass cleanly to L2 Neural Router or Frontier Guardrails
  console.log(`Stage-0 Miss [reason=${route.reason}]: Delegating to L2`);
  return callFrontierOrL2(prompt);
}
```

### 2. Explainable Classification Contract

```typescript
import { classifyPreRoute } from 'krusch-pre-router';

const result = classifyPreRoute('```python\nx = 1\n```');
console.log(result);
// {
//   isFastPath: true,
//   role: 'code',
//   confidence: 'high',
//   complexityScore: 0.20,
//   suggestedAction: 'dispatch_specialist',
//   reason: 'fence',
//   ruleId: 'anchor:code_fence',
//   scanWindowUsed: { startChars: 21, endChars: 0, totalChars: 21, truncated: false },
//   rulesVersion: 1
// }

const clinicalDeny = classifyPreRoute('```python\n# calculate pediatric dosage of vancomycin\n```');
console.log(clinicalDeny);
// {
//   isFastPath: false,
//   role: undefined,
//   confidence: 'unstructured',
//   complexityScore: 0.20,
//   suggestedAction: 'delegate_to_l2',
//   reason: 'deny',
//   ruleId: 'deny:pharmacology_dosing',
//   scanWindowUsed: { startChars: 72, endChars: 0, totalChars: 72, truncated: false },
//   rulesVersion: 1
// }
```

### 3. Opt-in Keywords (`classifyKeywords`)

```typescript
import { classifyKeywords } from 'krusch-pre-router';

// Fast-paths natural language translations or unit conversions
const result = classifyKeywords('Translate "Good morning" into Spanish.');
// {
//   isFastPath: true,
//   role: 'general_fast',
//   reason: 'keyword',
//   ruleId: 'keyword:translation'
// }
```

### 4. Custom Domain Roles

```typescript
const router = createPreRouter({
  customSpecialistRules: [
    { role: 'billing_ops', pattern: /\b(?:stripe invoice|chargeback|mrr)\b/i },
    { role: 'support_triage', pattern: /\b(?:ticket #\d+|support refund)\b/i }
  ]
});
```

---

## 🔌 Distributed Cache Integration (`CacheAdapter`)

`PreRouteCache` is an in-process LRU table. To compose with distributed stores like **Redis**, **Cloudflare KV**, or **Memcached**, implement the 20-line `CacheAdapter` interface:

```typescript
import { createPreRouter, CacheAdapter, PreRouteResult } from 'krusch-pre-router';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const redisAdapter: CacheAdapter = {
  async get(key: string): Promise<PreRouteResult | undefined> {
    const raw = await redis.get(`pre-router:${key}`);
    return raw ? JSON.parse(raw) : undefined;
  },
  async set(key: string, result: PreRouteResult): Promise<void> {
    // TTL 1 hour (3600s)
    await redis.set(`pre-router:${key}`, JSON.stringify(result), 'EX', 3600);
  },
  async has(key: string): Promise<boolean> {
    return (await redis.exists(`pre-router:${key}`)) === 1;
  }
};

const router = createPreRouter({ adapter: redisAdapter });
```

---

## 📊 Production Telemetry & Audit Tap

`createPreRouter` provides a non-blocking `onRoute` tap. It includes:
* **Schema-Stable `v1` Event Format** (`version: '1'`, `ruleId`, `reason`, `rulesVersion`).
* **PII Redaction by Default**: Unless `includeFullPrompt: true` is passed, prompts are truncated to a safe 100-character snippet and string length.
* **Sampling Rate**: Set `sampleRate: 0.1` to log only 10% of traffic in high-throughput environments.
* **Crash-Resilience**: Telemetry callback exceptions are caught and swallowed, ensuring zero routing disruption.

```typescript
const router = createPreRouter({
  namespace: 'customer-gateway',
  sampleRate: 0.25, // Sample 25% of requests
  onRoute: (event) => {
    // Ship to Datadog, BigQuery, or audit JSONL
    auditLogger.emit({
      v: event.version,
      ruleId: event.ruleId,
      reason: event.reason,
      fromCache: event.fromCache,
      promptSnippet: event.promptSnippet,
      timestamp: event.timestamp
    });
  }
});
```

---

## 🌾 Living OOD Harvest Loop

Stage-0 misroutes captured from production telemetry can be harvested directly into regression fixtures:

```bash
# Ingest production JSONL traffic and isolate Stage-0 traps
npm run harvest:ood -- /path/to/traffic-logs.jsonl

# Dry-run inspection
npm run harvest:ood -- /path/to/traffic-logs.jsonl --dry-run
```

---

## 🧪 Test Suite & Verified Benchmarks

Reproduce locally with:
```bash
npm test
npm run bench
```

### Verified Benchmark (Node v22, Intel Core i7-5820K @ 3.30GHz, 10,000 iterations):

| Operation | Scope | Average | p50 | p90 | p99 | Throughput |
|---|---|---|---|---|---|---|
| **Warm LRU Memo Hit** (`router.classify`) | In-memory Map lookup + defensive clone (Hits only) | **6.82 µs** | **5.52 µs** | 12.54 µs | 24.04 µs | **~144,000 ops/sec** |
| **Cold Regex Heuristic** (`classifyPreRoute`) | Full priority-ordered CPU regex stack scan | **8.70 µs** | **7.33 µs** | 13.24 µs | 25.12 µs | **~111,000 ops/sec** |

### Test Suite Coverage:
* **Calibrated Fixtures (100 prompts)**: 85 syntactic anchors (100% under `anchors-only`), 15 keyword prompts (100% under `anchors+keywords`).
* **OOD Adversarial Traps (126 prompts)**: Clean L2 delegation rate: **100.0% (126/126)**, Wrong-Specialist Rate (FPR): **0.0%**.
* **Total Precedence Invariant**: Formally tests `deny > custom > anchors > keywords > miss`.
* **Bounded Regex Linear Audit**: Proves every rule in `RULE_CATALOG` executes in `<2ms` on worst-case 8KB adversarial inputs.

---

## 📄 License

MIT © [Kevin Krusch](https://github.com/kruschdev)
