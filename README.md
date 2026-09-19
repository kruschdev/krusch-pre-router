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
  <img src="https://img.shields.io/badge/default%20preset-structure-blue.svg?style=flat-square" alt="Default Preset: structure">
  <img src="https://img.shields.io/badge/precedence-deny%20%3E%20custom%20%3E%20structure%20%3E%20lexical%20%3E%20keywords-purple.svg?style=flat-square" alt="Strict Precedence">
  <img src="https://img.shields.io/badge/classification%20p50-3.5%C2%B5s-blue.svg?style=flat-square" alt="Classification p50 3.5us">
  <img src="https://img.shields.io/badge/memo%20hit%20p50-4.6%C2%B5s-brightgreen.svg?style=flat-square" alt="LRU Memo Hit p50 4.6us">
</p>

---

## ⚡ Product Contract: Syntactic Intercept + Honest Miss

`krusch-pre-router` is a **deterministic Stage-0 syntactic gate** for multi-model AI swarms. Its job is not to guess intent through semantic embeddings, but to:
1. **Intercept unambiguous structural syntax** on the CPU in single-digit microseconds (`<10µs`) for `$0.00` before expensive neural routers or LLM judges are invoked.
2. **Enforce honest misses**: When a prompt lacks deterministic grammatical anchors or triggers safety exclusions, it cleanly yields (`isFastPath: false`, `role: undefined`, `suggestedAction: 'delegate_to_l2'`) to Stage-1 neural routers (e.g. RouteLLM, NotDiamond) or frontier models.
3. **Explain every routing decision**: Every result emits a specific `reason` (`fence`, `sql`, `latex`, `stack_trace`, `chess_move`, `deny`, `miss`), an auditable `ruleId`, the exact `scanWindowUsed`, and the active `rulesVersion`.

```
                  ┌───────────────────────────────┐
                  │        Incoming Prompt        │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
      ┌────────────────────────────────────────────────────────┐
      │  Stage 0: Syntactic Gate (krusch-pre-router)           │
      │  Precedence: deny > custom > structure > lexical > kw  │
      │  Default Preset:   structure (zero linguistic drift)   │
      │  Cold Regex Stack: ~ 3.5 µs (CPU syntax scan)          │
      │  LRU Memo Table:   ~ 4.6 µs (Hits-only exact match)    │
      │  Cost:             $0.00 (0 tokens, 0 network hops)    │
      └───────┬────────────────────────────────────────┬───────┘
              │                                        │
    High-Confidence Fast-Path                Gate Miss / Unstructured / Deny
    (Code Fences, SQL, LaTeX, FEN Moves)     (Chat, Clinical, Nuanced Semantics)
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

## ⚠️ Breaking Default Notice & Migration (v1.0.0)

> [!WARNING]
> **Breaking Default**: The default preset in `v1.0.0` is **`structure`** (ultra-conservative, raw structural syntax only). Natural language phrasings like *"Write a Python function to reverse a string"* or *"Analyze the 10-K balance sheet"* now miss cleanly to Stage-1/L2 by default to eliminate heuristic drift.

To restore previous behavior, configure the one-line preset:

* **Restoring `anchors-only` era behavior** (restores code/finance/STEM/RC domain phrases without trivia):
  ```typescript
  const router = createPreRouter({ preset: 'structure+lexical' });
  ```
* **Restoring early README / keyword-era behavior** (restores translations, unit conversions, and trivia keywords):
  ```typescript
  const router = createPreRouter({ preset: 'structure+lexical+keywords' });
  ```

---

## 🏛️ The Three Catalog Layers

| Layer | Rules Included | Drift Risk | Preset Option | Examples |
|---|---|---|---|---|
| **`structure`** | Code fences, SQL statements, LaTeX macros, stack traces, FEN/PGN regex | **Zero** | **`structure` (Default)** | ```` ```python\ndef f(): pass\n``` ````, `SELECT * FROM tbl`, `\frac{a}{b}`, `1. e4 e5` |
| **`lexical-domain`** | Soft phrasing: "write a function", 10-K/EBITDA, reading comprehension markers | Low | **`structure+lexical`** | *"Based on the passage...", "Write a Go function..."* |
| **`keywords`** | Translation, geography, trivia, closed-world transformations | Moderate | **`structure+lexical+keywords`** (or `all`) | *"Translate to Spanish", "Convert 50F to C"* |

---

## 📦 Installation

Directly from GitHub (recommended for git-pinned tags):
```bash
npm install github:kruschdev/krusch-pre-router#v1.0.0
```

Or from local checkout:
```bash
npm install ../path/to/krusch-pre-router
```

> **Requirements**: Zero runtime dependencies. ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) exports with full TypeScript definitions (`.d.ts`). Tested across Node 18, 20, 22, Bun, Deno, and Edge runtimes.

---

## 🛡️ Core Invariants & Safety Guarantees

### 1. Ultra-Conservative Default (`preset: 'structure'`)
Heuristic natural language matching drifts over time. In `structure` mode:
* Only unambiguous syntactic structures fast-path.
* Pure conversational queries, ambiguous NL questions, and metaphorical language cleanly miss to Stage-1 L2 routing.

### 2. Strict Total Precedence Order
Rule evaluation strictly follows a verified total order:
```
deny (0) > custom (10) > structure (20-24) > lexical (30-34) > keywords (40-50) > miss (99)
```
* **Clinical & Legal Deny List (Precedence 0)**: Queries describing acute clinical emergencies (e.g., crushing chest pain), medical pharmacology / drug dosing (e.g., vancomycin dosing, pediatric titration), or legal liability strictly trigger the top-level deny list.
* **Deny ∩ Fence Golden Guarantee**: Fenced code containing clinical emergency or dosing instructions (e.g. ```` ```python\n# pediatric dosage of vancomycin... ````) **strictly emits `reason: 'deny'`**, preventing code rules from bypassing safety guardrails.
* **Code-over-Games Invariant**: Programming instructions involving chess (e.g., *"Write a Python script to parse a chess PGN"*) route to `code`, never `games_spatial`.

### 3. Hits-Only Memoization (No Miss Lock-in)
* `PreRouteCache` defaults to **`cachePolicy: 'hits'`**: Only fast-pathed queries (`isFastPath: true`) are memoized.
* Cache keys automatically prefix the rule version and preset: `[v${rulesVersion}:${preset}][${namespace}]${key}`, ensuring that rule deployments immediately invalidate previous memoized entries.

### 4. Message-Aware Classification (Tool Noise Invariance)
When passing `Message[]`, `classifyPreRoute` defaults to **`messageScope: 'last_user'`**. Tool crashes, API error logs, or stack traces emitted by previous assistant/tool turns will **not** cause false-positive fast-paths on conversational user queries.

### 5. ReDoS Safety Budget
Every pattern in the catalog is tested in CI against 8KB adversarial inputs (repeated backtick runs, trailing whitespace, nested brackets) under a strict **2ms execution budget**.

---

## 🚀 Usage

### 1. In-Process Pre-Router (Microsecond Hot Path)

```typescript
import { createPreRouter } from 'krusch-pre-router';

// In-process LRU memoization table (<5µs hit, <4µs cold regex scan)
const router = createPreRouter({
  cache: { maxSize: 2000 }
});

function handleRequest(prompt: string) {
  // Synchronous, non-blocking Stage-0 classification
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

### 2. Distributed Memoization with `classifyAsync`

For multi-instance swarms sharing an external cache (Redis, Cloudflare KV):

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
    await redis.set(`pre-router:${key}`, JSON.stringify(result), 'EX', 3600);
  },
  async has(key: string): Promise<boolean> {
    return (await redis.exists(`pre-router:${key}`)) === 1;
  }
};

const router = createPreRouter({ adapter: redisAdapter });

// classifyAsync checks L1 in-process LRU -> awaits L2 Redis -> runs cold classifier -> re-hydrates L1
const route = await router.classifyAsync('SELECT * FROM users;');
```

> **Note**: Synchronous `router.classify()` checks in-process memory and synchronous adapters only; it will never block the Node.js event loop waiting on remote network I/O. Use `router.classifyAsync()` when remote Redis round-trips are desired.

### 3. Explainable Classification Contract

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
//   ruleId: 'structure:code_fence',
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

## 📊 Production Telemetry & Audit Tap

`createPreRouter` provides a non-blocking `onRoute` tap for distributed logging, observability, and Stage-0 audit loops:
* **Schema-Stable `v1` Event Format** (`version: '1'`, `ruleId`, `reason`, `rulesVersion`).
* **Prompt Length Truncation (Not PII Sanitization)**: Unless `includeFullPrompt: true` is passed, telemetry events truncate prompts to a 100-character snippet (`promptSnippet`) and character count (`promptLength`) to protect downstream log aggregators from bloat.  
  > [!NOTE]  
  > Snippet truncation is length mitigation, **not complete PII/HIPAA sanitization** (PII like email addresses, API tokens, or names can easily fit inside 100 characters). Environments requiring strict compliance must scrub prompts prior to logging.
* **Sampling Rate**: Set `sampleRate: 0.1` to log only 10% of traffic in high-throughput swarms.
* **Crash-Resilience**: Telemetry callback exceptions are caught and swallowed, ensuring zero routing disruption even if external loggers fail.

```typescript
const router = createPreRouter({
  namespace: 'customer-gateway',
  sampleRate: 0.25, // Sample 25% of requests
  onRoute: (event) => {
    // Ship to Datadog, BigQuery, OpenTelemetry, or audit JSONL
    auditLogger.emit({
      v: event.version,
      ruleId: event.ruleId,
      reason: event.reason,
      fromCache: event.fromCache,
      promptSnippet: event.promptSnippet,
      promptLength: event.promptLength,
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
| **Cold Regex Heuristic** (`classifyPreRoute`) | Full priority-ordered CPU regex stack scan | **4.32 µs** | **3.51 µs** | 6.34 µs | 13.97 µs | **~220,000 ops/sec** |
| **Warm LRU Memo Hit** (`router.classify`) | In-memory Map lookup + defensive clone (Hits only) | **5.45 µs** | **4.65 µs** | 9.66 µs | 17.03 µs | **~180,000 ops/sec** |

### Test Suite Coverage (32/32 tests passing):
* **Calibrated Fixtures (100 prompts)**: 100.0% pass rate on domain regression suite (`structure+lexical`).
* **Conservative Preset Isolation**: Proves that default `structure` preset cleanly yields conversational and ambiguous domain phrasings to L2.
* **OOD Adversarial Traps (126 prompts)**: Clean L2 delegation rate: **100.0% (126/126)**, Wrong-Specialist Rate (FPR): **0.0%**.
* **Deny ∩ Fence Guarantee**: Code fences containing clinical emergencies or pharmacology dosing strictly trigger `reason: 'deny'`, overriding code rules.
* **Message Scoping (`last_user`)**: Tool crashes and assistant stack traces in message history do not contaminate user intent classification.
* **Cache Invalidation & Isolation**: Cache keys invalidate across `RULES_VERSION` bumps; namespaces isolate multi-tenant routers.
* **Bounded Regex Linear Audit**: Proves every rule in `RULE_CATALOG` executes in `<2ms` on worst-case 8KB adversarial inputs.

---

## 📄 License

MIT © [Kevin Krusch](https://github.com/kruschdev)
