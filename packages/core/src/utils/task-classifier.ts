/**
 * Task Classifier — 14-dimension weighted scoring (TierFlow-inspired).
 *
 * Scores a request across 14 weighted dimensions and maps the aggregate
 * score to a complexity tier. Zero external dependencies, <1ms latency.
 *
 * Tiers: SIMPLE | MEDIUM | COMPLEX | REASONING
 * Each tier maps to a recommended model strategy.
 *
 * Design: Complements reasoning-engine.ts (MCP tool analysis).
 * reasoning-engine handles MCP-specific routing; this handles general query classification.
 */

export type TaskTier = 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'REASONING';

export type TaskCategory =
  | 'simple_chat'
  | 'general'
  | 'coding'
  | 'reasoning'
  | 'creative'
  | 'data'
  | 'agentic'
  | 'translation';

export interface DimensionScore {
  name: string;
  score: number;
  signal: string | null;
}

export interface ClassificationResult {
  tier: TaskTier;
  category: TaskCategory;
  confidence: number;
  score: number;
  signals: string[];
  dimensions: DimensionScore[];
  agenticScore: number;
}

export interface ScoringConfig {
  tokenCountThresholds: { simple: number; complex: number };
  tierBoundaries: { simpleMedium: number; mediumComplex: number; complexReasoning: number };
  confidenceSteepness: number;
  confidenceThreshold: number;
  dimensionWeights: Record<string, number>;
}

const DEFAULT_CONFIG: ScoringConfig = {
  tokenCountThresholds: { simple: 500, complex: 8000 },
  tierBoundaries: { simpleMedium: -0.15, mediumComplex: 0.15, complexReasoning: 0.45 },
  confidenceSteepness: 12,
  confidenceThreshold: 0.55,
  dimensionWeights: {
    tokenCount: 0.10,
    codePresence: 0.20,
    reasoningMarkers: 0.25,
    technicalTerms: 0.08,
    creativeMarkers: 0.04,
    simpleIndicators: 0.08,
    multiStepPatterns: 0.06,
    questionComplexity: 0.03,
    imperativeVerbs: 0.03,
    constraintCount: 0.03,
    outputFormat: 0.03,
    referenceComplexity: 0.02,
    negationComplexity: 0.02,
    domainSpecificity: 0.03,
    agenticTask: 0.15,
  },
};

const KEYWORDS = {
  code: ['class ', 'function ', 'import ', 'export ', 'def ', 'return ', 'const ', 'async ',
    'await ', 'interface ', 'type ', 'implements', 'extends', 'module', 'package',
    '=>', '===', '!==', '()', '{}', '[]', '::', '->', '```'],

  reasoning: ['prove', 'proof', 'derive', 'deduce', 'reason', 'analyze', 'evaluate',
    'compare', 'contrast', 'optimize', 'refactor', 'design', 'architect',
    'why does', 'how does', 'explain why', 'what if', 'trade-off', 'tradeoff',
    'justify', 'validate', 'verify', 'correctness', 'complexity',
    '证明', '推导', '分析', '优化', '重构', '设计', '架构', '验证'],

  simple: ['hello', 'hi', 'thanks', 'thank you', 'yes', 'no', 'ok', 'okay',
    'sure', 'got it', 'understood', 'good', 'great', 'fine', 'bye',
    '你好', '谢谢', '好的', '明白', '没问题'],

  technical: ['algorithm', 'protocol', 'architecture', 'infrastructure', 'deployment',
    'microservice', 'database', 'encryption', 'authentication', 'api',
    'compiler', 'runtime', 'middleware', 'pipeline', 'framework',
    '算法', '协议', '架构', '部署', '加密', '中间件', '框架'],

  creative: ['creative', 'story', 'poem', 'imagine', 'fiction', 'write a',
    'compose', 'brainstorm', 'idea', 'novel', 'original',
    '创作', '故事', '想象', '创意', '头脑风暴'],

  imperative: ['write', 'create', 'build', 'implement', 'fix', 'add', 'remove',
    'update', 'delete', 'move', 'rename', 'refactor', 'migrate',
    '写', '创建', '实现', '修复', '添加', '删除'],

  constraint: ['must', 'should', 'require', 'ensure', 'guarantee', 'enforce',
    'constraint', 'limit', 'boundary', 'restriction', 'validate',
    '必须', '应该', '确保', '约束', '限制'],

  outputFormat: ['json', 'yaml', 'xml', 'csv', 'table', 'list', 'format',
    'markdown', 'html', 'structured', 'schema',
    '格式', '结构化'],

  reference: ['document', 'specification', 'spec', 'rfc', 'standard', 'reference',
    'according to', 'based on', 'per the', 'follow',
    '文档', '规范', '标准', '参考'],

  negation: ['not', "n't", 'never', 'without', 'exclude', 'avoid', 'prevent',
    'unless', 'except', 'neither', 'nor', 'don\'t', 'doesn\'t',
    '不', '没有', '排除', '避免'],

  domain: ['backtest', 'trading', 'portfolio', 'risk', 'position', 'signal',
    'indicator', 'factor', 'alpha', 'sharpe', 'drawdown', 'volatility',
    'hedge', 'derivative', 'option', 'futures', 'margin',
    '回测', '交易', '持仓', '信号', '因子', '对冲', '期货'],

  agentic: ['tool', 'search', 'browse', 'execute', 'run', 'call', 'invoke',
    'schedule', 'monitor', 'deploy', 'fetch', 'crawl', 'scrape',
    '工具', '搜索', '执行', '部署', '抓取'],
};

function scoreTokenCount(tokens: number, thresholds: { simple: number; complex: number }): DimensionScore {
  if (tokens < thresholds.simple) return { name: 'tokenCount', score: -1.0, signal: `short (${tokens})` };
  if (tokens > thresholds.complex) return { name: 'tokenCount', score: 1.0, signal: `long (${tokens})` };
  return { name: 'tokenCount', score: 0, signal: null };
}

function scoreKeywordMatch(
  text: string, keywords: string[], name: string, label: string,
): DimensionScore {
  const matches = keywords.filter(kw => text.includes(kw));
  if (matches.length >= 3) return { name, score: 1.0, signal: `${label} (${matches.slice(0, 3).join(',')})` };
  if (matches.length >= 2) return { name, score: 0.6, signal: `${label} (${matches.slice(0, 2).join(',')})` };
  if (matches.length >= 1) return { name, score: 0.3, signal: `${label} (${matches[0]})` };
  return { name, score: 0, signal: null };
}

function scoreMultiStep(text: string): DimensionScore {
  const patterns = [/first.*then/i, /step\s*\d/i, /\d+\.\s+\w/, /then\s+\w+.*finally/i];
  const hits = patterns.filter(p => p.test(text));
  if (hits.length >= 2) return { name: 'multiStepPatterns', score: 0.8, signal: 'multi-step(2+)' };
  if (hits.length >= 1) return { name: 'multiStepPatterns', score: 0.4, signal: 'multi-step' };
  return { name: 'multiStepPatterns', score: 0, signal: null };
}

function scoreQuestionComplexity(text: string): DimensionScore {
  const count = (text.match(/\?|？/g) || []).length;
  if (count > 3) return { name: 'questionComplexity', score: 0.6, signal: `${count} questions` };
  if (count > 1) return { name: 'questionComplexity', score: 0.3, signal: `${count} questions` };
  return { name: 'questionComplexity', score: 0, signal: null };
}

function scoreAgenticTask(text: string, keywords: string[]): { dimension: DimensionScore; score: number } {
  const matches = keywords.filter(kw => text.includes(kw));
  if (matches.length >= 4) return { dimension: { name: 'agenticTask', score: 1.0, signal: `agentic(${matches.slice(0, 3).join(',')})` }, score: 1.0 };
  if (matches.length >= 3) return { dimension: { name: 'agenticTask', score: 0.6, signal: `agentic(${matches.slice(0, 3).join(',')})` }, score: 0.6 };
  if (matches.length >= 1) return { dimension: { name: 'agenticTask', score: 0.2, signal: `agentic-light(${matches[0]})` }, score: 0.2 };
  return { dimension: { name: 'agenticTask', score: 0, signal: null }, score: 0 };
}

function scoreNegationComplexity(text: string, keywords: string[]): DimensionScore {
  const matches = keywords.filter(kw => text.includes(kw));
  if (matches.length >= 3) return { name: 'negationComplexity', score: 0.5, signal: `negation(${matches.length})` };
  if (matches.length >= 2) return { name: 'negationComplexity', score: 0.3, signal: `negation(${matches.length})` };
  return { name: 'negationComplexity', score: 0, signal: null };
}

function calibrateConfidence(distance: number, steepness: number): number {
  return 1 / (1 + Math.exp(-steepness * distance));
}

function determineCategory(dimensions: DimensionScore[], agenticScore: number): TaskCategory {
  const hasAgentic = agenticScore >= 0.6;
  const hasReasoning = dimensions.some(d => d.name === 'reasoningMarkers' && d.score >= 0.6);
  const hasCode = dimensions.some(d => d.name === 'codePresence' && d.score >= 0.6);
  const hasCreative = dimensions.some(d => d.name === 'creativeMarkers' && d.score >= 0.3);
  const isSimple = dimensions.some(d => d.name === 'simpleIndicators' && d.score < 0);

  if (isSimple && !hasReasoning && !hasCode) return 'simple_chat';
  if (hasAgentic) return 'agentic';
  if (hasReasoning) return 'reasoning';
  if (hasCode) return 'coding';
  if (hasCreative) return 'creative';
  if (dimensions.some(d => d.name === 'domainSpecificity' && d.score >= 0.3)) return 'data';
  return 'general';
}

/**
 * Classify a request by analyzing its content across 14 dimensions.
 * Returns tier (SIMPLE/MEDIUM/COMPLEX/REASONING), category, confidence, and signals.
 *
 * @param userMessage - The user's message text (last message only for accuracy)
 * @param systemPrompt - Optional system prompt
 * @param tokenCount - Estimated token count
 * @param config - Optional scoring config override
 */
export function classifyRequest(
  userMessage: string,
  systemPrompt: string | undefined,
  tokenCount: number,
  config: Partial<ScoringConfig> = {},
): ClassificationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const text = userMessage.toLowerCase();

  const dimensions: DimensionScore[] = [
    scoreTokenCount(tokenCount, cfg.tokenCountThresholds),
    scoreKeywordMatch(text, KEYWORDS.code, 'codePresence', 'code'),
    scoreKeywordMatch(text, KEYWORDS.reasoning, 'reasoningMarkers', 'reasoning'),
    scoreKeywordMatch(text, KEYWORDS.technical, 'technicalTerms', 'technical'),
    scoreKeywordMatch(text, KEYWORDS.creative, 'creativeMarkers', 'creative'),
    scoreKeywordMatch(text, KEYWORDS.simple, 'simpleIndicators', 'simple'),
    scoreMultiStep(text),
    scoreQuestionComplexity(text),
    scoreKeywordMatch(text, KEYWORDS.imperative, 'imperativeVerbs', 'imperative'),
    scoreKeywordMatch(text, KEYWORDS.constraint, 'constraintCount', 'constraints'),
    scoreKeywordMatch(text, KEYWORDS.outputFormat, 'outputFormat', 'format'),
    scoreKeywordMatch(text, KEYWORDS.reference, 'referenceComplexity', 'references'),
    scoreNegationComplexity(text, KEYWORDS.negation),
    scoreKeywordMatch(text, KEYWORDS.domain, 'domainSpecificity', 'domain'),
  ];

  const agentic = scoreAgenticTask(text, KEYWORDS.agentic);
  dimensions.push(agentic.dimension);

  const signals = dimensions.filter(d => d.signal !== null).map(d => d.signal!);

  let weightedScore = 0;
  for (const d of dimensions) {
    const w = cfg.dimensionWeights[d.name] ?? 0;
    weightedScore += d.score * w;
  }

  // Direct reasoning override: 2+ reasoning markers = REASONING
  const reasoningHits = KEYWORDS.reasoning.filter(kw => text.includes(kw));
  if (reasoningHits.length >= 2) {
    const confidence = Math.max(calibrateConfidence(Math.max(weightedScore, 0.3), cfg.confidenceSteepness), 0.85);
    return { tier: 'REASONING', category: 'reasoning', confidence, score: weightedScore, signals, dimensions, agenticScore: agentic.score };
  }

  const { simpleMedium, mediumComplex, complexReasoning } = cfg.tierBoundaries;
  let tier: TaskTier;
  let distance: number;

  if (weightedScore < simpleMedium) {
    tier = 'SIMPLE';
    distance = simpleMedium - weightedScore;
  } else if (weightedScore < mediumComplex) {
    tier = 'MEDIUM';
    distance = Math.min(weightedScore - simpleMedium, mediumComplex - weightedScore);
  } else if (weightedScore < complexReasoning) {
    tier = 'COMPLEX';
    distance = Math.min(weightedScore - mediumComplex, complexReasoning - weightedScore);
  } else {
    tier = 'REASONING';
    distance = weightedScore - complexReasoning;
  }

  const category = determineCategory(dimensions, agentic.score);
  const confidence = calibrateConfidence(distance, cfg.confidenceSteepness);

  return { tier, category, confidence, score: weightedScore, signals, dimensions, agenticScore: agentic.score };
}

/**
 * Quick check if a request is simple enough for a fast/cheap model.
 */
export function isSimpleRequest(userMessage: string, tokenCount: number): boolean {
  const result = classifyRequest(userMessage, undefined, tokenCount);
  return (result.tier === 'SIMPLE' || result.tier === 'MEDIUM') && result.confidence >= 0.4 && result.score < 0;
}

/**
 * Extract the last user message from a request body.
 */
export function extractLastUserMessage(reqBody: any): string {
  const messages = Array.isArray(reqBody?.messages) ? reqBody.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' && msg.role !== 'human') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text || '');
      return textParts.join('\n');
    }
  }
  return '';
}
