export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | (string & {});
  content: string;
}

export type DefaultSpecialistRole = 
  | 'general_fast'     // Fast generalist (translation, geography, open-ended trivia, narrative)
  | 'factual_stem'     // Factual & STEM (scientific knowledge, arithmetic, formal mathematics)
  | 'code'             // Code specialist (code generation, syntax analysis, debugging, refactoring)
  | 'reasoning_deep'   // Deep analytical reasoning (financial filings, formal proofs, economics)
  | 'games_spatial'    // Spatial & discrete state engines (chess, board games, FEN/PGN evaluation)
  | 'comprehension_rc';// Grounded reading comprehension (passage analysis, document Q&A)

/**
 * Specialist domain role. Defaults to the 6 core archetypes, while
 * supporting arbitrary custom domain strings via customSpecialistRules.
 */
export type SpecialistRole = DefaultSpecialistRole | (string & {});

export interface CustomSpecialistRule<TRole extends string = string> {
  role: TRole;
  pattern: RegExp;
  id?: string;
}

export type PreRouteReason = 
  | 'deny'
  | 'custom'
  | 'fence'
  | 'sql'
  | 'latex'
  | 'code_syntax'
  | 'stack_trace'
  | 'fen'
  | 'chess_move'
  | 'comprehension'
  | 'deep_reasoning'
  | 'keyword'
  | 'closed_world'
  | 'miss';

export type RulePreset = 'anchors-only' | 'anchors+keywords';

export type MessageScope = 'last_user' | 'all';

export interface ScanWindowMeta {
  startChars: number;
  endChars: number;
  totalChars: number;
  truncated: boolean;
}

export interface PreRouteResult<TRole extends string = string> {
  isFastPath: boolean;
  role?: DefaultSpecialistRole | TRole;
  confidence: 'high' | 'borderline' | 'unstructured';
  complexityScore: number;
  suggestedAction: 'dispatch_specialist' | 'delegate_to_l2';
  reason: PreRouteReason;
  ruleId?: string;
  scanWindowUsed: ScanWindowMeta;
  rulesVersion: number;
}

export interface ClassifierOptions<TRole extends string = string> {
  preset?: RulePreset; // Default: 'anchors-only'
  messageScope?: MessageScope; // Default: 'last_user'
  lengthThreshold?: number; // String length, not tokens, for speed. Default 2000.
  customRules?: RegExp[]; // Custom Regex patterns to mark a prompt as complex
  customSpecialistRules?: CustomSpecialistRule<TRole>[]; // Custom regex overrides for specialist routing
  prunePreRouting?: boolean; // If true, clean conversational filler and whitespace before length evaluation
  knowledgeBoundaryGating?: boolean; // If true, evaluate closed-world queries (only in anchors+keywords or detection)
}

export type CachePolicy = 'hits' | 'all';

export interface CacheOptions {
  maxSize?: number; // Maximum entries in the LRU cache (default: 1000)
  namespace?: string; // Optional namespace prefix to isolate keys across routers/tenants
  cachePolicy?: CachePolicy; // 'hits' (default) caches only isFastPath: true; 'all' caches misses too
  rulesVersion?: number; // Explicit rules version override for key hashing
  ttlMs?: number; // Optional TTL expiration in milliseconds
}

/**
 * Pluggable Cache Adapter Interface for external stores (Redis, Cloudflare KV, Memcached).
 * Allows composing remote/distributed memoization without forking PreRouteCache.
 */
export interface CacheAdapter<TRole extends string = SpecialistRole> {
  get(key: string): PreRouteResult<TRole> | undefined | Promise<PreRouteResult<TRole> | undefined>;
  set(key: string, result: PreRouteResult<TRole>): void | Promise<void>;
  has(key: string): boolean | Promise<boolean>;
  delete?(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export interface RouteTelemetry<TRole extends string = SpecialistRole> {
  version: '1';
  timestamp: number;
  prompt: Message[] | string;
  result: PreRouteResult<TRole>;
  fromCache: boolean;
  namespace?: string;
  ruleId?: string;
  reason: PreRouteReason;
  rulesVersion: number;
  promptLength: number;
  promptSnippet?: string;
}

export interface PreRouterOptions<TRole extends string = SpecialistRole> extends ClassifierOptions<TRole> {
  cache?: boolean | CacheOptions;
  namespace?: string;
  cachePolicy?: CachePolicy;
  adapter?: CacheAdapter<TRole>;
  onRoute?: (telemetry: RouteTelemetry<TRole>) => void;
  sampleRate?: number; // Telemetry sampling rate between 0.0 and 1.0 (default 1.0)
  includeFullPrompt?: boolean; // If false (default), telemetry truncates/redacts prompt to avoid PII leak
}

export interface PreRouter<TRole extends string = SpecialistRole> {
  classify(messages: Message[] | string): PreRouteResult<TRole>;
  cache: PreRouteCache<TRole> | null;
  adapter?: CacheAdapter<TRole>;
  clearCache(): void;
}

// Re-export PreRouteCache type signature for PreRouter
import type { PreRouteCache } from './cache.js';
