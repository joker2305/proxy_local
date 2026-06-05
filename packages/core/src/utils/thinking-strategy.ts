/**
 * Thinking Strategy — multi-chain reasoning model selection.
 *
 * Manages multiple "thinking strategies" that define how different models
 * handle reasoning tasks. Each strategy specifies:
 *   - Which provider+model to use
 *   - Thinking mode configuration (clear_thinking, reasoning_effort, etc.)
 *   - Which task categories it's best suited for
 *   - Parameter overrides
 *
 * The router selects a strategy based on:
 *   1. Task classification result (tier + category)
 *   2. Available providers (checks if API key exists)
 *   3. User override (manual selection via UI or config)
 *
 * Strategies work alongside fallback chains:
 *   - Primary: selected strategy
 *   - Fallback: ordered list of alternative strategies on failure
 */

import type { TaskTier, TaskCategory } from './task-classifier';

export interface ThinkingConfig {
  type?: 'enabled' | 'disabled';
  /** DeepSeek: 'low' | 'medium' | 'max' | 'auto' */
  reasoning_effort?: string;
  /** GLM: keep thinking context across turns */
  clear_thinking?: boolean;
  /** Budget tokens for thinking */
  budget_tokens?: number;
}

export interface StrategyParams {
  temperature?: number;
  max_tokens?: number;
  do_sample?: boolean;
  tool_stream?: boolean;
  top_p?: number;
  [key: string]: any;
}

export interface ThinkingStrategy {
  name: string;
  description: string;
  provider: string;
  model: string;
  thinking: ThinkingConfig;
  params: StrategyParams;
  bestFor: TaskCategory[];
  tierRange: TaskTier[];
  priority: number;
}

export interface StrategySelection {
  strategy: ThinkingStrategy;
  model: string;
  reason: string;
  fallbackStrategies: string[];
}

const BUILTIN_STRATEGIES: ThinkingStrategy[] = [
  {
    name: 'glm_coding_plan',
    description: 'GLM-5.1 coding plan — keeps reasoning context across turns',
    provider: 'glm',
    model: 'glm-5.1',
    thinking: { type: 'enabled', clear_thinking: false, budget_tokens: 32768 },
    params: { do_sample: true, temperature: 1.0, tool_stream: true },
    bestFor: ['coding', 'agentic'],
    tierRange: ['COMPLEX', 'REASONING'],
    priority: 90,
  },
  {
    name: 'deepseek_pro_max',
    description: 'DeepSeek V4 Pro max reasoning — strongest single-pass reasoning',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    thinking: { type: 'enabled', reasoning_effort: 'max', budget_tokens: 65536 },
    params: { max_tokens: 65536 },
    bestFor: ['reasoning', 'data'],
    tierRange: ['REASONING'],
    priority: 95,
  },
  {
    name: 'deepseek_pro_standard',
    description: 'DeepSeek V4 Pro standard — balanced reasoning for complex tasks',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    thinking: { type: 'enabled', reasoning_effort: 'medium' },
    params: { max_tokens: 32768 },
    bestFor: ['coding', 'reasoning', 'general', 'creative'],
    tierRange: ['COMPLEX', 'REASONING'],
    priority: 80,
  },
  {
    name: 'deepseek_flash_thinking',
    description: 'DeepSeek V4 Flash with thinking — fast reasoning for medium tasks',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    thinking: { type: 'enabled', reasoning_effort: 'low', budget_tokens: 16384 },
    params: { max_tokens: 16384 },
    bestFor: ['general', 'data', 'coding'],
    tierRange: ['MEDIUM', 'COMPLEX'],
    priority: 60,
  },
  {
    name: 'deepseek_flash_fast',
    description: 'DeepSeek V4 Flash — fast responses for simple tasks',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    thinking: {},
    params: {},
    bestFor: ['simple_chat', 'general', 'translation'],
    tierRange: ['SIMPLE', 'MEDIUM'],
    priority: 50,
  },
  {
    name: 'glm_standard',
    description: 'GLM-5.1 standard — balanced coding and general tasks',
    provider: 'glm',
    model: 'glm-5.1',
    thinking: { type: 'enabled', clear_thinking: true },
    params: { do_sample: true, temperature: 1.0 },
    bestFor: ['coding', 'general', 'creative'],
    tierRange: ['MEDIUM', 'COMPLEX'],
    priority: 70,
  },
  {
    name: 'ollama_local',
    description: 'Ollama local — offline fallback for simple tasks',
    provider: 'ollama',
    model: 'qwen2.5-coder:7b',
    thinking: {},
    params: {},
    bestFor: ['simple_chat', 'general', 'translation'],
    tierRange: ['SIMPLE'],
    priority: 10,
  },
];

export class ThinkingStrategyManager {
  private strategies: Map<string, ThinkingStrategy> = new Map();
  private availableProviders: Set<string> = new Set();
  private userOverrides: Map<TaskTier, string> = new Map();
  private logger?: any;

  constructor(logger?: any) {
    this.logger = logger;
    for (const s of BUILTIN_STRATEGIES) {
      this.strategies.set(s.name, s);
    }
  }

  updateAvailableProviders(providers: Array<{ name: string; api_key?: string }>): void {
    this.availableProviders = new Set(
      providers.filter(p => p.api_key && p.api_key.length > 0).map(p => p.name.toLowerCase())
    );
  }

  setUserOverride(tier: TaskTier, strategyName: string): void {
    this.userOverrides.set(tier, strategyName);
  }

  clearUserOverride(tier: TaskTier): void {
    this.userOverrides.delete(tier);
  }

  addCustomStrategy(strategy: ThinkingStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  removeStrategy(name: string): void {
    if (!BUILTIN_STRATEGIES.find(s => s.name === name)) {
      this.strategies.delete(name);
    }
  }

  getAllStrategies(): ThinkingStrategy[] {
    return Array.from(this.strategies.values());
  }

  getStrategy(name: string): ThinkingStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Select the best strategy for a given classification result.
   * Returns the selected strategy + fallback chain.
   */
  selectStrategy(
    tier: TaskTier,
    category: TaskCategory,
    _tokenCount: number,
  ): StrategySelection {
    // 1. Check user override
    const override = this.userOverrides.get(tier);
    if (override) {
      const overrideStrategy = this.strategies.get(override);
      if (overrideStrategy && this.isAvailable(overrideStrategy)) {
        return {
          strategy: overrideStrategy,
          model: `${overrideStrategy.provider},${overrideStrategy.model}`,
          reason: `User override for ${tier}: ${override}`,
          fallbackStrategies: this.buildFallbackList(overrideStrategy, tier),
        };
      }
    }

    // 2. Score all available strategies for this tier+category
    const candidates = Array.from(this.strategies.values())
      .filter(s => this.isAvailable(s))
      .filter(s => s.tierRange.includes(tier))
      .map(s => ({
        strategy: s,
        score: this.scoreStrategy(s, tier, category),
      }))
      .sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      // Fallback to any available strategy
      const anyAvailable = Array.from(this.strategies.values())
        .filter(s => this.isAvailable(s))
        .sort((a, b) => b.priority - a.priority);

      if (anyAvailable.length > 0) {
        const fallback = anyAvailable[0];
        return {
          strategy: fallback,
          model: `${fallback.provider},${fallback.model}`,
          reason: `No strategy for ${tier}/${category}, using best available: ${fallback.name}`,
          fallbackStrategies: [],
        };
      }

      // Absolute fallback: return deepseek_flash_fast
      const lastResort = BUILTIN_STRATEGIES.find(s => s.name === 'deepseek_flash_fast')!;
      return {
        strategy: lastResort,
        model: `${lastResort.provider},${lastResort.model}`,
        reason: 'No available providers, using default strategy',
        fallbackStrategies: [],
      };
    }

    const best = candidates[0];
    return {
      strategy: best.strategy,
      model: `${best.strategy.provider},${best.strategy.model}`,
      reason: `${tier}/${category} → ${best.strategy.name} (score=${best.score.toFixed(2)})`,
      fallbackStrategies: candidates.slice(1).map(c => c.strategy.name),
    };
  }

  /**
   * Get the thinking config to inject into the request body
   * based on the selected strategy.
   */
  getThinkingConfig(strategy: ThinkingStrategy): Record<string, any> {
    const config: Record<string, any> = {};

    if (strategy.thinking.type) {
      config.thinking = { type: strategy.thinking.type };

      if (strategy.thinking.budget_tokens) {
        config.thinking.budget_tokens = strategy.thinking.budget_tokens;
      }

      // DeepSeek-specific
      if (strategy.thinking.reasoning_effort) {
        config.thinking.reasoning_effort = strategy.thinking.reasoning_effort;
      }

      // GLM-specific
      if (strategy.thinking.clear_thinking !== undefined) {
        config.thinking.clear_thinking = strategy.thinking.clear_thinking;
      }
    }

    return config;
  }

  /**
   * Apply strategy parameters to request body.
   */
  applyParams(body: any, strategy: ThinkingStrategy): any {
    const result = { ...body };

    for (const [key, value] of Object.entries(strategy.params)) {
      if (result[key] === undefined) {
        result[key] = value;
      }
    }

    // Apply thinking config
    const thinkingConfig = this.getThinkingConfig(strategy);
    if (thinkingConfig.thinking) {
      // Only set thinking if user didn't explicitly enable it
      if (!result.thinking) {
        result.thinking = thinkingConfig.thinking;
      }
    }

    return result;
  }

  private isAvailable(strategy: ThinkingStrategy): boolean {
    return this.availableProviders.has(strategy.provider.toLowerCase());
  }

  private scoreStrategy(strategy: ThinkingStrategy, tier: TaskTier, category: TaskCategory): number {
    let score = strategy.priority;

    // Category match bonus
    if (strategy.bestFor.includes(category)) {
      score += 30;
    }

    // Tier match bonus (exact tier gets more points)
    const tierIndex = ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'].indexOf(tier);
    const strategyTiers = strategy.tierRange.map(t => ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'].indexOf(t));
    const minTier = Math.min(...strategyTiers);
    const maxTier = Math.max(...strategyTiers);

    if (tierIndex >= minTier && tierIndex <= maxTier) {
      score += 20;
    }

    // Prefer strategies specifically designed for this tier
    if (strategy.tierRange.length === 1 && strategy.tierRange[0] === tier) {
      score += 10;
    }

    return score;
  }

  private buildFallbackList(primary: ThinkingStrategy, tier: TaskTier): string[] {
    return Array.from(this.strategies.values())
      .filter(s => s.name !== primary.name)
      .filter(s => this.isAvailable(s))
      .filter(s => s.tierRange.includes(tier) || s.tierRange.some(t =>
        ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'].indexOf(t) >
        ['SIMPLE', 'MEDIUM', 'COMPLEX', 'REASONING'].indexOf(tier)
      ))
      .sort((a, b) => b.priority - a.priority)
      .map(s => s.name);
  }
}

let globalManager: ThinkingStrategyManager | null = null;

export function getThinkingStrategyManager(logger?: any): ThinkingStrategyManager {
  if (!globalManager) {
    globalManager = new ThinkingStrategyManager(logger);
  }
  return globalManager;
}
