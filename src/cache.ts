import {
  PreRouteResult,
  ClassifierOptions,
  Message,
  SpecialistRole,
  CacheOptions,
  CacheAdapter,
  RouteTelemetry,
  PreRouterOptions,
  PreRouter,
  CachePolicy,
  RulePreset
} from './types.js';

import { classifyPreRoute } from './classifier.js';
import { RULES_VERSION } from './catalog.js';

export {
  CacheOptions,
  CacheAdapter,
  RouteTelemetry,
  PreRouterOptions,
  PreRouter,
  CachePolicy
};

interface CacheEntry<TRole extends string> {
  result: PreRouteResult<TRole>;
  expiresAt?: number;
}

/**
 * High-performance, zero-dependency in-memory LRU memoization table for prompt classifications.
 * Provides sub-microsecond O(1) lookups for identical, whitespace-normalized prompts.
 *
 * Defaults:
 *   - cachePolicy: 'hits' (Only isFastPath: true results are cached; misses are never cached by default)
 *   - keyPrefix: Invalidation isolation across rulesVersion and preset
 */
export class PreRouteCache<TRole extends string = SpecialistRole> {
  private readonly maxSize: number;
  private readonly _namespace?: string;
  private readonly _cachePolicy: CachePolicy;
  private readonly _rulesVersion: number;
  private readonly _preset: RulePreset;
  private readonly _ttlMs?: number;
  private readonly cache: Map<string, CacheEntry<TRole>>;

  constructor(options?: CacheOptions & { preset?: RulePreset }) {
    this.maxSize = options?.maxSize ?? 1000;
    this._namespace = options?.namespace;
    this._cachePolicy = options?.cachePolicy ?? 'hits';
    this._rulesVersion = options?.rulesVersion ?? RULES_VERSION;
    this._preset = options?.preset ?? 'structure';
    this._ttlMs = options?.ttlMs;
    this.cache = new Map();
  }

  public get namespace(): string | undefined {
    return this._namespace;
  }

  public get cachePolicy(): CachePolicy {
    return this._cachePolicy;
  }

  public get rulesVersion(): number {
    return this._rulesVersion;
  }

  public get preset(): RulePreset {
    return this._preset;
  }

  /**
   * Normalizes prompt text or message sequence for resilient cache keying.
   * Includes rulesVersion, preset, and namespace in key prefix to guarantee
   * cache invalidation when rules or profiles change.
   */
  public normalizeKey(prompt: Message[] | string, namespaceOverride?: string): string {
    let baseKey: string;
    if (Array.isArray(prompt)) {
      baseKey = prompt
        .map(m => `${m.role}:${(m.content ?? '').trim().replace(/\s+/g, ' ')}`)
        .join('\n');
    } else {
      baseKey = (prompt ?? '').trim().replace(/\s+/g, ' ');
    }

    const ns = namespaceOverride ?? this._namespace;
    const prefix = `[v${this._rulesVersion}:${this._preset}]${ns ? `[${ns}]` : ''}`;
    return `${prefix}${baseKey}`;
  }

  public get(prompt: Message[] | string): PreRouteResult<TRole> | undefined {
    const key = this.normalizeKey(prompt);
    const item = this.cache.get(key);
    if (!item) return undefined;

    // Check TTL expiration
    if (item.expiresAt !== undefined && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU order (delete and re-insert at the end of the Map)
    this.cache.delete(key);
    this.cache.set(key, item);

    return {
      ...item.result,
      scanWindowUsed: { ...item.result.scanWindowUsed }
    };
  }

  public set(prompt: Message[] | string, result: PreRouteResult<TRole>): void {
    // Under default 'hits' policy, do not memoize misses to avoid stale misses on rule updates
    if (this._cachePolicy === 'hits' && !result.isFastPath) {
      return;
    }

    const key = this.normalizeKey(prompt);

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest entry (the first item in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    const expiresAt = this._ttlMs ? Date.now() + this._ttlMs : undefined;
    this.cache.set(key, {
      result: {
        ...result,
        scanWindowUsed: { ...result.scanWindowUsed }
      },
      expiresAt
    });
  }

  public has(prompt: Message[] | string): boolean {
    const key = this.normalizeKey(prompt);
    const item = this.cache.get(key);
    if (!item) return false;

    if (item.expiresAt !== undefined && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}

/**
 * Creates a Stage-0 Pre-Router instance configured with an optional LRU cache,
 * pluggable cache adapter, non-blocking sampled telemetry tap, and rule heuristics.
 */
export function createPreRouter<TRole extends string = SpecialistRole>(
  options?: PreRouterOptions<TRole>
): PreRouter<TRole> {
  const enableCache = options?.cache !== false;
  const preset: RulePreset = options?.preset ?? 'structure';
  const cachePolicy: CachePolicy = options?.cachePolicy ?? (
    typeof options?.cache === 'object' && options.cache.cachePolicy ? options.cache.cachePolicy : 'hits'
  );

  const cacheOptions: CacheOptions & { preset?: RulePreset } | undefined = typeof options?.cache === 'object'
    ? { namespace: options?.namespace, cachePolicy, preset, ...options.cache }
    : { namespace: options?.namespace, cachePolicy, preset };

  const cache = enableCache 
    ? new PreRouteCache<TRole>(cacheOptions)
    : null;

  const adapter = options?.adapter;
  const sampleRate = options?.sampleRate ?? 1.0;

  function dispatchTelemetry(prompt: Message[] | string, result: PreRouteResult<TRole>, fromCache: boolean): void {
    if (!options?.onRoute) return;

    // Apply sampling
    if (sampleRate < 1.0 && Math.random() > sampleRate) {
      return;
    }

    try {
      const rawText = Array.isArray(prompt)
        ? prompt.map(m => m.content ?? '').join('\n')
        : (prompt ?? '');
      
      const promptLength = rawText.length;
      const snippet = rawText.slice(0, 100) + (rawText.length > 100 ? '...' : '');

      const telemetryPrompt = options.includeFullPrompt 
        ? prompt 
        : (typeof prompt === 'string' ? snippet : [{ role: 'user', content: snippet }]);

      options.onRoute({
        version: '1',
        timestamp: Date.now(),
        prompt: telemetryPrompt,
        result: {
          ...result,
          scanWindowUsed: { ...result.scanWindowUsed }
        },
        fromCache,
        namespace: options.namespace ?? cache?.namespace,
        ruleId: result.ruleId,
        reason: result.reason,
        rulesVersion: result.rulesVersion,
        promptLength,
        promptSnippet: snippet
      });
    } catch {
      // Non-blocking: swallow telemetry listener errors so pre-router execution is never interrupted
    }
  }

  return {
    cache,
    adapter,
    classify(messages: Message[] | string): PreRouteResult<TRole> {
      // 1. Check in-process LRU cache
      if (cache) {
        const cached = cache.get(messages);
        if (cached) {
          dispatchTelemetry(messages, cached, true);
          return cached;
        }
      }

      // 2. Check external cache adapter (sync handling only; remote async requires classifyAsync)
      if (adapter) {
        const key = Array.isArray(messages)
          ? messages.map(m => `${m.role}:${m.content}`).join('\n')
          : messages;

        try {
          const adapterResult = adapter.get(key);
          if (adapterResult && typeof (adapterResult as any).then !== 'function') {
            const syncResult = adapterResult as PreRouteResult<TRole>;
            if (syncResult) {
              if (cache) {
                cache.set(messages, syncResult);
              }
              dispatchTelemetry(messages, syncResult, true);
              return {
                ...syncResult,
                scanWindowUsed: { ...syncResult.scanWindowUsed }
              };
            }
          }
        } catch {
          // Swallow adapter check errors and fall through to cold classification
        }
      }

      // 3. Cold syntactic classification
      const result = classifyPreRoute(messages, options);

      // 4. Memoize according to cachePolicy
      if (cache) {
        cache.set(messages, result);
      }

      if (adapter && (cachePolicy === 'all' || result.isFastPath)) {
        const key = Array.isArray(messages)
          ? messages.map(m => `${m.role}:${m.content}`).join('\n')
          : messages;
        try {
          adapter.set(key, result);
        } catch {
          // Swallow adapter store errors
        }
      }

      // 5. Emit non-blocking telemetry
      dispatchTelemetry(messages, result, false);

      return {
        ...result,
        scanWindowUsed: { ...result.scanWindowUsed }
      };
    },
    async classifyAsync(messages: Message[] | string): Promise<PreRouteResult<TRole>> {
      // 1. Check in-process LRU cache (0 network I/O)
      if (cache) {
        const cached = cache.get(messages);
        if (cached) {
          dispatchTelemetry(messages, cached, true);
          return cached;
        }
      }

      // 2. Check external cache adapter (awaiting remote Promise)
      if (adapter) {
        const key = Array.isArray(messages)
          ? messages.map(m => `${m.role}:${m.content}`).join('\n')
          : messages;

        try {
          const adapterResult = await adapter.get(key);
          if (adapterResult) {
            const hitResult: PreRouteResult<TRole> = {
              ...adapterResult,
              scanWindowUsed: { ...adapterResult.scanWindowUsed }
            };
            // Populate in-process LRU cache
            if (cache) {
              cache.set(messages, hitResult);
            }
            dispatchTelemetry(messages, hitResult, true);
            return hitResult;
          }
        } catch {
          // Swallow adapter errors and fall through to cold classification
        }
      }

      // 3. Cold syntactic classification
      const result = classifyPreRoute(messages, options);

      // 4. Memoize according to cachePolicy
      if (cache) {
        cache.set(messages, result);
      }

      if (adapter && (cachePolicy === 'all' || result.isFastPath)) {
        const key = Array.isArray(messages)
          ? messages.map(m => `${m.role}:${m.content}`).join('\n')
          : messages;
        try {
          await adapter.set(key, result);
        } catch {
          // Swallow adapter store errors
        }
      }

      // 5. Emit non-blocking telemetry
      dispatchTelemetry(messages, result, false);

      return {
        ...result,
        scanWindowUsed: { ...result.scanWindowUsed }
      };
    },
    clearCache(): void | Promise<void> {
      cache?.clear();
      if (adapter?.clear) {
        const res = adapter.clear();
        if (res && typeof (res as any).then === 'function') {
          return res;
        }
      }
    }
  };
}
