import { classifyPreRoute, PreRouteResult, ClassifierOptions, Message, SpecialistRole } from './classifier.js';

export interface RouteTelemetry<TRole extends string = SpecialistRole> {
  prompt: Message[] | string;
  result: PreRouteResult<TRole>;
  fromCache: boolean;
  namespace?: string;
  timestamp: number;
}

export interface CacheOptions {
  maxSize?: number; // Maximum entries in the LRU cache (default: 1000)
  namespace?: string; // Optional namespace prefix to isolate keys across routers/tenants
}

/**
 * High-performance, zero-dependency in-memory LRU memoization table for prompt classifications.
 * Provides sub-microsecond O(1) lookups for identical, whitespace-normalized prompts.
 * Note: This is an exact-match memoizer with defensive copies, NOT a semantic vector cache.
 */
export class PreRouteCache<TRole extends string = SpecialistRole> {
  private readonly maxSize: number;
  private readonly _namespace?: string;
  private readonly cache: Map<string, PreRouteResult<TRole>>;

  constructor(options?: CacheOptions) {
    this.maxSize = options?.maxSize ?? 1000;
    this._namespace = options?.namespace;
    this.cache = new Map();
  }

  public get namespace(): string | undefined {
    return this._namespace;
  }

  /**
   * Normalizes prompt text or message sequence for resilient cache keying.
   * Preserves message roles, compacts consecutive whitespace, and prefixes
   * namespace if configured.
   */
  public normalizeKey(prompt: Message[] | string, namespaceOverride?: string): string {
    let baseKey: string;
    if (Array.isArray(prompt)) {
      baseKey = prompt
        .map(m => `${m.role}:${m.content.trim().replace(/\s+/g, ' ')}`)
        .join('\n');
    } else {
      baseKey = prompt.trim().replace(/\s+/g, ' ');
    }

    const ns = namespaceOverride ?? this._namespace;
    return ns ? `[${ns}]${baseKey}` : baseKey;
  }

  public get(prompt: Message[] | string): PreRouteResult<TRole> | undefined {
    const key = this.normalizeKey(prompt);
    const item = this.cache.get(key);
    if (!item) return undefined;

    // Refresh LRU order (delete and re-insert at the end of the Map)
    this.cache.delete(key);
    this.cache.set(key, item);
    return { ...item };
  }

  public set(prompt: Message[] | string, result: PreRouteResult<TRole>): void {
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

    this.cache.set(key, { ...result });
  }

  public has(prompt: Message[] | string): boolean {
    return this.cache.has(this.normalizeKey(prompt));
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}

export interface PreRouterOptions<TRole extends string = SpecialistRole> extends ClassifierOptions<TRole> {
  cache?: boolean | CacheOptions;
  namespace?: string;
  onRoute?: (telemetry: RouteTelemetry<TRole>) => void;
}

export interface PreRouter<TRole extends string = SpecialistRole> {
  classify(messages: Message[] | string): PreRouteResult<TRole>;
  cache: PreRouteCache<TRole> | null;
  clearCache(): void;
}

/**
 * Creates a Stage-0 Pre-Router instance configured with an optional LRU cache,
 * non-blocking telemetry tap, and custom routing heuristics.
 */
export function createPreRouter<TRole extends string = SpecialistRole>(options?: PreRouterOptions<TRole>): PreRouter<TRole> {
  const enableCache = options?.cache !== false;
  const cacheOptions: CacheOptions | undefined = typeof options?.cache === 'object'
    ? { namespace: options?.namespace, ...options.cache }
    : (options?.namespace ? { namespace: options.namespace } : undefined);

  const cache = enableCache 
    ? new PreRouteCache<TRole>(cacheOptions)
    : null;

  return {
    cache,
    classify(messages: Message[] | string): PreRouteResult<TRole> {
      if (cache) {
        const cached = cache.get(messages);
        if (cached) {
          if (options?.onRoute) {
            try {
              options.onRoute({
                prompt: messages,
                result: { ...cached },
                fromCache: true,
                namespace: options.namespace ?? cache.namespace,
                timestamp: Date.now()
              });
            } catch {
              // Swallow telemetry listener errors so pre-router execution is never interrupted
            }
          }
          return cached;
        }
      }

      const result = classifyPreRoute(messages, options);

      if (cache) {
        cache.set(messages, result);
      }

      if (options?.onRoute) {
        try {
          options.onRoute({
            prompt: messages,
            result: { ...result },
            fromCache: false,
            namespace: options.namespace ?? cache?.namespace,
            timestamp: Date.now()
          });
        } catch {
          // Swallow telemetry listener errors
        }
      }

      return { ...result };
    },
    clearCache(): void {
      cache?.clear();
    }
  };
}
