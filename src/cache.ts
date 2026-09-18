import { classifyPreRoute, PreRouteResult, ClassifierOptions, Message } from './classifier.js';

export interface CacheOptions {
  maxSize?: number; // Maximum entries in the LRU cache (default: 1000)
}

/**
 * High-performance, zero-dependency in-memory LRU cache for prompt classifications.
 * Provides < 1 microsecond O(1) lookups for identical or template-derived prompts.
 */
export class PreRouteCache {
  private readonly maxSize: number;
  private readonly cache: Map<string, PreRouteResult>;

  constructor(options?: CacheOptions) {
    this.maxSize = options?.maxSize ?? 1000;
    this.cache = new Map();
  }

  /**
   * Normalizes prompt text or message sequence for resilient cache keying.
   * Preserves message roles and compacts consecutive whitespace.
   */
  public normalizeKey(prompt: Message[] | string): string {
    if (Array.isArray(prompt)) {
      return prompt
        .map(m => `${m.role}:${m.content.trim().replace(/\s+/g, ' ')}`)
        .join('\n');
    }
    return prompt.trim().replace(/\s+/g, ' ');
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
}

export interface PreRouter {
  classify(messages: Message[] | string): PreRouteResult;
  cache: PreRouteCache | null;
  clearCache(): void;
}

/**
 * Creates an L1 Pre-Router instance configured with an optional LRU cache
 * and custom routing heuristics.
 */
export function createPreRouter(options?: PreRouterOptions): PreRouter {
  const enableCache = options?.cache !== false;
  const cache = enableCache 
    ? new PreRouteCache(typeof options?.cache === 'object' ? options.cache : undefined)
    : null;

  return {
    cache,
    classify(messages: Message[] | string): PreRouteResult {
      if (cache) {
        const cached = cache.get(messages);
        if (cached) return cached;
      }

      const result = classifyPreRoute(messages, options);

      if (cache) {
        cache.set(messages, result);
      }

      return { ...result };
    },
    clearCache(): void {
      cache?.clear();
    }
  };
}
