export interface Message {
  role: 'system' | 'user' | 'assistant';
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
}

export interface PreRouteResult<TRole extends string = string> {
  isFastPath: boolean;
  role?: DefaultSpecialistRole | TRole;
  confidence: 'high' | 'borderline' | 'unstructured';
  complexityScore: number;
  suggestedAction: 'dispatch_specialist' | 'delegate_to_l2';
}

export interface ClassifierOptions<TRole extends string = string> {
  lengthThreshold?: number; // String length, not tokens, for speed. Default 2000.
  customRules?: RegExp[];   // Custom Regex patterns to mark a prompt as complex
  customSpecialistRules?: CustomSpecialistRule<TRole>[]; // Custom regex overrides for specialist routing
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
  if (!text || !text.trim()) return 'open';
  const clean = text.trim().toLowerCase();

  // Closed-world signals: self-contained transformations and lookup queries
  const closedWorldPatterns = [
    /^(?:format|prettify|lint|capitalize|lowercase|reverse)\b/i,
    /^(?:translate)\b[\s\S]{0,60}\b(?:into|to|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english)\b/i,
    /^(?:convert)\s+[\d.]+\s*[a-zA-Z°\s]{1,25}\s+(?:to|into)\s+[a-zA-Z°\s]{1,25}$/i,
    /\b(?:convert\s+\d+\s*(?:miles|km|celsius|fahrenheit|kg|lbs|usd|eur|gbp|meters|feet|inches|cm|gallons|liters)\s+to\s+[a-z]+)\b/i,
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
      .replace(/^(?:could you please|can you please|would you kindly|would you please|i want you to|i need you to|tell me|show me)[,!.\s]+/i, '')
      .replace(/\b(?:as we discussed earlier|like i mentioned before|as you know)\b/gi, '')
      .replace(/\b(?:thanks in advance|thank you very much|thank you|thanks|let me know what you think)[.!?\s]*$/gi, '')
      .trim();
    changed = before !== cleaned;
  }

  // Deduplicate consecutive whitespace and punctuation
  return cleaned.replace(/\s+/g, ' ').replace(/([?!.,;])\1+/g, '$1').trim();
}

const MAX_PRE_ROUTE_SCAN_CHARS = 8000;
const JSON_OBJECT = /\{[\s\S]*?"[^"\n]+"\s*:\s*[\s\S]*?\}/;

/**
 * Continuous complexity scorer [0.0, 1.0].
 * Provides a continuous heuristic complexity index [0.0, 1.0] for speculative hedging or routing gates.
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

  // Bounded scan slice to prevent regex lag or ReDoS on large payloads
  const scanText = fullText.length > MAX_PRE_ROUTE_SCAN_CHARS
    ? fullText.slice(0, 4000) + '\n' + fullText.slice(-4000)
    : fullText;

  // Structural markers (formatted payloads like HTML/XML or nested JSON data)
  if (/<\/?([a-z][a-z0-9]*)\b[^>]*>/i.test(scanText)) score += 0.20;
  if (JSON_OBJECT.test(scanText)) score += 0.20;

  // Moderate cognitive / comparative inquiry (borderline indicators)
  if (/\b(compare|contrast|explain why|how does|tradeoffs|pros and cons|difference between)\b/i.test(scanText)) {
    score += 0.25;
  }

  // High cognitive complexity verbs
  if (/\b(analyze|evaluate|architect|synthesize|speculate|refactor|debug|test|benchmark)\b/i.test(scanText)) {
    score += 0.35;
  }

  // Custom regex rules
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
 * A fast heuristic classifier to predict if a prompt is "simple" or "complex".
 * Evaluates message length, complex cognitive verbs, and structural payload markers
 * by testing whether evaluateComplexityScore meets or exceeds the complexity threshold (default: 0.5).
 */
export function isComplexPrompt(
  messages: Message[] | string,
  options?: ClassifierOptions,
  threshold = 0.5
): boolean {
  return evaluateComplexityScore(messages, options) >= threshold;
}

/**
 * Deterministic Stage-0 Pre-Router Gate.
 * Evaluates in <15 microseconds whether an incoming prompt has a deterministic
 * structural or domain footprint (code, SQL, math, chess, closed-world transform)
 * suitable for immediate fast-path dispatch, or whether it should be delegated
 * to an L2 neural/embedding router or frontier model.
 */
export function classifyPreRoute<TRole extends string = string>(messages: Message[] | string, options?: ClassifierOptions<TRole>): PreRouteResult<TRole> {
  let fullText = Array.isArray(messages) 
    ? messages.map(m => m.content).join('\n') 
    : messages;

  if (options?.prunePreRouting) {
    fullText = pruneText(fullText);
  }

  const complexityScore = evaluateComplexityScore(fullText, options);

  // Bounded scan window: if text is huge (e.g. pasted logs, multi-page docs),
  // sample the head and tail (4KB each) where syntactic markers, code fences,
  // imports, or task instructions reside. This guarantees deterministic µs execution
  // and prevents catastrophic backtracking / string scan penalties.
  const scanText = fullText.length > MAX_PRE_ROUTE_SCAN_CHARS
    ? fullText.slice(0, 4000) + '\n' + fullText.slice(-4000)
    : fullText;

  // 0. Custom Specialist Overrides (User-defined domain rules)
  if (options?.customSpecialistRules && options.customSpecialistRules.length > 0) {
    for (const rule of options.customSpecialistRules) {
      if (rule.pattern.test(scanText)) {
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

  // 1. Paragraph Reading Comprehension & Grounded Verification
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
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 2. Code Generation, Refactoring & Algorithm Synthesis
  const isCode = 
    // Markdown code blocks with explicit language identifier (excluding plain prose formats) or inline code constructs
    /```(?!(?:md|markdown|text|plain|txt|prose)\b)[a-zA-Z0-9_#+-]+\b[\s\S]*?```/i.test(scanText) ||
    /```[\s\S]*?(?:\b(?:def\s+\w+|function\s+\w+|class\s+\w+|import\s+[\w{}*]+|return\b|console\.log|SELECT\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)|\b(?:const|let|var)\s+\w+\s*=)[\s\S]*?```/i.test(scanText) ||
    // Intent to write / implement / refactor / debug / optimize code
    /\b(?:write|create|implement|build|refactor|debug|fix|optimize|convert)\b[\s\S]{0,60}\b(?:code|script|function|class|method|algorithm|api|endpoint|sql query|component|hook|unit test|test suite|decorator|type|interface|database schema|middleware|resolver|generator|(?:ci\/cd|data|etl|build|deployment)\s+pipeline|dockerfile|regex|callback|promise|async\/await|binary search|quicksort|sorting|bfs|dfs|minimax|engine)\b/i.test(scanText) ||
    /\b(?:how (?:do|can) I (?:implement|code|write|program|fix|debug|test|optimize|refactor))\b/i.test(scanText) ||
    /\b(?:fix this (?:code|bug|error|issue|exception|stack trace|syntax|crash|warning))\b/i.test(scanText) ||
    /\b(?:unit test|test suite|test case|pytest|jest|vitest|mocha|cargo test)\b/i.test(scanText) ||
    // Stack traces and runtime errors
    /(?:Traceback \(most recent call last\)|TypeError:|SyntaxError:|ReferenceError:|NullPointerException|IndexOutOfBoundsException|ModuleNotFoundError:|panic:|Segmentation fault|SIGSEGV|Uncaught Error:)/i.test(scanText) ||
    // Language & Framework specific terms combined with coding keywords
    (/\b(?:typescript|javascript|python|rust|golang|c\+\+|cpp|c#|java|scala|kotlin|swift|ruby|php|react|vue|angular|svelte|next\.js|node\.js|express|fastapi|django|flask|graphql|dockerfile|github actions|kubernetes|k8s|css flexbox|css grid|tailwind|sql query|postgresql|sqlite|redis|mongodb)\b/i.test(scanText) &&
     /\b(?:error|bug|issue|exception|function|class|component|hook|query|schema|type|import|export|install|build|compile|syntax|loop|re-render|memory leak|thread|mutex|deadlock|concurrency|async|await|promise|callback|iterator|package|module|resolver|endpoint|route|layout|generic|workflow|search|sort|algorithm|engine|minimax|implementation)\b/i.test(scanText)) ||
    // Programming keywords and signatures (require parameter parentheses or assignment)
    /\b(?:def\s+[a-zA-Z_]\w*\s*\(|function\s+[a-zA-Z_]\w*\s*\(|const\s+[a-zA-Z_]\w*\s*=|let\s+[a-zA-Z_]\w*\s*=|var\s+[a-zA-Z_]\w*\s*=|fn\s+[a-zA-Z_]\w*\s*\(|func\s+(?:\([a-zA-Z0-9_*\s]+\)\s*)?[a-zA-Z_]\w*\s*\(|class\s+[a-zA-Z_]\w*\s*(?:extends|implements|\{|\:)|public\s+(?:static\s+)?void|import\s+.*\s+from|from\s+.*\s+import|#include\s+<|require\(['"].*['"]\)|package\s+main|console\.log\(|println!|std::|fmt\.Println)\b/.test(scanText) ||
    // SQL DDL / DML
    /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(scanText) ||
    // React hooks (strictly case-sensitive)
    /\buse[A-Z][a-zA-Z0-9_]+\b/.test(scanText) ||
    // Types, Generics & Systems programming constructs
    /\b(?:generic type|type alias|interface\s+[a-zA-Z_]|struct\s+[a-zA-Z_]|impl\s+[a-zA-Z_]|Arc<Mutex<|RwLock<|flexbox layout|token bucket|lru cache|event emitter|pull request|git commit|git diff)\b/i.test(scanText);

  if (isCode) {
    return {
      isFastPath: true,
      role: 'code',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 3. Chess & Spatial Board Games (State engines & discrete coordinates)
  const BARE_CHESS_WORD = /\b(?:chess|checkmate|stalemate|castling|zugzwang)\b/i;
  const CHESS_TRIVIA_EXCLUSION = /\b(?:chess|checkmate|stalemate|castling|zugzwang|sicilian|defense|opening|gambit|endgame)\b/i;
  const CHESS_STRUCTURE =
    /\b(?:fen|pgn|en passant)\b/i.test(scanText) ||
    /\b(?:board position|legal moves|(?:pawn|knight|bishop|rook|queen|king) move)\b/i.test(scanText) ||
    /\b(?:sudoku grid|tic-tac-toe|connect four|gomoku)\b/i.test(scanText) ||
    /\b[a-h][1-8][-x][a-h][1-8]\b/.test(scanText) ||
    /(?:^|[\s(])(?:1\.|[1-9]\d*\.)\s*(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|O-O-O|O-O)/.test(scanText);

  const isGamesSpatial = !isCode && (
    CHESS_STRUCTURE || (
      BARE_CHESS_WORD.test(scanText) &&
      !/\b(?:history|champion|invented|origin|medieval|olympiad winner)\b/i.test(scanText)
    )
  );

  if (isGamesSpatial) {
    return {
      isFastPath: true,
      role: 'games_spatial',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 4. Financial Statements, Balance Sheets & Formal Proofs (Deep analytical reasoning)
  const isDeepReasoning = 
    /\b(?:net income|operating income|operating margin|gross margin|fiscal year|cash flow[s]?|diluted eps|earnings per share|balance sheet|sec filing|10-k|10-q|ebitda|ebit|cagr|amortization|depreciation|discounted cash flow|dcf model|valuation model|p\/e ratio|return on equity|roe|roic|capital expenditure|capex|free cash flow|wacc|working capital|covenant breach)\b/i.test(scanText) ||
    /\b(?:formal (?:deductive )?logic proof|formal mathematical proof|deductive reasoning|proof by contradiction|mathematical proof|game theory|nash equilibrium|prisoner's dilemma|pareto optimal(?:ity|)?|counterfactual analysis|formal logic proof|first-order logic|syllogism proof|grim trigger|tit-for-tat|first fundamental theorem)\b/i.test(scanText);

  if (isDeepReasoning) {
    return {
      isFastPath: true,
      role: 'reasoning_deep',
      confidence: 'high',
      complexityScore,
      suggestedAction: 'dispatch_specialist'
    };
  }

  // 5. Linguistics, Translation, Geography, Clinical Medicine, Trivia, Entailment
  const generalFastPatterns = [
    /\b(?:translate|translation)\b[\s\S]{0,60}\b(?:into|to|from|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english|mandarin|cantonese|vietnamese|greek|hebrew|polish|turkish|tagalog)\b/i,
    /\b(?:how do you say\b[\s\S]*?\bin (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i,
    /\b(?:in (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin):)\b/i,
    /\b(?:from\s+\w+\s+(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english))\b/i,
    /\b(?:(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i,
    /\b(?:geograph|latitude|longitude|elevation|continent|bordering countries|countries that border|capital of|mountain range|peninsula)\b/i,
    // Clinical medicine, pathology & pharmacology (distinguished from metaphorical symptoms/diagnoses)
    /\b(?:clinical diagnosis|differential diagnosis|pathology|pathogen|syndrome|prognosis|pharmacolog(?:y|ical)|lyme disease)\b/i,
    /\b(?:clinical symptoms|symptoms and (?:treatment|clinical|diagnosis)|treatment options for (?:lyme|diabetes|cancer|asthma|hypertension|infection|disease)|prescribe (?:medication|drugs|antibiotics|dosage))\b/i,
    /\bpatient(?:'s)?\s+(?:presents with|symptoms|history|chart|vitals|medication|clinical|admitted|intake|in the clinic|in hospital)\b/i,
    /\b(?:write (?:a|an)?(?:\s+\w+)?\s*(?:poem|story|haiku|essay|song|dialogue|letter|email))\b/i,
    /\b(?:grammar|proofread|correct the grammar|spelling|rephrase|paraphrase)\b/i,
    /\b(?:narrative|protagonist|storyline|allegory|metaphor)\b/i,
    /\b(?:author|poet|novelist|playwright)\s+(?:wrote|penned|composed|published|authored)\b/i,
    /\b(?:literary|novel|poem|playwright|poetry|biography|novelist)\b/i,
    /\b(?:does sentence a imply|same sense of the word|entailment)\b/i
  ];

  for (const pattern of generalFastPatterns) {
    if (pattern.test(scanText)) {
      return {
        isFastPath: true,
        role: 'general_fast',
        confidence: 'high',
        complexityScore,
        suggestedAction: 'dispatch_specialist'
      };
    }
  }

  // Open-ended trivia (Who directed X?, What is the capital of Y?)
  // Requires structured role cues for 'who was' (e.g. architect, president, author)
  // Blocks game/chess terminology (e.g., 'Who invented the Sicilian Defense?') to delegate to L2
  const isStructuredTrivia =
    !CHESS_TRIVIA_EXCLUSION.test(scanText) && (
      /\bwho was\s+(?:the\s+)?(?:primary\s+)?(?:architect|author|founder|president|director|composer|painter|sculptor|leader|monarch|emperor|prime minister|creator)\b/i.test(scanText) ||
      /\b(?:who (?:wrote|directed|composed|invented|discovered)|what is the (?:capital of|[\w-]+\s+capital)|which country|what city)\b/i.test(scanText)
    );

  if (isStructuredTrivia) {
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
    /(?:\\frac|\\sum|\\sqrt|\\int|\\times|\\pm|equation|theorem|polynomial|integral|derivative|matrix|vector space|logarithm|physics|chemistry|biology|astronomy|thermodynamics|quantum|velocity|voltage|electric current|electrical resistance|resistor|molecule|atom|gravitat\w*|gravity|black hole|calculus|algebra|geometry|trigonometry|logarithmic|exponential|mitochondri\w*|phosphorylation|atp synthesis|photosynthesis|eukaryot\w*|orbital|fluid flow|navier-stokes|stefan-boltzmann|heisenberg|half-life|carbon-14|linear equation|system of (?:linear )?equations|nitrogen cycle|phosphorus cycle|fungi|self-attention|freezing point|boiling point)\b/i.test(scanText) ||
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
  // pass through to L2 Neural / Embedding Router.
  return {
    isFastPath: false,
    role: undefined,
    confidence: complexityScore >= 0.35 && complexityScore <= 0.65 ? 'borderline' : 'unstructured',
    complexityScore,
    suggestedAction: 'delegate_to_l2'
  };
}

/**
 * Classifies a prompt into one of the 6 core domain specialist roles (or custom role).
 * Returns undefined if the prompt lacks deterministic domain signals (miss/delegate to L2).
 * @deprecated Use classifyPreRoute() or createPreRouter() instead for full PreRouteResult metadata.
 */
export function classifySpecialistRole<TRole extends string = string>(
  messages: Message[] | string, 
  options?: ClassifierOptions<TRole>
): (DefaultSpecialistRole | TRole) | undefined {
  const result = classifyPreRoute(messages, options);
  return result.isFastPath ? result.role : undefined;
}
