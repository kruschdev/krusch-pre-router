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
  RULE_CATALOG
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
  RULE_CATALOG
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
 * Continuous complexity scorer [0.0, 1.0].
 * Evaluates message length, analytical indicator verbs, and structural payload markers.
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
 * Fast syntactic heuristic to estimate if a prompt is "simple" or "complex".
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
    for (const pattern of rule.patterns) {
      if (pattern.test(scanText)) {
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
  // Rank 20-24: Code fences, Stack traces, SQL queries, LaTeX, FEN/chess notation
  // --------------------------------------------------------------------------
  const isCodeFence = 
    /```(?!(?:md|markdown|text|plain|txt|prose)\b)[a-zA-Z0-9_#+-]+\b[\s\S]*?```/i.test(scanText) ||
    /```(?:(?!(?:```))[\s\S])*?(?:\b(?:def\s+\w+|function\s+\w+|class\s+\w+|import\s+[\w{}*]+|return\b|console\.log|SELECT\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)|\b(?:const|let|var)\s+\w+\s*=)[\s\S]*?```/i.test(scanText);

  if (isCodeFence) {
    return {
      isFastPath: true,
      role: 'code',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist',
      reason: 'fence',
      ruleId: 'structure:code_fence',
      scanWindowUsed,
      rulesVersion: RULES_VERSION
    };
  }

  const isStackTrace = /(?:Traceback \(most recent call last\)|TypeError:|SyntaxError:|ReferenceError:|NullPointerException|IndexOutOfBoundsException|ModuleNotFoundError:|panic:|Segmentation fault|SIGSEGV|Uncaught Error:)/i.test(scanText);
  if (isStackTrace) {
    return {
      isFastPath: true,
      role: 'code',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist',
      reason: 'stack_trace',
      ruleId: 'structure:stack_trace',
      scanWindowUsed,
      rulesVersion: RULES_VERSION
    };
  }

  const isSql = /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(scanText);
  if (isSql) {
    return {
      isFastPath: true,
      role: 'code',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist',
      reason: 'sql',
      ruleId: 'structure:sql',
      scanWindowUsed,
      rulesVersion: RULES_VERSION
    };
  }

  const isLatex = /(?:\\frac|\\sum|\\sqrt|\\int|\\times|\\pm)/i.test(scanText);
  if (isLatex) {
    return {
      isFastPath: true,
      role: 'factual_stem',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist',
      reason: 'latex',
      ruleId: 'structure:latex_math',
      scanWindowUsed,
      rulesVersion: RULES_VERSION
    };
  }

  const isFen = /(?:[rnbqkp1-8]{1,8}\/){7}[rnbqkp1-8]{1,8}/i.test(scanText);
  const isPgn = /(?:^|[\r\n])\[(?:Event|Site|Date|Round|White|Black|Result)\s+"[^"]*"\]/i.test(scanText);
  const isChessNotation = 
    isFen ||
    isPgn ||
    /\b[a-h][1-8][-x][a-h][1-8]\b/.test(scanText) ||
    /(?:^|[\s(])(?:1\.|[1-9]\d*\.)\s*(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|O-O-O|O-O)/.test(scanText);

  if (isChessNotation) {
    return {
      isFastPath: true,
      role: 'games_spatial',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist',
      reason: isFen ? 'fen' : 'chess_move',
      ruleId: 'structure:chess_fen',
      scanWindowUsed,
      rulesVersion: RULES_VERSION
    };
  }

  // --------------------------------------------------------------------------
  // Layer 2: Lexical Domain Rules (Rank 30-34)
  // Active in 'structure+lexical', 'all', and legacy aliases 'anchors-only', 'anchors+keywords'
  // --------------------------------------------------------------------------
  const includeLexical = preset === 'structure+lexical' || preset === 'structure+lexical+keywords' || preset === 'anchors-only' || preset === 'all' || preset === 'anchors+keywords';

  if (includeLexical) {
    // Rank 30: Grounded Reading Comprehension
    const isReadingComprehension = 
      /\b(?:based on (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|paragraph|historical account|case study)["']?)/i.test(scanText) ||
      /\b(?:according to (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|historical account|case study)["']?)/i.test(scanText) ||
      /\b(?:in (?:the|this)\s+(?:provided|following)?\s*["']?(?:text|passage|article|excerpt|document|paragraph|case study)["']?\s+(?:above|below)?)/i.test(scanText) ||
      /\b(?:in paragraph \d+)\b/i.test(scanText) ||
      /\b(?:summarize (?:the|this)\s+["']?(?:text|passage|article|excerpt|document|chapter|section)["']?)/i.test(scanText) ||
      /\b(?:what does the author (?:mean|state|imply|claim|conclude|suggest|argue))\b/i.test(scanText) ||
      /\b(?:main thesis of the author|author's main argument)\b/i.test(scanText) ||
      /\b(?:from the\s+["']?(?:text|passage|excerpt|article|document)["']?\s+(?:above|below)?)/i.test(scanText) ||
      /\b(?:reading comprehension|comprehension question|evaluate (?:whether|if) (?:the|this) (?:statement|claim|assertion) is (?:true|false|accurate|supported))\b/i.test(scanText) ||
      /\b(?:information provided in (?:the|this)\s+["']?(?:preceding|provided|following)?\s*(?:text|case study|article|passage)["']?)/i.test(scanText);

    if (isReadingComprehension) {
      return {
        isFastPath: true,
        role: 'comprehension_rc',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'comprehension',
        ruleId: 'lexical:reading_comprehension',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }

    // Rank 31: Code Syntax & task phrasing
    const isCodeSyntax = 
      /\b(?:write|create|implement|build|refactor|debug|fix|optimize|convert)\b[\s\S]{0,60}\b(?:code|script|function|class|method|algorithm|api|endpoint|sql query|component|hook|unit test|test suite|decorator|type|interface|database schema|middleware|resolver|generator|(?:ci\/cd|data|etl|build|deployment)\s+pipeline|dockerfile|regex|callback|promise|async\/await|binary search|quicksort|sorting|bfs|dfs|minimax|engine)\b/i.test(scanText) ||
      /\b(?:how (?:do|can) I (?:implement|code|write|program|fix|debug|test|optimize|refactor))\b/i.test(scanText) ||
      /\b(?:fix this (?:code|bug|error|issue|exception|stack trace|syntax|crash|warning))\b/i.test(scanText) ||
      /\b(?:unit test|test suite|test case|pytest|jest|vitest|mocha|cargo test)\b/i.test(scanText) ||
      (/\b(?:typescript|javascript|python|rust|golang|c\+\+|cpp|c#|java|scala|kotlin|swift|ruby|php|react|vue|angular|svelte|next\.js|node\.js|express|fastapi|django|flask|graphql|dockerfile|github actions|kubernetes|k8s|css flexbox|css grid|tailwind|sql query|postgresql|sqlite|redis|mongodb)\b/i.test(scanText) &&
        /\b(?:error|bug|issue|exception|function|class|component|hook|query|schema|type|import|export|install|build|compile|syntax|loop|re-render|memory leak|thread|mutex|deadlock|concurrency|async|await|promise|callback|iterator|package|module|resolver|endpoint|route|layout|generic|workflow|search|sort|algorithm|engine|minimax|implementation)\b/i.test(scanText)) ||
      /\b(?:def\s+[a-zA-Z_]\w*\s*\(|function\s+[a-zA-Z_]\w*\s*\(|const\s+[a-zA-Z_]\w*\s*=|let\s+[a-zA-Z_]\w*\s*=|var\s+[a-zA-Z_]\w*\s*=|fn\s+[a-zA-Z_]\w*\s*\(|func\s+(?:\([a-zA-Z0-9_*\s]+\)\s*)?[a-zA-Z_]\w*\s*\(|class\s+[a-zA-Z_]\w*\s*(?:extends|implements|\{|\:)|public\s+(?:static\s+)?void|import\s+.*\s+from|from\s+.*\s+import|#include\s+<|require\(['"].*['"]\)|package\s+main|console\.log\(|println!|std::|fmt\.Println)\b/.test(scanText) ||
      /\buse[A-Z][a-zA-Z0-9_]+\b/.test(scanText) ||
      /\b(?:generic type|type alias|interface\s+[a-zA-Z_]|struct\s+[a-zA-Z_]|impl\s+[a-zA-Z_]|Arc<Mutex<|RwLock<|flexbox layout|token bucket|lru cache|event emitter|pull request|git commit|git diff)\b/i.test(scanText);

    if (isCodeSyntax) {
      return {
        isFastPath: true,
        role: 'code',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'code_syntax',
        ruleId: 'lexical:code_syntax',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }

    // Rank 32: Chess & Spatial Games (Natural language terms)
    const BARE_CHESS_WORD = /\b(?:chess|checkmate|stalemate|castling|zugzwang)\b/i;
    const CHESS_TRIVIA_EXCLUSION = /\b(?:chess|checkmate|stalemate|castling|zugzwang|sicilian|defense|opening|gambit|endgame)\b/i;
    const CHESS_STRUCTURE_LEXICAL =
      /\b(?:en passant)\b/i.test(scanText) ||
      /\b(?:board position|legal moves|(?:pawn|knight|bishop|rook|queen|king) move)\b/i.test(scanText) ||
      /\b(?:sudoku grid|tic-tac-toe|connect four|gomoku)\b/i.test(scanText);

    const isGamesSpatial = CHESS_STRUCTURE_LEXICAL || (
      BARE_CHESS_WORD.test(scanText) &&
      !/\b(?:history|champion|invented|origin|medieval|olympiad winner)\b/i.test(scanText)
    );

    if (isGamesSpatial) {
      return {
        isFastPath: true,
        role: 'games_spatial',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'chess_move',
        ruleId: 'lexical:chess_spatial',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }

    // Rank 33: Financial Statements & Formal Proofs
    const isDeepReasoning = 
      /\b(?:net income|operating income|operating margin|gross margin|fiscal year|cash flow[s]?|diluted eps|earnings per share|balance sheet|sec filing|10-k|10-q|ebitda|ebit|cagr|amortization|depreciation|discounted cash flow|dcf model|valuation model|p\/e ratio|return on equity|roe|roic|capital expenditure|capex|free cash flow|wacc|working capital|covenant breach)\b/i.test(scanText) ||
      /\b(?:formal (?:deductive )?logic proof|formal mathematical proof|deductive reasoning|proof by contradiction|mathematical proof|game theory|nash equilibrium|prisoner's dilemma|pareto optimal(?:ity|)?|counterfactual analysis|formal logic proof|first-order logic|syllogism proof|grim trigger|tit-for-tat|first fundamental theorem)\b/i.test(scanText);

    if (isDeepReasoning) {
      return {
        isFastPath: true,
        role: 'reasoning_deep',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'deep_reasoning',
        ruleId: 'lexical:deep_reasoning',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }

    // Rank 34: Explicit STEM / Math / Physics
    const isExplicitStem = 
      /(?:equation|theorem|polynomial|integral|derivative|matrix|vector space|logarithm|physics|chemistry|biology|astronomy|thermodynamics|quantum|velocity|voltage|electric current|electrical resistance|resistor|molecule|atom|gravitat\w*|gravity|black hole|calculus|algebra|geometry|trigonometry|logarithmic|exponential|mitochondri\w*|phosphorylation|atp synthesis|photosynthesis|eukaryot\w*|orbital|fluid flow|navier-stokes|stefan-boltzmann|heisenberg|half-life|carbon-14|linear equation|system of (?:linear )?equations|nitrogen cycle|phosphorus cycle|fungi|self-attention|freezing point|boiling point)\b/i.test(scanText) ||
      /\b(?:acceleration\s+(?:due to gravity|vector|formula|down the (?:plane|incline)|of the (?:object|particle|block|mass|car))|angular acceleration|centripetal acceleration|m\/s\^?2|rate of acceleration|constant acceleration)\b/i.test(scanText) ||
      /\bkinetic energy\b[\s\S]{0,50}\b(?:joules|kg|m\/s|velocity|mass|formula|calculate|object|particle|motion|potential energy|conservation of energy)\b/i.test(scanText) ||
      /\b(?:thermodynamic entropy|entropy of the system|entropy change|shannon entropy|entropy and enthalpy|entropy increases|second law of thermodynamics)\b/i.test(scanText) ||
      /\bentropy\b[\s\S]{0,40}\b(?:temperature|joules|second law|thermodynamics|boltzmann|state function|reversib)\b/i.test(scanText) ||
      /\b(?:calculate|determine|find)\s+(?:the\s+)?(?:derivative|integral|eigenvalue|limit|probability|velocity|acceleration|kinetic energy|net force|gravitational force|voltage|work|entropy|half-life|concentration|molarity|percentage|hypotenuse|root|standard deviation|variance)\b/i.test(scanText) ||
      /\b(?:(?:joint|conditional|posterior|prior|binomial|poisson|marginal)\s+probability|probability\s+(?:distribution|density|mass\s+function|of\s+(?:getting|rolling|drawing|event|heads|tails)))\b/i.test(scanText) ||
      /\b(?:dna\s+(?:sequence|sequencing|replication|polymerase|transcription|methylation|mutation|strand|helix|double\s+helix|break[s]?|cleavage|damage|repair|ligase)|recombinant\s+dna|mitochondrial\s+dna)\b/i.test(scanText) ||
      /\b(?:utilitarianism|deontolog|epistemolog|syllogism|deductive logic|inductive logic|newtons|(?:net|gravitational|centripetal)\s+force|(?:atomic|rest|molar)\s+mass|speed of sound|blackbody|dark energy|cosmological constant|mitosis|meiosis|crispr)\b/i.test(scanText) ||
      /\b\d+\s*[+\-*/^=]\s*\d+\b/.test(scanText);

    if (isExplicitStem) {
      return {
        isFastPath: true,
        role: 'factual_stem',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'code_syntax',
        ruleId: 'lexical:stem_explicit',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }
  }

  // --------------------------------------------------------------------------
  // Layer 3: Keyword & Heuristic Rules (Rank 40-50)
  // Active ONLY when preset is 'all' (or legacy 'anchors+keywords')
  // --------------------------------------------------------------------------
  const includeKeywords = preset === 'structure+lexical+keywords' || preset === 'all' || preset === 'anchors+keywords';

  if (includeKeywords) {
    // Translation
    const isTranslation = 
      /\b(?:translate|translation)\b[\s\S]{0,60}\b(?:into|to|from|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english|mandarin|cantonese|vietnamese|greek|hebrew|polish|turkish|tagalog)\b/i.test(scanText) ||
      /\b(?:how do you say\b[\s\S]*?\bin (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i.test(scanText) ||
      /\b(?:in (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin):)\b/i.test(scanText) ||
      /\b(?:from\s+\w+\s+(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english))\b/i.test(scanText) ||
      /\b(?:(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i.test(scanText);

    if (isTranslation) {
      return {
        isFastPath: true,
        role: 'general_fast',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'keyword',
        ruleId: 'keyword:translation',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
    }

    // Geography, writing, and structured trivia
    const CHESS_TRIVIA_EXCLUSION = /\b(?:chess|checkmate|stalemate|castling|zugzwang|sicilian|defense|opening|gambit|endgame)\b/i;
    const isGeneralKeyword = 
      /\b(?:geograph|latitude|longitude|elevation|continent|bordering countries|countries that border|capital of|mountain range|peninsula)\b/i.test(scanText) ||
      /\b(?:write (?:a|an)?(?:\s+\w+)?\s*(?:poem|story|haiku|essay|song|dialogue|letter|email))\b/i.test(scanText) ||
      /\b(?:grammar|proofread|correct the grammar|spelling|rephrase|paraphrase)\b/i.test(scanText) ||
      /\b(?:narrative|protagonist|storyline|allegory|metaphor)\b/i.test(scanText) ||
      /\b(?:author|poet|novelist|playwright)\s+(?:wrote|penned|composed|published|authored)\b/i.test(scanText) ||
      /\b(?:literary|novel|poem|playwright|poetry|biography|novelist)\b/i.test(scanText) ||
      /\b(?:does sentence a imply|same sense of the word|entailment)\b/i.test(scanText);

    const isStructuredTrivia = 
      !CHESS_TRIVIA_EXCLUSION.test(scanText) && (
        /\bwho was\s+(?:the\s+)?(?:primary\s+)?(?:architect|author|founder|president|director|composer|painter|sculptor|leader|monarch|emperor|prime minister|creator)\b/i.test(scanText) ||
        /\b(?:who (?:wrote|directed|composed|invented|discovered)|what is the (?:capital of|[\w-]+\s+capital)|which country|what city)\b/i.test(scanText)
      );

    if (isGeneralKeyword || isStructuredTrivia) {
      return {
        isFastPath: true,
        role: 'general_fast',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist',
        reason: 'keyword',
        ruleId: 'keyword:trivia_geography',
        scanWindowUsed,
        rulesVersion: RULES_VERSION
      };
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
