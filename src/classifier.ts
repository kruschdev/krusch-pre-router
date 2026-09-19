import {
  Message,
  DefaultSpecialistRole,
  SpecialistRole,
  CustomSpecialistRule,
  PreRouteResult,
  PreRouteReason,
  RulePreset,
  MessageScope,
  ScanWindowMeta,
  ClassifierOptions
} from './types.js';

import {
  RULES_VERSION,
  MAX_PRE_ROUTE_SCAN_CHARS,
  DENY_RULES,
  STRUCTURE_RULES,
  LEXICAL_RULES,
  ANCHOR_RULES,
  KEYWORD_RULES,
  RULE_CATALOG,
  matchCatalogRule
} from './catalog.js';

export {
  Message,
  DefaultSpecialistRole,
  SpecialistRole,
  CustomSpecialistRule,
  PreRouteResult,
  PreRouteReason,
  RulePreset,
  MessageScope,
  ScanWindowMeta,
  ClassifierOptions,
  RULES_VERSION,
  MAX_PRE_ROUTE_SCAN_CHARS,
  DENY_RULES,
  STRUCTURE_RULES,
  LEXICAL_RULES,
  ANCHOR_RULES,
  KEYWORD_RULES,
  RULE_CATALOG,
  matchCatalogRule
};

/**
 * Knowledge Boundary Router.
 * Determines if a query represents a self-contained "closed-world" task
 * (e.g. arithmetic, unit conversion, code syntax translation, regex, dictionary lookup)
 * that does not require open-world reasoning and is degraded by cognitive context bloat.
 */
export function detectKnowledgeBoundary(text: string): 'closed' | 'open' {
  if (!text || !text.trim()) return 'open';
  const clean = text.trim().toLowerCase();

  const closedWorldPatterns = [
    /^(?:format|prettify|lint|capitalize|lowercase|reverse)\b/i,
    /^(?:translate)\b[\s\S]{0,60}\b(?:into|to|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english)\b/i,
    /^(?:convert)\s+[\d.]+\s*[a-zA-Z°\s]{1,25}\s+(?:to|into)\s+[a-zA-Z°\s]{1,25}$/i,
    /\b(?:convert\s+\d+\s*(?:miles|km|celsius|fahrenheit|kg|lbs|usd|eur|gbp|meters|feet|inches|cm|gallons|liters)\s+to\s+[a-z]+)\b/i,
    /\b(?:regex|regular expression|json format|csv format|unit conversion|celsius to fahrenheit|miles to km)\b/i,
    /^(?:what is|solve|calculate)\s+[\d\s+\-*/^().=]+[?]?$/i,
    /\b(?:dictionary definition|synonym for|antonym for|spelling of)\b/i
  ];

  for (const pattern of closedWorldPatterns) {
    if (pattern.test(clean)) {
      return 'closed';
    }
  }

  return 'open';
}

/**
 * Lightweight, zero-dependency text cleaner for pre-routing prompt compaction.
 */
export function pruneText(text: string): string {
  if (!text) return '';
  let cleaned = text;
  
  let changed = true;
  while (changed) {
    const before = cleaned;
    cleaned = cleaned
      .replace(/^(?:hey|hello|hi|greetings|dear|please)[,!.\s]+/i, '')
      .replace(/^(?:could you please|can you please|would you kindly|would you please|i want you to|i need you to|tell me|show me)[,!.\s]+/i, '')
      .replace(/\b(?:as we discussed earlier|like i mentioned before|as you know)\b/gi, '')
      .replace(/\b(?:thanks in advance|thank you very much|thank you|thanks|let me know what you think)[.!?\s]*$/gi, '')
      .trim();
    changed = before !== cleaned;
  }

  return cleaned.replace(/\s+/g, ' ').replace(/([?!.,;])\1+/g, '$1').trim();
}

const JSON_OBJECT = /\{[\s\S]*?"[^"\n]+"\s*:\s*[\s\S]*?\}/;

function extractPromptText(messages: Message[] | string, scope: MessageScope = 'last_user'): string {
  if (typeof messages === 'string') {
    return messages;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  if (scope === 'all') {
    return messages.map(m => m.content ?? '').join('\n');
  }

  // default: 'last_user' (isolate user turn from system prompt and assistant/tool output noise)
  const userMsgs = messages.filter(m => m && m.role === 'user' && typeof m.content === 'string');
  if (userMsgs.length > 0) {
    return userMsgs[userMsgs.length - 1].content;
  }

  return messages[messages.length - 1].content ?? '';
}

/**
 * Syntactic payload-density heuristic in [0, 1].
 *
 * Combines prompt length, markup/JSON shape, and a small verb lexicon.
 * This is not cognitive hardness, intent, or an estimate of whether a
 * frontier model is required. Do not use it as an autonomous spend gate.
 */
export function evaluateComplexityScore(messages: Message[] | string, options?: ClassifierOptions): number {
  const lengthThreshold = options?.lengthThreshold || 2000;
  
  let fullText = extractPromptText(messages, options?.messageScope);

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  if (options?.knowledgeBoundaryGating !== false && detectKnowledgeBoundary(fullText) === 'closed' && fullText.length < 500) {
    return 0.15;
  }

  let score = 0.0;
  const lengthRatio = Math.min(1.0, fullText.length / lengthThreshold);
  score += lengthRatio * 0.60;

  const scanText = fullText.length > MAX_PRE_ROUTE_SCAN_CHARS
    ? fullText.slice(0, 4000) + '\n' + fullText.slice(-4000)
    : fullText;

  if (/<\/?([a-z][a-z0-9]*)\b[^>]*>/i.test(scanText)) score += 0.20;
  if (JSON_OBJECT.test(scanText)) score += 0.20;

  if (/\b(compare|contrast|explain why|how does|tradeoffs|pros and cons|difference between)\b/i.test(scanText)) {
    score += 0.25;
  }

  if (/\b(analyze|evaluate|architect|synthesize|speculate|refactor|debug|test|benchmark)\b/i.test(scanText)) {
    score += 0.35;
  }

  if (options?.customRules) {
    for (const rule of options.customRules) {
      if (rule.test(scanText)) {
        score += 0.35;
        break;
      }
    }
  }

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * Fast syntactic heuristic to estimate prompt payload density.
 * Returns true when payload density exceeds a threshold; not a reasoning detector.
 */
export function isComplexPrompt(
  messages: Message[] | string,
  options?: ClassifierOptions,
  threshold = 0.5
): boolean {
  return evaluateComplexityScore(messages, options) >= threshold;
}

/**
 * Deterministic Stage-0 Syntactic Gate.
 * Evaluates in microsecond CPU time whether an incoming prompt has an unambiguous
 * structural syntax footprint suitable for immediate fast-path dispatch, or whether it
 * should delegate to an L2 neural/embedding router or frontier model.
  * Precedence Order:
 *   deny (0) > custom (10) > structure (20-24) > lexical (30-34) > keywords (40-50) > miss (99)
 */
export function classifyPreRoute<TRole extends string = string>(
  messages: Message[] | string,
  options?: ClassifierOptions<TRole>
): PreRouteResult<TRole> {
  const preset: RulePreset = options?.preset ?? 'structure';
  const scope: MessageScope = options?.messageScope ?? 'last_user';

  let fullText = extractPromptText(messages, scope);

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  const complexityScore = evaluateComplexityScore(messages, options);
  const totalChars = fullText.length;

  let scanText: string;
  let scanWindowUsed: ScanWindowMeta;

  if (totalChars > MAX_PRE_ROUTE_SCAN_CHARS) {
    scanText = fullText.slice(0, 4000) + '\n' + fullText.slice(-4000);
    scanWindowUsed = {
      startChars: 4000,
      endChars: 4000,
      totalChars,
      truncated: true
    };
  } else {
    scanText = fullText;
    scanWindowUsed = {
      startChars: totalChars,
      endChars: 0,
      totalChars,
      truncated: false
    };
  }

  // --------------------------------------------------------------------------
  // Rank 0: Deny List (Safety Exclusion Block List)
  // Evaluated before custom rules, code fences, or any syntactic anchors.
  // --------------------------------------------------------------------------
  for (const rule of DENY_RULES) {
    if (matchCatalogRule(rule, scanText)) {
      return {
        isFastPath: false,
        role: undefined,
        confidence: 'unstructured',
        complexityScore,
        suggestedAction: 'delegate_to_l2',
        reason: 'deny',
        ruleId: rule.id,
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }
  }

  // --------------------------------------------------------------------------
  // Rank 10: Custom Specialist Overrides (User-defined domain rules)
  // --------------------------------------------------------------------------
  if (options?.customSpecialistRules && options.customSpecialistRules.length > 0) {
    for (const rule of options.customSpecialistRules) {
      if (rule.pattern.test(scanText)) {
        return {
          isFastPath: true,
          role: rule.role,
          confidence: 'high',
          complexityScore,
          suggestedAction: 'dispatch_specialist',
          reason: 'custom',
          ruleId: rule.id ?? 'custom:rule',
          scanWindowUsed,
          rulesVersion: RULES_VERSION
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // Layer 1: Structural Syntax Rules (Active in ALL presets)
  // Rank 20-25: Code fences, Stack traces, SQL queries, LaTeX, FEN/chess notation
  // --------------------------------------------------------------------------
  for (const rule of STRUCTURE_RULES) {
    if (matchCatalogRule(rule, scanText)) {
      return {
        isFastPath: true,
        role: rule.role!,
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: rule.reason,
        ruleId: rule.id,
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }
  }

  // --------------------------------------------------------------------------
  // Layer 2: Lexical Domain Rules (Rank 30-34)
  // Active in 'structure+lexical', 'structure+lexical+keywords', 'all', and legacy aliases
  // --------------------------------------------------------------------------
  const includeLexical = preset === 'structure+lexical' || preset === 'structure+lexical+keywords' || preset === 'anchors-only' || preset === 'all' || preset === 'anchors+keywords';

  if (includeLexical) {
    for (const rule of LEXICAL_RULES) {
      if (matchCatalogRule(rule, scanText)) {
        return {
          isFastPath: true,
          role: rule.role!,
          confidence: 'high',
          complexityScore,
          suggestedAction: 'dispatch_specialist',
          reason: rule.reason,
          ruleId: rule.id,
          scanWindowUsed,
          rulesVersion: RULES_VERSION
        };
      }
    }
  }

  // --------------------------------------------------------------------------
  // Layer 3: Keyword & Heuristic Rules (Rank 40-50)
  // Active ONLY when preset is 'all' / 'structure+lexical+keywords'
  // --------------------------------------------------------------------------
  const includeKeywords = preset === 'structure+lexical+keywords' || preset === 'all' || preset === 'anchors+keywords';

  if (includeKeywords) {
    for (const rule of KEYWORD_RULES) {
      if (rule.id === 'boundary:closed_world') continue;
      if (matchCatalogRule(rule, scanText)) {
        return {
          isFastPath: true,
          role: rule.role!,
          confidence: 'high',
          complexityScore,
          suggestedAction: 'dispatch_specialist',
          reason: rule.reason,
          ruleId: rule.id,
          scanWindowUsed,
          rulesVersion: RULES_VERSION
        };
      }
    }

    // Knowledge Boundary: Closed-World Transformations
    if (detectKnowledgeBoundary(fullText) === 'closed') {
      return {
        isFastPath: true,
        role: 'general_fast',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'closed_world',
        ruleId: 'boundary:closed_world',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }
  }

  // --------------------------------------------------------------------------
  // Rank 99: Clean Miss Delegation to L2 Neural Router
  // --------------------------------------------------------------------------
  return {
    isFastPath: false,
    role: undefined,
    confidence: complexityScore >= 0.35 && complexityScore <= 0.65 ? 'borderline' : 'unstructured',
    complexityScore,
    suggestedAction: 'delegate_to_l2',
    reason: 'miss',
    ruleId: undefined,
    scanWindowUsed,
    rulesVersion: RULES_VERSION
  };
}

/**
 * Helper to classify prompt with both structure and lexical-domain rules enabled ('structure+lexical' preset).
 */
export function classifyLexical<TRole extends string = string>(
  messages: Message[] | string,
  options?: Omit<ClassifierOptions<TRole>, 'preset'>
): PreRouteResult<TRole> {
  return classifyPreRoute(messages, { ...options, preset: 'structure+lexical' });
}

/**
 * Opt-in helper to classify prompt with full recall ('all' preset: structure + lexical + keywords).
 */
export function classifyKeywords<TRole extends string = string>(
  messages: Message[] | string,
  options?: Omit<ClassifierOptions<TRole>, 'preset'>
): PreRouteResult<TRole> {
  return classifyPreRoute(messages, { ...options, preset: 'all' });
}

/**
 * Classifies a prompt into one of the core domain specialist roles (or custom role).
 * Returns undefined if the prompt lacks deterministic domain signals (miss/delegate to L2).
 */
export function classifySpecialistRole<TRole extends string = string>(
  messages: Message[] | string, 
  options?: ClassifierOptions<TRole>
): (DefaultSpecialistRole | TRole) | undefined {
  const result = classifyPreRoute(messages, options);
  return result.isFastPath ? result.role : undefined;
}
