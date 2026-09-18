import { classifyPreRoute, PreRouteResult, ClassifierOptions, Message } from './classifier.js';

export interface RouteTelemetry {
  prompt: Message[] | string;
  result: PreRouteResult;
  fromCache: boolean;
  namespace?: string;
  timestamp: number;
}

export interface CacheOptions {
  maxSize?: number; // Maximum entries in the LRU cache (default: 1000)
  namespace?: string; // Optional namespace prefix to isolate keys across routers/tenants
}

/**
 * High-performance, zero-dependency in-memory LRU cache for prompt classifications.
 * Provides < 1 microsecond O(1) lookups for identical or template-derived prompts.
 */
export class PreRouteCache {
  private readonly maxSize: number;
  private readonly _namespace?: string;
  private readonly cache: Map<string, PreRouteResult>;

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

  public get(prompt: Message[] | string): PreRouteResult | undefined {
    const key = this.normalizeKey(prompt);
    const item = this.cache.get(key);
    if (!item) return undefined;

    // Refresh LRU order (delete and re-insert at the end of the Map)
    this.cache.delete(key);
    this.cache.set(key, item);
    return { ...item };
  }

  public set(prompt: Message[] | string, result: PreRouteResult): void {
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

export interface PreRouterOptions extends ClassifierOptions {
  cache?: boolean | CacheOptions;
  namespace?: string;
  onRoute?: (telemetry: RouteTelemetry) => void;
}

export interface PreRouter {
  classify(messages: Message[] | string): PreRouteResult;
  cache: PreRouteCache | null;
  clearCache(): void;
}

/**
 * Creates an L1 Pre-Router instance configured with an optional LRU cache,
 * non-blocking telemetry tap, and custom routing heuristics.
 */
export function createPreRouter(options?: PreRouterOptions): PreRouter {
  const enableCache = options?.cache !== false;
  const cacheOptions: CacheOptions | undefined = typeof options?.cache === 'object'
    ? { namespace: options?.namespace, ...options.cache }
    : (options?.namespace ? { namespace: options.namespace } : undefined);

  const cache = enableCache 
    ? new PreRouteCache(cacheOptions)
    : null;

  return {
    cache,
    classify(messages: Message[] | string): PreRouteResult {
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
