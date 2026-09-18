export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type SpecialistRole = 
  | 'general_fast'     // google/gemini-3.1-flash-lite (translation, geo, social, ethics, medicine, narrative)
  | 'factual_stem'     // deepseek/deepseek-v4-flash (factual knowledge, science, arithmetic, STEM)
  | 'code'             // Qwen/Qwen3-Coder-Next (code generation, syntax, functions)
  | 'reasoning_fast'   // Qwen/Qwen3-Coder-Next (logic puzzles, execution, algorithmic reasoning)
  | 'reasoning_deep'   // deepseek/deepseek-v4-pro (financial statements, balance sheets, deep reasoning)
  | 'games_spatial'    // deepseek/deepseek-v4-flash (chess, FEN/PGN, board positions)
  | 'comprehension_rc';// qwen/qwen3-235b-a22b-2507 (paragraph answer evaluation, reading comprehension)

export interface CustomSpecialistRule {
  role: SpecialistRole;
  pattern: RegExp;
}

export interface PreRouteResult {
  isFastPath: boolean;
  role: SpecialistRole;
  confidence: 'high' | 'borderline' | 'unstructured';
  complexityScore: number;
  suggestedAction: 'dispatch_specialist' | 'delegate_to_l2';
}

export interface ClassifierOptions {
  lengthThreshold?: number; // String length, not tokens, for speed. Default 2000.
  customRules?: RegExp[];   // Custom Regex patterns to mark a prompt as complex
  customSpecialistRules?: CustomSpecialistRule[]; // Custom regex overrides for specialist routing
  prunePreRouting?: boolean; // If true, clean conversational filler and whitespace before length evaluation
  knowledgeBoundaryGating?: boolean; // If true, prioritize closed-world self-contained routing (default true)
}

/**
 * Knowledge Boundary Router.
 * Determines if a query represents a self-contained "closed-world" task
 * (e.g. arithmetic, unit conversion, code syntax translation, regex, dictionary lookup)
 * that does not require open-world reasoning and is degraded by cognitive context bloat.
 */
export function detectKnowledgeBoundary(text: string): 'closed' | 'open' {
  if (!text) return 'closed';
  const clean = text.trim().toLowerCase();

  // Closed-world signals: self-contained transformations and lookup queries
  const closedWorldPatterns = [
    /^(?:translate|convert|calculate|format|prettify|lint|capitalize|lowercase|reverse)\b/i,
    /\b(?:regex|regular expression|json format|csv format|unit conversion|celsius to fahrenheit|miles to km)\b/i,
    /^(?:what is|solve|calculate)\s+[\d\s+\-*/^().=]+[?]?$/i, // Direct arithmetic expressions with optional ?
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
  
  // Strip common conversational filler patterns (iteratively)
  let changed = true;
  while (changed) {
    const before = cleaned;
    cleaned = cleaned
      .replace(/^(?:hey|hello|hi|greetings|dear|please)[,!.\s]+/i, '')
      .replace(/^(?:could you please|can you please|would you kindly|would you please|i want you to|i need you to|tell me|show me)[,.\s]+/i, '')
      .replace(/\b(?:as we discussed earlier|like i mentioned before|as you know)\b/gi, '')
      .replace(/\b(?:thanks in advance|thank you very much|thank you|thanks|let me know what you think)[.!?\s]*$/gi, '')
      .trim();
    changed = before !== cleaned;
  }

  // Deduplicate consecutive whitespace and punctuation
  return cleaned.replace(/\s+/g, ' ').replace(/([?!.,;])\1+/g, '$1').trim();
}

/**
 * Continuous complexity scorer [0.0, 1.0].
 * Provides fine-grained probability for speculative hedging or routing gates.
 */
export function evaluateComplexityScore(messages: Message[] | string, options?: ClassifierOptions): number {
  const lengthThreshold = options?.lengthThreshold || 2000;
  
  let fullText = Array.isArray(messages) 
    ? messages.map(m => m.content).join('\n') 
    : messages;

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  // Knowledge boundary check (closed-world task deduction)
  if (options?.knowledgeBoundaryGating !== false && detectKnowledgeBoundary(fullText) === 'closed' && fullText.length < 500) {
    return 0.15;
  }

  let score = 0.0;

  // Length scoring (scaled up to 0.60)
  const lengthRatio = Math.min(1.0, fullText.length / lengthThreshold);
  score += lengthRatio * 0.60;

  // Structural markers
  if (/```[a-z]*/i.test(fullText)) score += 0.30;
  if (/<\/?([a-z][a-z0-9]*)\b[^>]*>/i.test(fullText)) score += 0.20;
  if (/\{[\s\S]*"[\s\S]*\}/.test(fullText)) score += 0.20;

  // Moderate cognitive / comparative inquiry (borderline indicators)
  if (/\b(compare|contrast|explain why|how does|tradeoffs|pros and cons|difference between)\b/i.test(fullText)) {
    score += 0.25;
  }

  // High cognitive complexity verbs
  if (/\b(analyze|evaluate|architect|synthesize|speculate|refactor|debug|test|benchmark)\b/i.test(fullText)) {
    score += 0.35;
  }

  // Custom regex rules
  if (options?.customRules) {
    for (const rule of options.customRules) {
      if (rule.test(fullText)) {
        score += 0.35;
        break;
      }
    }
  }

  return Math.min(1.0, Math.max(0.0, score));
}

/**
 * A fast, <50ms heuristic classifier to predict if a prompt is "simple" or "complex".
 * Evaluates message length and structural markers (code blocks, XML, JSON).
 */
export function isComplexPrompt(messages: Message[] | string, options?: ClassifierOptions): boolean {
  const lengthThreshold = options?.lengthThreshold || 2000;
  
  let fullText = Array.isArray(messages) 
    ? messages.map(m => m.content).join('\n') 
    : messages;

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  if (fullText.length > lengthThreshold) {
    return true;
  }

  // Fast regex markers for complexity
  const complexMarkers = [
    /```[a-z]*/i,             // Contains code blocks
    /<\/?([a-z][a-z0-9]*)\b[^>]*>/i, // Contains XML/HTML tags
    /\{[\s\S]*"[\s\S]*\}/,    // Contains JSON-like structures
    /\b(analyze|evaluate|architect|synthesize|speculate|refactor|debug|benchmark)\b/i // Complex cognitive verbs
  ];

  if (options?.customRules) {
    complexMarkers.push(...options.customRules);
  }

  for (const marker of complexMarkers) {
    if (marker.test(fullText)) {
      return true;
    }
  }

  return false;
}

/**
 * L1 Pre-Router Gate.
 * Evaluates in <15 microseconds whether an incoming prompt has a deterministic
 * structural or domain footprint (code, SQL, math, chess, closed-world transform)
 * suitable for immediate fast-path dispatch, or whether it should be delegated
 * to an L2 neural/embedding router or frontier model.
 */
export function classifyPreRoute(messages: Message[] | string, options?: ClassifierOptions): PreRouteResult {
  let fullText = Array.isArray(messages) 
    ? messages.map(m => m.content).join('\n') 
    : messages;

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  const complexityScore = evaluateComplexityScore(fullText, options);

  // 0. Custom Specialist Overrides (User-defined domain rules)
  if (options?.customSpecialistRules && options.customSpecialistRules.length > 0) {
    for (const rule of options.customSpecialistRules) {
      if (rule.pattern.test(fullText)) {
        return {
          isFastPath: true,
          role: rule.role,
          confidence: 'high',
          complexityScore,
          suggestedAction: 'dispatch_specialist'
        };
      }
    }
  }

  // 1. Paragraph Reading Comprehension & Verification (qwen3-235b)
  const isReadingComprehension = 
    /\b(?:based on (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|paragraph|historical account|case study)["']?)/i.test(fullText) ||
    /\b(?:according to (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|historical account|case study)["']?)/i.test(fullText) ||
    /\b(?:in (?:the|this)\s+(?:provided|following)?\s*["']?(?:text|passage|article|excerpt|document|paragraph|case study)["']?\s+(?:above|below|provided)?)/i.test(fullText) ||
    /\b(?:in paragraph \d+)\b/i.test(fullText) ||
    /\b(?:summarize (?:the|this)\s+["']?(?:text|passage|article|excerpt|document|chapter|section)["']?)/i.test(fullText) ||
    /\b(?:what does the author (?:mean|state|imply|claim|conclude|suggest|argue))\b/i.test(fullText) ||
    /\b(?:main thesis of the author|author's main argument)\b/i.test(fullText) ||
    /\b(?:from the\s+["']?(?:text|passage|excerpt|article|document)["']?\s+(?:above|below)?)/i.test(fullText) ||
    /\b(?:reading comprehension|comprehension question|evaluate (?:whether|if) (?:the|this) (?:statement|claim|assertion) is (?:true|false|accurate|supported))\b/i.test(fullText) ||
    /\b(?:information provided in (?:the|this)\s+["']?(?:preceding|provided|following)?\s*(?:text|case study|article|passage)["']?)/i.test(fullText);

  if (isReadingComprehension) {
    return {
      isFastPath: true,
      role: 'comprehension_rc',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 2. Chess & Spatial Board Games (Qwen3-Coder-Next via games_spatial)
  const isChess = 
    /\b(?:chess|checkmate|stalemate|castling|fen|pgn|en passant|zugzwang)\b/i.test(fullText) ||
    /\b(?:board position|legal moves|pawn move|knight move|bishop move|rook move|queen move|king move)\b/i.test(fullText) ||
    /\b(?:sudoku grid|tic-tac-toe|connect four|gomoku)\b/i.test(fullText) ||
    /\b[a-h][1-8]-[a-h][1-8]\b/.test(fullText) ||
    /(?:1\.|\b(?:e4|d4|nf3|c4))\s+[a-z0-9+#=-]+/i.test(fullText);

  if (isChess) {
    return {
      isFastPath: true,
      role: 'games_spatial',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 3. Code Generation, Refactoring & Algorithm Synthesis (Qwen3-Coder-Next)
  const isCode = 
    // Markdown code blocks
    /```/i.test(fullText) ||
    // Intent to write / implement / refactor / debug / optimize code
    /\b(?:write|create|implement|build|refactor|debug|fix|optimize|convert)\b[\s\S]{0,60}\b(?:code|script|function|class|method|algorithm|api|endpoint|query|component|hook|test|handler|decorator|type|interface|schema|middleware|resolver|generator|workflow|pipeline|dockerfile|regex|callback|promise|async\/await)\b/i.test(fullText) ||
    /\b(?:how (?:do|can) I (?:implement|code|write|program|fix|debug|test|optimize|refactor))\b/i.test(fullText) ||
    /\b(?:fix this (?:code|bug|error|issue|exception|stack trace|syntax|crash|warning))\b/i.test(fullText) ||
    /\b(?:unit test|test suite|test case|pytest|jest|vitest|mocha|cargo test)\b/i.test(fullText) ||
    // Stack traces and runtime errors
    /(?:Traceback \(most recent call last\)|TypeError:|SyntaxError:|ReferenceError:|NullPointerException|IndexOutOfBoundsException|ModuleNotFoundError:|panic:|Segmentation fault|SIGSEGV|Uncaught Error:)/i.test(fullText) ||
    // Language & Framework specific terms combined with coding keywords
    (/\b(?:typescript|javascript|python|rust|golang|react|vue|angular|svelte|next\.js|node\.js|express|fastapi|django|flask|graphql|dockerfile|github actions|kubernetes|k8s|css flexbox|css grid|tailwind|sql query|postgresql|sqlite|redis|mongodb)\b/i.test(fullText) &&
     /\b(?:error|bug|issue|exception|function|class|component|hook|query|schema|type|import|export|install|build|compile|syntax|loop|re-render|memory leak|thread|mutex|deadlock|concurrency|async|await|promise|callback|iterator|package|module|resolver|endpoint|route|layout|generic|workflow)\b/i.test(fullText)) ||
    // Programming keywords and signatures
    /\b(?:def\s+[a-zA-Z_]\w*|function\s+[a-zA-Z_]\w*|const\s+[a-zA-Z_]\w*\s*=|let\s+[a-zA-Z_]\w*\s*=|var\s+[a-zA-Z_]\w*\s*=|fn\s+[a-zA-Z_]\w*|func\s+[a-zA-Z_]\w*|class\s+[a-zA-Z_]\w*|public\s+(?:static\s+)?void|import\s+.*\s+from|from\s+.*\s+import|#include\s+<|require\(['"].*['"]\)|package\s+main|console\.log\(|println!|std::|fmt\.Println)\b/.test(fullText) ||
    // SQL DDL / DML
    /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(fullText) ||
    // React hooks (strictly case-sensitive)
    /\buse[A-Z][a-zA-Z0-9_]+\b/.test(fullText) ||
    // Types, Generics & Systems programming constructs
    /\b(?:generic type|type alias|interface\s+[a-zA-Z_]|struct\s+[a-zA-Z_]|impl\s+[a-zA-Z_]|Arc<Mutex<|RwLock<|flexbox layout|token bucket|lru cache|event emitter|pull request|git commit|git diff)\b/i.test(fullText);

  if (isCode) {
    return {
      isFastPath: true,
      role: 'code',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 4. Financial Statements, Balance Sheets & Formal Proofs (deepseek-v4-pro)
  const isDeepReasoning = 
    /\b(?:net income|operating income|operating margin|gross margin|fiscal year|cash flow[s]?|diluted eps|earnings per share|balance sheet|sec filing|10-k|10-q|ebitda|ebit|cagr|amortization|depreciation|discounted cash flow|dcf model|valuation model|p\/e ratio|return on equity|roe|roic|capital expenditure|capex|free cash flow|wacc|working capital|covenant breach)\b/i.test(fullText) ||
    /\b(?:formal (?:deductive )?logic proof|formal mathematical proof|deductive reasoning|proof by contradiction|mathematical proof|game theory|nash equilibrium|prisoner's dilemma|pareto optimal(?:ity|)?|counterfactual analysis|formal logic proof|first-order logic|syllogism proof|grim trigger|tit-for-tat|first fundamental theorem)\b/i.test(fullText);

  if (isDeepReasoning) {
    return {
      isFastPath: true,
      role: 'reasoning_deep',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 5. Linguistics, Translation, Geography, Medicine, Open-ended Trivia, Entailment
  // (Empirically superior on google/gemini-3.1-flash-lite)
  const generalFastPatterns = [
    /\b(?:translate|translation|translated|translating)\b/i,
    /\b(?:how do you say\b[\s\S]*?\bin (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i,
    /\b(?:in (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin):)\b/i,
    /\b(?:from\s+\w+\s+(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english))\b/i,
    /\b(?:(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i,
    /\b(?:geograph|latitude|longitude|elevation|continent|bordering countries|countries that border|capital of|mountain range|peninsula)\b/i,
    /\b(?:patient|symptom|clinic|diagnos|syndrome|treatment|disease|prescribe|prognosis|pharmacolog(?:y|ical)|lyme disease)\b/i,
    /\b(?:write (?:a|an)?(?:\s+\w+)?\s*(?:poem|story|haiku|essay|song|dialogue|letter|email))\b/i,
    /\b(?:grammar|proofread|correct the grammar|spelling|rephrase|paraphrase)\b/i,
    /\b(?:narrative|protagonist|storyline|allegory|metaphor)\b/i,
    /\b(?:author|poet|novelist|playwright)\s+(?:wrote|penned|composed|published|authored)\b/i,
    /\b(?:literary|novel|poem|playwright|poetry|biography|novelist)\b/i,
    /\b(?:does sentence a imply|same sense of the word|entailment)\b/i
  ];

  for (const pattern of generalFastPatterns) {
    if (pattern.test(fullText)) {
      return {
        isFastPath: true,
        role: 'general_fast',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist'
      };
    }
  }

  // Open-ended trivia without multiple choice options
  const hasOptions = /\b(?:options|selections|choices|alternatives):\s*\n?\s*[a-d]\./i.test(fullText) || /\n\s*[a-d]\.\s+\S+/i.test(fullText);
  if (!hasOptions && /\b(?:who (?:was|wrote|directed|composed|invented|discovered)|what is the (?:capital of|[\w-]+\s+capital)|which country|what city)\b/i.test(fullText)) {
    return {
      isFastPath: true,
      role: 'general_fast',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 6. Explicit STEM / Math / Logic / Science
  const isExplicitStem = 
    /(?:\\frac|\\sum|\\sqrt|\\int|\\times|\\pm|equation|theorem|polynomial|integral|derivative|matrix|vector|logarithm|physics|chemistry|biology|astronomy|thermodynamics|quantum|velocity|acceleration|voltage|current|resistance|molecule|atom|gravit|calculus|algebra|geometry|trigonometry|logarithmic|exponential|mitochondria|photosynthesis|eukaryot|orbital|fluid flow|navier-stokes|stefan-boltzmann|heisenberg|half-life|carbon-14|kinetic energy|entropy|eigenvalue|eigenvector)\b/i.test(fullText) ||
    /\b(?:utilitarianism|deontolog|epistemolog|syllogism|deductive logic|inductive logic|probability|calculate|derivative|integral|force|newtons|mass|acceleration|speed of sound|blackbody|dark energy|cosmological constant|mitosis|meiosis|dna|crispr)\b/i.test(fullText) ||
    /\b\d+\s*[+\-*/^=]\s*\d+\b/.test(fullText) ||
    hasOptions;

  if (isExplicitStem) {
    return {
      isFastPath: true,
      role: 'factual_stem',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 7. Knowledge Boundary: Closed-World Transformations (unit conversion, regex, translation, formatting)
  if (detectKnowledgeBoundary(fullText) === 'closed') {
    return {
      isFastPath: true,
      role: 'general_fast',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 8. Default Unstructured / Ambiguous Chat
  // When queries lack clear structural/syntactic domain signatures,
  // pass through to L2 Neural / Embedding Router (or fall back to factual_stem).
  return {
    isFastPath: false,
    role: 'factual_stem',
    confidence: complexityScore >= 0.35 && complexityScore <= 0.65 ? 'borderline' : 'unstructured',
    complexityScore,
    suggestedAction: 'delegate_to_l2'
  };
}

/**
 * Classifies a prompt into one of 7 domain specialist roles optimized
 * for sub-50ms multi-model swarm routing.
 */
export function classifySpecialistRole(messages: Message[] | string, options?: ClassifierOptions): SpecialistRole {
  return classifyPreRoute(messages, options).role;
}
