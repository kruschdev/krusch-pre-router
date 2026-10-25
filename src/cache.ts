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

const ALLOWED_CACHE_POLICIES: readonly CachePolicy[] = ['hits', 'all'];
const ALLOWED_RULE_PRESETS: readonly RulePreset[] = [
  'structure',
  'structure+lexical',
  'structure+lexical+keywords',
  'all',
  'anchors-only',
  'anchors+keywords'
];

/**
 * Exact-match LRU memoization of whitespace-normalized strings. Not a semantic cache.
 * Hits-only by default; keys include rulesVersion and preset.
 * Provides sub-microsecond O(1) lookups for identical prompts.
 */
export class PreRouteCache<TRole extends string = SpecialistRole> {
  private readonly maxSize: number;
  private readonly _namespace?: string;
  private readonly _cachePolicy: CachePolicy;
  private readonly _rulesVersion: number;
  private readonly _preset: RulePreset;
  private readonly _ttlMs?: number;
  private readonly cache: Map<string, CacheEntry<TRole>>;

  /**
   * @param options Optional cache configuration:
   *  - `maxSize`: positive integer maximum LRU capacity (default: 1000)
   *  - `namespace`: alphanumeric/underscore/hyphen key isolation prefix
   *  - `cachePolicy`: `'hits' | 'all'` (default: `'hits'`)
   *  - `rulesVersion`: non-negative integer rules catalog version
   *  - `preset`: one of `'structure' | 'structure+lexical' | 'structure+lexical+keywords' | 'all' | 'anchors-only' | 'anchors+keywords'`
   *  - `ttlMs`: positive integer TTL in milliseconds
   */
  constructor(options?: CacheOptions & { preset?: RulePreset }) {
    this.maxSize = options?.maxSize ?? 1000;
    if (!Number.isInteger(this.maxSize) || this.maxSize <= 0) {
      throw new Error('maxSize must be a positive integer');
    }
    this._namespace = options?.namespace;
    if (this._namespace !== undefined && !/^[a-zA-Z0-9_-]+$/.test(this._namespace)) {
      throw new Error('Invalid namespace format: must match /^[a-zA-Z0-9_-]+$/');
    }
    this._cachePolicy = options?.cachePolicy ?? 'hits';
    if (!ALLOWED_CACHE_POLICIES.includes(this._cachePolicy)) {
      throw new Error('Invalid cachePolicy value');
    }
    this._rulesVersion = options?.rulesVersion ?? RULES_VERSION;
    if (!Number.isInteger(this._rulesVersion) || this._rulesVersion < 0) {
      throw new Error('Invalid rulesVersion value');
    }
    this._preset = options?.preset ?? 'structure';
    if (!ALLOWED_RULE_PRESETS.includes(this._preset)) {
      throw new Error('Invalid preset value');
    }
    this._ttlMs = options?.ttlMs;
    if (this._ttlMs !== undefined && (!Number.isInteger(this._ttlMs) || this._ttlMs <= 0)) {
      throw new Error('Invalid ttlMs value: must be a positive integer');
    }
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

function validatePreRouterOptions<TRole extends string = SpecialistRole>(
  opts?: PreRouterOptions<TRole>
): void {
  if (!opts) return;
  if (opts.preset !== undefined && !ALLOWED_RULE_PRESETS.includes(opts.preset)) {
    throw new Error(
      `Invalid PreRouterOptions: preset must be one of ${ALLOWED_RULE_PRESETS.join(', ')}`
    );
  }
  if (opts.cachePolicy !== undefined && !ALLOWED_CACHE_POLICIES.includes(opts.cachePolicy)) {
    throw new Error(
      `Invalid PreRouterOptions: cachePolicy must be one of ${ALLOWED_CACHE_POLICIES.join(', ')}`
    );
  }
  if (typeof opts.cache === 'object' && opts.cache !== null) {
    if (opts.cache.cachePolicy !== undefined && !ALLOWED_CACHE_POLICIES.includes(opts.cache.cachePolicy)) {
      throw new Error(
        `Invalid PreRouterOptions: cache.cachePolicy must be one of ${ALLOWED_CACHE_POLICIES.join(', ')}`
      );
    }
    if (
      opts.cache.maxSize !== undefined &&
      (!Number.isInteger(opts.cache.maxSize) || opts.cache.maxSize <= 0)
    ) {
      throw new Error('Invalid PreRouterOptions: cache.maxSize must be a positive integer');
    }
  }
}

export function buildCache<TRole extends string = SpecialistRole>(
  options?: PreRouterOptions<TRole>
): { cache: PreRouteCache<TRole> | null; cachePolicy: CachePolicy; preset: RulePreset } {
  const enableCache = options?.cache !== false;
  const preset: RulePreset = options?.preset ?? 'structure';
  const cachePolicy: CachePolicy = options?.cachePolicy ?? (
    typeof options?.cache === 'object' && options.cache.cachePolicy ? options.cache.cachePolicy : 'hits'
  );

  const cacheOptions: CacheOptions & { preset?: RulePreset } = typeof options?.cache === 'object'
    ? { namespace: options?.namespace, cachePolicy, preset, ...options.cache }
    : { namespace: options?.namespace, cachePolicy, preset };

  const cache = enableCache ? new PreRouteCache<TRole>(cacheOptions) : null;
  return { cache, cachePolicy, preset };
}

export function wireComponents<TRole extends string = SpecialistRole>(
  options?: PreRouterOptions<TRole>
) {
  return {
    adapter: options?.adapter,
    classifier: options?.classifier ?? classifyPreRoute,
    sampleRate: options?.sampleRate ?? 1.0
  };
}

/**
 * Creates a Stage-0 Pre-Router instance configured with an optional LRU cache,
 * pluggable cache adapter, non-blocking sampled telemetry tap, and rule heuristics.
 */
export function createPreRouter<TRole extends string = SpecialistRole>(
  options?: PreRouterOptions<TRole>
): PreRouter<TRole> {
  validatePreRouterOptions(options);
  const { cache, cachePolicy, preset } = buildCache(options);
  const { adapter, classifier, sampleRate } = wireComponents(options);

  /**
   * Invokes the user-supplied `onError` callback and propagates any exception
   * thrown by the handler to the caller after logging.
   */
  function notifyError(err: unknown, context: 'telemetry' | 'adapter_get' | 'adapter_set'): void {
    if (!options?.onError) return;
    try {
      options.onError(err, context);
    } catch (handlerErr) {
      console.error('[krusch-pre-router] onError handler threw:', handlerErr);
      throw handlerErr;
    }
  }

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
    } catch (err) {
      // Non-blocking: notify optional error observer without interrupting pre-router execution
      notifyError(err, 'telemetry');
    }
  }

  function isPromise<T = unknown>(value: unknown): value is Promise<T> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'then' in value &&
      typeof (value as { then?: unknown }).then === 'function'
    );
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
          if (adapterResult && !isPromise(adapterResult)) {
            const syncResult: PreRouteResult<TRole> = adapterResult;
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
        } catch (err) {
          // Notify optional observer and fall through to cold classification
          notifyError(err, 'adapter_get');
        }
      }

      // 3. Cold syntactic classification
      const result = classifier(messages, options);

      // 4. Memoize according to cachePolicy
      if (cache) {
        cache.set(messages, result);
      }

      if (adapter && (cachePolicy === 'all' || result.isFastPath)) {
        const key = Array.isArray(messages)
          ? messages.map(m => `${m.role}:${m.content}`).join('\n')
          : messages;
        try {
          const maybePromise = adapter.set(key, result);
          if (isPromise(maybePromise)) {
            maybePromise.catch(err => notifyError(err, 'adapter_set'));
          }
        } catch (err) {
          notifyError(err, 'adapter_set');
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
        } catch (err) {
          // Notify optional observer and fall through to cold classification
          notifyError(err, 'adapter_get');
        }
      }

      // 3. Cold syntactic classification
      const result = classifier(messages, options);

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
        } catch (err) {
          notifyError(err, 'adapter_set');
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
        if (isPromise(res)) {
          return res;
        }
      }
    }
  };
}
