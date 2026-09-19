import { PreRouteReason, DefaultSpecialistRole } from './types.js';

export const RULES_VERSION = 1;
export const MAX_PRE_ROUTE_SCAN_CHARS = 8000;

export interface CatalogRule {
  id: string;
  category: 'deny' | 'anchor' | 'keyword' | 'boundary';
  precedence: number; // Lower number = higher priority
  reason: PreRouteReason;
  role?: DefaultSpecialistRole;
  description: string;
  patterns: RegExp[];
}

/**
 * 0. Deny List (Precedence Rank 0)
 * Evaluated BEFORE custom rules or code fences.
 * Strictly forces an honest miss (isFastPath: false, role: undefined, reason: 'deny')
 * to delegate clinical emergencies, pharmacology calculations, and legal liability
 * queries to downstream frontier guardrails and specialized medical/legal models.
 */
export const DENY_RULES: CatalogRule[] = [
  {
    id: 'deny:clinical_emergency',
    category: 'deny',
    precedence: 0,
    reason: 'deny',
    description: 'Acute clinical emergencies, cardiac/respiratory symptoms, and medical triage',
    patterns: [
      /\b(?:crushing|severe|sudden|radiating)\s+(?:chest\s+pain|headache|shortness of breath)\b/i,
      /\b(?:patient presents with|presents with (?:high fever|chest pain|acute|dyspnea|photophobia|neck stiffness))\b/i,
      /\b(?:anaphylaxis|anaphylactic|stroke symptoms|cardiac arrest|myocardial infarction|pulmonary embolism)\b/i,
      /\b(?:emergency room|triage assessment|clinical symptoms|treatment options|medical evaluation)\b/i
    ]
  },
  {
    id: 'deny:pharmacology_dosing',
    category: 'deny',
    precedence: 0,
    reason: 'deny',
    description: 'Clinical drug dosing calculations, pediatric titration, and prescription instructions',
    patterns: [
      /\b(?:dose|dosing|titrate|titration)\s+(?:vancomycin|gentamicin|warfarin|heparin|insulin|digoxin|chemotherapy|lithium)\b/i,
      /\b(?:prescribe|prescription)\s+(?:antibiotics|medication|dosage|regimen)\b/i,
      /\b(?:pediatric (?:dosage|dosing)|mg\/kg(?:\/day)?\s+(?:dose|dosage|calculation))\b/i,
      /\b(?:pharmacological differences between|drug-drug interaction between)\b/i
    ]
  },
  {
    id: 'deny:legal_counsel',
    category: 'deny',
    precedence: 0,
    reason: 'deny',
    description: 'Specific legal counsel directives and statutory liability determinations',
    patterns: [
      /\b(?:legal advice for my (?:lawsuit|trial|custody|divorce|criminal charge))\b/i,
      /\b(?:should I sue|evaluate my legal liability under statute)\b/i
    ]
  }
];

/**
 * 1. Syntactic Anchor Rules (Precedence Rank 20-30)
 * Deterministic grammatical and syntactic structures with zero linguistic drift.
 * Active in all presets ('anchors-only' and 'anchors+keywords').
 */
export const ANCHOR_RULES: CatalogRule[] = [
  {
    id: 'anchor:reading_comprehension',
    category: 'anchor',
    precedence: 20,
    reason: 'comprehension',
    role: 'comprehension_rc',
    description: 'Structured textual comprehension anchored by explicit excerpt references',
    patterns: [
      /\b(?:based on (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|paragraph|historical account|case study)["']?)/i,
      /\b(?:according to (?:the|this|that)?\s*(?:provided|following|above|below)?\s*["']?(?:text|passage|article|excerpt|document|context|historical account|case study)["']?)/i,
      /\b(?:in (?:the|this)\s+(?:provided|following)?\s*["']?(?:text|passage|article|excerpt|document|paragraph|case study)["']?\s+(?:above|below)?)/i,
      /\b(?:in paragraph \d+)\b/i,
      /\b(?:summarize (?:the|this)\s+["']?(?:text|passage|article|excerpt|document|chapter|section)["']?)/i,
      /\b(?:what does the author (?:mean|state|imply|claim|conclude|suggest|argue))\b/i,
      /\b(?:main thesis of the author|author's main argument)\b/i,
      /\b(?:from the\s+["']?(?:text|passage|excerpt|article|document)["']?\s+(?:above|below)?)/i,
      /\b(?:reading comprehension|comprehension question|evaluate (?:whether|if) (?:the|this) (?:statement|claim|assertion) is (?:true|false|accurate|supported))\b/i,
      /\b(?:information provided in (?:the|this)\s+["']?(?:preceding|provided|following)?\s*(?:text|case study|article|passage)["']?)/i
    ]
  },
  {
    id: 'anchor:code_fence',
    category: 'anchor',
    precedence: 21,
    reason: 'fence',
    role: 'code',
    description: 'Markdown code blocks tagged with programming languages or containing code constructs',
    patterns: [
      /```(?!(?:md|markdown|text|plain|txt|prose)\b)[a-zA-Z0-9_#+-]+\b[\s\S]*?```/i,
      /```(?:(?!(?:```))[\s\S])*?(?:\b(?:def\s+\w+|function\s+\w+|class\s+\w+|import\s+[\w{}*]+|return\b|console\.log|SELECT\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)|\b(?:const|let|var)\s+\w+\s*=)[\s\S]*?```/i
    ]
  },
  {
    id: 'anchor:stack_trace',
    category: 'anchor',
    precedence: 22,
    reason: 'stack_trace',
    role: 'code',
    description: 'System runtime exceptions and crash stack traces',
    patterns: [
      /(?:Traceback \(most recent call last\)|TypeError:|SyntaxError:|ReferenceError:|NullPointerException|IndexOutOfBoundsException|ModuleNotFoundError:|panic:|Segmentation fault|SIGSEGV|Uncaught Error:)/i
    ]
  },
  {
    id: 'anchor:code_syntax',
    category: 'anchor',
    precedence: 23,
    reason: 'code_syntax',
    role: 'code',
    description: 'Language function signatures, type definitions, imports, and framework structures',
    patterns: [
      /\b(?:write|create|implement|build|refactor|debug|fix|optimize|convert)\b[\s\S]{0,60}\b(?:code|script|function|class|method|algorithm|api|endpoint|sql query|component|hook|unit test|test suite|decorator|type|interface|database schema|middleware|resolver|generator|(?:ci\/cd|data|etl|build|deployment)\s+pipeline|dockerfile|regex|callback|promise|async\/await|binary search|quicksort|sorting|bfs|dfs|minimax|engine)\b/i,
      /\b(?:how (?:do|can) I (?:implement|code|write|program|fix|debug|test|optimize|refactor))\b/i,
      /\b(?:fix this (?:code|bug|error|issue|exception|stack trace|syntax|crash|warning))\b/i,
      /\b(?:unit test|test suite|test case|pytest|jest|vitest|mocha|cargo test)\b/i,
      /\b(?:def\s+[a-zA-Z_]\w*\s*\(|function\s+[a-zA-Z_]\w*\s*\(|const\s+[a-zA-Z_]\w*\s*=|let\s+[a-zA-Z_]\w*\s*=|var\s+[a-zA-Z_]\w*\s*=|fn\s+[a-zA-Z_]\w*\s*\(|func\s+(?:\([a-zA-Z0-9_*\s]+\)\s*)?[a-zA-Z_]\w*\s*\(|class\s+[a-zA-Z_]\w*\s*(?:extends|implements|\{|\:)|public\s+(?:static\s+)?void|import\s+.*\s+from|from\s+.*\s+import|#include\s+<|require\(['"].*['"]\)|package\s+main|console\.log\(|println!|std::|fmt\.Println)\b/,
      /\buse[A-Z][a-zA-Z0-9_]+\b/, // React hook
      /\b(?:typescript|javascript|python|rust|golang|c\+\+|cpp|c#|java|scala|kotlin|swift|ruby|php|react|vue|angular|svelte|next\.js|node\.js|express|fastapi|django|flask|graphql|dockerfile|github actions|kubernetes|k8s|css flexbox|css grid|tailwind|sql query|postgresql|sqlite|redis|mongodb)\b[\s\S]{0,100}\b(?:error|bug|issue|exception|function|class|component|hook|query|schema|type|import|export|install|build|compile|syntax|loop|re-render|memory leak|thread|mutex|deadlock|concurrency|async|await|promise|callback|iterator|package|module|resolver|endpoint|route|layout|generic|workflow|search|sort|algorithm|engine|minimax|implementation)\b/i,
      /\b(?:generic type|type alias|interface\s+[a-zA-Z_]|struct\s+[a-zA-Z_]|impl\s+[a-zA-Z_]|Arc<Mutex<|RwLock<|flexbox layout|token bucket|lru cache|event emitter|pull request|git commit|git diff)\b/i,
      /\b(?:error|bug|issue|exception|function|class|component|hook|query|schema|type|import|export|install|build|compile|syntax|loop|re-render|memory leak|thread|mutex|deadlock|concurrency|async|await|promise|callback|iterator|package|module|resolver|endpoint|route|layout|generic|workflow|search|sort|algorithm|engine|minimax|implementation)\b[\s\S]{0,100}\b(?:typescript|javascript|python|rust|golang|c\+\+|cpp|c#|java|scala|kotlin|swift|ruby|php|react|vue|angular|svelte|next\.js|node\.js|express|fastapi|django|flask|graphql|dockerfile|github actions|kubernetes|k8s|css flexbox|css grid|tailwind|sql query|postgresql|sqlite|redis|mongodb)\b/i
    ]
  },
  {
    id: 'anchor:sql',
    category: 'anchor',
    precedence: 24,
    reason: 'sql',
    role: 'code',
    description: 'Structured SQL queries and database DDL/DML commands',
    patterns: [
      /\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+[\s\S]+?\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i
    ]
  },
  {
    id: 'anchor:chess_spatial',
    category: 'anchor',
    precedence: 25,
    reason: 'fen',
    role: 'games_spatial',
    description: 'Deterministic chess notation, FEN positions, and discrete coordinate moves',
    patterns: [
      /\b(?:fen|pgn|en passant)\b/i,
      /\b(?:board position|legal moves|(?:pawn|knight|bishop|rook|queen|king) move)\b/i,
      /\b(?:sudoku grid|tic-tac-toe|connect four|gomoku)\b/i,
      /\b[a-h][1-8][-x][a-h][1-8]\b/,
      /(?:^|[\s(])(?:1\.|[1-9]\d*\.)\s*(?:[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|O-O-O|O-O)/
    ]
  },
  {
    id: 'anchor:deep_reasoning',
    category: 'anchor',
    precedence: 26,
    reason: 'deep_reasoning',
    role: 'reasoning_deep',
    description: 'Financial statements, balance sheet reconciliations, and formal mathematical proofs',
    patterns: [
      /\b(?:net income|operating income|operating margin|gross margin|fiscal year|cash flow[s]?|diluted eps|earnings per share|balance sheet|sec filing|10-k|10-q|ebitda|ebit|cagr|amortization|depreciation|discounted cash flow|dcf model|valuation model|p\/e ratio|return on equity|roe|roic|capital expenditure|capex|free cash flow|wacc|working capital|covenant breach)\b/i,
      /\b(?:formal (?:deductive )?logic proof|formal mathematical proof|deductive reasoning|proof by contradiction|mathematical proof|game theory|nash equilibrium|prisoner's dilemma|pareto optimal(?:ity|)?|counterfactual analysis|formal logic proof|first-order logic|syllogism proof|grim trigger|tit-for-tat|first fundamental theorem)\b/i
    ]
  },
  {
    id: 'anchor:latex_math',
    category: 'anchor',
    precedence: 27,
    reason: 'latex',
    role: 'factual_stem',
    description: 'Formal LaTeX equations and mathematical expressions',
    patterns: [
      /(?:\\frac|\\sum|\\sqrt|\\int|\\times|\\pm)/i
    ]
  },
  {
    id: 'anchor:stem_explicit',
    category: 'anchor',
    precedence: 28,
    reason: 'code_syntax',
    role: 'factual_stem',
    description: 'Explicit STEM, physics laws, thermodynamics, and algebraic expressions',
    patterns: [
      /(?:equation|theorem|polynomial|integral|derivative|matrix|vector space|logarithm|physics|chemistry|biology|astronomy|thermodynamics|quantum|velocity|voltage|electric current|electrical resistance|resistor|molecule|atom|gravitat\w*|gravity|black hole|calculus|algebra|geometry|trigonometry|logarithmic|exponential|mitochondri\w*|phosphorylation|atp synthesis|photosynthesis|eukaryot\w*|orbital|fluid flow|navier-stokes|stefan-boltzmann|heisenberg|half-life|carbon-14|linear equation|system of (?:linear )?equations|nitrogen cycle|phosphorus cycle|fungi|self-attention|freezing point|boiling point)\b/i,
      /\b(?:acceleration\s+(?:due to gravity|vector|formula|down the (?:plane|incline)|of the (?:object|particle|block|mass|car))|angular acceleration|centripetal acceleration|m\/s\^?2|rate of acceleration|constant acceleration)\b/i,
      /\bkinetic energy\b[\s\S]{0,50}\b(?:joules|kg|m\/s|velocity|mass|formula|calculate|object|particle|motion|potential energy|conservation of energy)\b/i,
      /\b(?:thermodynamic entropy|entropy of the system|entropy change|shannon entropy|entropy and enthalpy|entropy increases|second law of thermodynamics)\b/i,
      /\bentropy\b[\s\S]{0,40}\b(?:temperature|joules|second law|thermodynamics|boltzmann|state function|reversib)\b/i,
      /\b(?:calculate|determine|find)\s+(?:the\s+)?(?:derivative|integral|eigenvalue|limit|probability|velocity|acceleration|kinetic energy|net force|gravitational force|voltage|work|entropy|half-life|concentration|molarity|percentage|hypotenuse|root|standard deviation|variance)\b/i,
      /\b(?:(?:joint|conditional|posterior|prior|binomial|poisson|marginal)\s+probability|probability\s+(?:distribution|density|mass\s+function|of\s+(?:getting|rolling|drawing|event|heads|tails)))\b/i,
      /\b(?:dna\s+(?:sequence|sequencing|replication|polymerase|transcription|methylation|mutation|strand|helix|double\s+helix|break[s]?|cleavage|damage|repair|ligase)|recombinant\s+dna|mitochondrial\s+dna)\b/i,
      /\b(?:utilitarianism|deontolog|epistemolog|syllogism|deductive logic|inductive logic|newtons|(?:net|gravitational|centripetal)\s+force|(?:atomic|rest|molar)\s+mass|speed of sound|blackbody|dark energy|cosmological constant|mitosis|meiosis|crispr)\b/i,
      /\b\d+\s*[+\-*/^=]\s*\d+\b/
    ]
  }
];

/**
 * 2. Keyword & Heuristic Rules (Precedence Rank 40-50)
 * Natural language translation, geography, open-ended trivia, and closed-world tasks.
 * ONLY ACTIVE when preset is 'anchors+keywords'.
 */
export const KEYWORD_RULES: CatalogRule[] = [
  {
    id: 'keyword:translation',
    category: 'keyword',
    precedence: 40,
    reason: 'keyword',
    role: 'general_fast',
    description: 'Natural language translation queries into foreign languages',
    patterns: [
      /\b(?:translate|translation)\b[\s\S]{0,60}\b(?:into|to|from|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english|mandarin|cantonese|vietnamese|greek|hebrew|polish|turkish|tagalog)\b/i,
      /\b(?:how do you say\b[\s\S]*?\bin (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i,
      /\b(?:in (?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin):)\b/i,
      /\b(?:from\s+\w+\s+(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english))\b/i,
      /\b(?:(?:to|into)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin))\b/i
    ]
  },
  {
    id: 'keyword:trivia_geography',
    category: 'keyword',
    precedence: 41,
    reason: 'keyword',
    role: 'general_fast',
    description: 'Geography, creative writing, proofreading, and historical trivia',
    patterns: [
      /\b(?:geograph|latitude|longitude|elevation|continent|bordering countries|countries that border|capital of|mountain range|peninsula)\b/i,
      /\b(?:write (?:a|an)?(?:\s+\w+)?\s*(?:poem|story|haiku|essay|song|dialogue|letter|email))\b/i,
      /\b(?:grammar|proofread|correct the grammar|spelling|rephrase|paraphrase)\b/i,
      /\b(?:narrative|protagonist|storyline|allegory|metaphor)\b/i,
      /\b(?:author|poet|novelist|playwright)\s+(?:wrote|penned|composed|published|authored)\b/i,
      /\b(?:literary|novel|poem|playwright|poetry|biography|novelist)\b/i,
      /\b(?:does sentence a imply|same sense of the word|entailment)\b/i,
      /\bwho was\s+(?:the\s+)?(?:primary\s+)?(?:architect|author|founder|president|director|composer|painter|sculptor|leader|monarch|emperor|prime minister|creator)\b/i,
      /\b(?:who (?:wrote|directed|composed|invented|discovered)|what is the (?:capital of|[\w-]+\s+capital)|which country|what city)\b/i
    ]
  },
  {
    id: 'boundary:closed_world',
    category: 'boundary',
    precedence: 42,
    reason: 'closed_world',
    role: 'general_fast',
    description: 'Closed-world self-contained transformations (unit conversion, regex, formatting)',
    patterns: [
      /^(?:format|prettify|lint|capitalize|lowercase|reverse)\b/i,
      /^(?:translate)\b[\s\S]{0,60}\b(?:into|to|in)\s+(?:spanish|french|german|chinese|japanese|russian|italian|portuguese|hindi|arabic|korean|dutch|swedish|latin|english)\b/i,
      /^(?:convert)\s+[\d.]+\s*[a-zA-Z°\s]{1,25}\s+(?:to|into)\s+[a-zA-Z°\s]{1,25}$/i,
      /\b(?:convert\s+\d+\s*(?:miles|km|celsius|fahrenheit|kg|lbs|usd|eur|gbp|meters|feet|inches|cm|gallons|liters)\s+to\s+[a-z]+)\b/i,
      /\b(?:regex|regular expression|json format|csv format|unit conversion|celsius to fahrenheit|miles to km)\b/i,
      /^(?:what is|solve|calculate)\s+[\d\s+\-*/^().=]+[?]?$/i,
      /\b(?:dictionary definition|synonym for|antonym for|spelling of)\b/i
    ]
  }
];

export const RULE_CATALOG: CatalogRule[] = [
  ...DENY_RULES,
  ...ANCHOR_RULES,
  ...KEYWORD_RULES
];
