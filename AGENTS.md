# AGENTS.md — krusch-pre-router

> Deterministic Regex Pre-Router & In-Memory Memoization Table for LLM Swarms.
> Zero runtime dependencies. <20KB bundle size. Microsecond CPU classification & LRU memoization. $0.00 routing tax.

---

## 🧠 Sovereign Context Protocol (`krusch-context-mcp`)

This project is indexed by and integrated with **`krusch-context-mcp`** for cross-session working memory, AST symbol grounding, and persistent steering conventions.

### Standard Tool Calling Lifecycle

#### 1. At Start of Work / New Session
Call `krusch_context_retrieve` with `include_state: true` to hydrate project state alongside codebase context in a single turn:
```javascript
krusch_context_retrieve({
  query: "<task or technical topic>",
  include_state: true,
  graph_hops: 2,
  limit_tokens: 3500,
  include_code: true
});
```
Or view the compiled state briefing standalone (project is auto-detected):
```javascript
krusch_context_compile_state({});
```

#### 2. Before Non-Trivial Code Modifications
- Check project conventions and steering nuggets:
  ```javascript
  krusch_context_nugget_nudges({ query: "<task context>" });
  ```
- Inspect symbol callers and references using `krusch_context_search_symbols` or `krusch_context_symbol_graph`.

#### 3. When Facts, Benchmarks, or Architecture Change
- **New Milestones / Out-of-Distribution Evals**: Call `krusch_context_add_memory({ category: "outcomes", content: "...", project: "krusch-pre-router" })`.
- **Architectural Conventions**: Call `krusch_context_nugget_remember({ key: "<slug>", value: "...", kind: "project", project: "krusch-pre-router" })`.
- **Superseded Decisions**: Call `krusch_context_supersede_memory({ id: <old_id>, content: "<new_truth>" })`.

#### 4. Refreshing AST Codebase Snapshot
Whenever code or test files change:
```bash
node /home/krusch/homelab/projects/krusch-context-mcp/scripts/snapshot.js /home/krusch/homelab/projects/krusch-pre-router
```

---

## 🛠️ Build, Test & Benchmark Commands

- **Build**: `npm run build` (tsup generates ESM and CJS bundles in `dist/`)
- **Test**: `npm test` (Runs all 17 unit, holdout, and OOD wrong-specialist evaluation suites)
- **Benchmark**: `npm run bench` (Microsecond benchmark with hardware telemetry and percentile latencies)
- **Harvest OOD**: `npm run harvest:ood -- <path-to-logs.jsonl>` (Harvests Stage-0 false-positive traps from production logs into `ood-prompts.json`)

---

## 📌 Core Invariants

1. **Miss Semantics**: Prompts lacking deterministic domain signals MUST return `isFastPath: false` and `role: undefined`. Never fallback to `'factual_stem'` or any specialist role.
2. **Defensive Cloning**: `PreRouteCache` and `createPreRouter` must clone results on `get()` and `set()` so caller mutations do not corrupt cached results.
3. **Key Normalization**: `PreRouteCache.normalizeKey()` handles both `string` and `Message[]`. For `Message[]`, it preserves message roles (`${role}:${content}`) to prevent conversation collisions.
4. **Cache Isolation**: `PreRouteCache` supports an optional `namespace` prefix to prevent collisions when multiple routers or tenant profiles share a cache instance.
5. **Telemetry Resilience**: `onRoute` telemetry callbacks are non-blocking and isolated in `try/catch` so logger/disk failures never disrupt prompt classification.
6. **Local Lakebase Storage**: Per-project SQLite memory is located at `.agent/memory.db` and is ignored by git.
