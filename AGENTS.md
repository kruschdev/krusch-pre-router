# Krusch Pre-Router — Agent Operating Manual (`AGENTS.md`)

> **Core Role**: Deterministic Stage-0 Syntactic Gate & Exact-Match LRU Memoization Table (`projects/krusch-pre-router`). Zero runtime dependencies, `<10 KB` gzipped (`<35 KB` raw), microsecond CPU classification (`<15µs`), `$0.00` routing tax.

---

## 🛠️ 3-Tier MCP Integration

1. **Session Start (`krusch-context-mcp`)**:
   ```javascript
   krusch_context_retrieve({ query: "pre-router fast path cache ood", include_state: true, limit_tokens: 3500 });
   ```
2. **AST Blast Radius (`krusch-git`)**:
   - Inspect symbol definitions and inbound callers before modifying exports:
     `krusch_git_search_symbols({ repo: "krusch-pre-router", query: "<symbol>" })`
     `krusch_git_dependency_graph({ repo: "krusch-pre-router", symbol: "<symbol>" })`
   - Re-index after code changes:
     `cd ../krusch-git && SKIP_LLM_SUMMARY=true node scripts/sync_to_pg.js ../krusch-pre-router`
3. **Pre-Commit Audit & Memory Lineage (`krusch-context-mcp`)**:
   - Audit diffs before committing: `krusch_context_nudge({ trigger: "pre_commit", code: "<diff>" })`
   - Persist new benchmarks or invariants: `krusch_context_remember({ category: "decision|invariant|lesson", content: "..." })`
   - Supersede obsolete rules: `krusch_context_revise({ action: "supersede", target_id: <id>, new_content: "...", reason: "..." })`

---

## ⚡ Build, Test & Benchmark Commands

- **Build**: `npm run build` (`tsup` generates ESM and CJS bundles in `dist/`)
- **Test**: `npm test` (Runs all 17 unit, holdout, and OOD wrong-specialist evaluation suites)
- **Benchmark**: `npm run bench` (Microsecond CPU benchmark with percentile latencies)
- **Harvest OOD**: `npm run harvest:ood -- <path-to-logs.jsonl>` (Harvests Stage-0 false-positive traps from logs into `ood-prompts.json`)

---

## 📌 Core Invariants (`INV-PR-01` – `INV-PR-06`)

1. **Miss Semantics (`INV-PR-01`)**: Prompts lacking deterministic domain signals MUST return `isFastPath: false` and `role: undefined`. Never fall back to `'factual_stem'` or any specialist role on an ambiguous miss.
2. **Defensive Cloning (`INV-PR-02`)**: `PreRouteCache` and `createPreRouter` must clone results on `get()` and `set()` so caller mutations never corrupt cached entries.
3. **Key Normalization (`INV-PR-03`)**: `PreRouteCache.normalizeKey()` handles both `string` and `Message[]`, preserving message roles (`${role}:${content}`) to prevent conversation collisions.
4. **Cache Isolation (`INV-PR-04`)**: `PreRouteCache` supports an optional `namespace` prefix to prevent collisions across multi-tenant router instances.
5. **Telemetry Resilience (`INV-PR-05`)**: `onRoute` telemetry callbacks are non-blocking and wrapped in `try/catch` so logger/disk failures never disrupt classification.
6. **Local Context Store (`INV-PR-06`)**: Per-project SQLite working memory resides at `.agent/context.db` (gitignored).
