/**
 * Smart Fallback Chain Generator.
 *
 * Generates fallback chains based on task classification results.
 * Instead of a static fallback list, the chain is ordered by:
 *   1. Task category (coding → GLM first, reasoning → DeepSeek Pro first)
 *   2. Task tier (SIMPLE → cheap models, REASONING → strong models)
 *   3. Provider availability (skip providers without API keys)
 *
 * Used by the router to build dynamic fallback chains per-request.
 */

import type { TaskTier, TaskCategory } from './task-classifier';

export interface FallbackCandidate {
  provider: string;
  model: string;
  strategy: string;
  reason: string;
}

const FALLBACK_TEMPLATES: Record<TaskTier, Record<TaskCategory, string[]>> = {
  SIMPLE: {
    simple_chat: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1', 'ollama,qwen2.5-coder:7b'],
    general: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    coding: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    reasoning: ['deepseek,deepseek-v4-flash', 'deepseek,deepseek-v4-pro'],
    creative: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    data: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    agentic: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    translation: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
  },
  MEDIUM: {
    simple_chat: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
    general: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1', 'deepseek,deepseek-v4-pro'],
    coding: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    reasoning: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    creative: ['glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    data: ['deepseek,deepseek-v4-flash', 'deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
    agentic: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    translation: ['deepseek,deepseek-v4-flash', 'glm,glm-5.1'],
  },
  COMPLEX: {
    simple_chat: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
    general: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    coding: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    reasoning: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    creative: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro'],
    data: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    agentic: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    translation: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
  },
  REASONING: {
    simple_chat: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
    general: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    coding: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    reasoning: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    creative: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
    data: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1', 'deepseek,deepseek-v4-flash'],
    agentic: ['glm,glm-5.1', 'deepseek,deepseek-v4-pro', 'deepseek,deepseek-v4-flash'],
    translation: ['deepseek,deepseek-v4-pro', 'glm,glm-5.1'],
  },
};

/**
 * Generate a smart fallback chain based on task classification.
 * Filters out unavailable providers and returns ordered fallback candidates.
 */
export function generateFallbackChain(
  tier: TaskTier,
  category: TaskCategory,
  availableProviders: string[],
  configFallback?: Record<string, string[]>,
): string[] {
  // 1. Check config override first
  if (configFallback) {
    const scenarioKey = `${tier.toLowerCase()}_${category}`;
    const configChain = configFallback[scenarioKey] || configFallback[tier.toLowerCase()] || configFallback['default'];
    if (configChain && Array.isArray(configChain) && configChain.length > 0) {
      return filterByAvailability(configChain, availableProviders);
    }
  }

  // 2. Use template-based generation
  const template = FALLBACK_TEMPLATES[tier]?.[category] || FALLBACK_TEMPLATES[tier]?.general || [];
  return filterByAvailability(template, availableProviders);
}

function filterByAvailability(chain: string[], available: string[]): string[] {
  if (available.length === 0) return chain;
  const availableLower = new Set(available.map(p => p.toLowerCase()));
  return chain.filter(entry => {
    const provider = entry.split(',')[0]?.toLowerCase();
    return !provider || availableLower.has(provider);
  });
}

/**
 * Get all fallback templates for UI display.
 */
export function getFallbackTemplates(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [tier, categories] of Object.entries(FALLBACK_TEMPLATES)) {
    for (const [category, chain] of Object.entries(categories)) {
      result[`${tier}_${category}`] = chain;
    }
  }
  return result;
}
