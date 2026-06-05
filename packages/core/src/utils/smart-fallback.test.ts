import { describe, it, expect } from 'vitest';
import { generateFallbackChain, getFallbackTemplates } from '../utils/smart-fallback';

describe('generateFallbackChain', () => {
  it('should generate chain for SIMPLE/simple_chat', () => {
    const chain = generateFallbackChain('SIMPLE', 'simple_chat', ['deepseek', 'glm']);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]).toContain('deepseek-v4-flash');
  });

  it('should generate chain for REASONING/reasoning with DeepSeek Pro first', () => {
    const chain = generateFallbackChain('REASONING', 'reasoning', ['deepseek', 'glm']);
    expect(chain[0]).toContain('deepseek-v4-pro');
  });

  it('should generate chain for COMPLEX/coding with GLM first', () => {
    const chain = generateFallbackChain('COMPLEX', 'coding', ['deepseek', 'glm']);
    expect(chain[0]).toContain('glm-5.1');
  });

  it('should filter by available providers', () => {
    const chain = generateFallbackChain('REASONING', 'reasoning', ['deepseek']);
    expect(chain.every(c => c.startsWith('deepseek'))).toBe(true);
  });

  it('should return all when no providers available', () => {
    const chain = generateFallbackChain('SIMPLE', 'simple_chat', []);
    expect(chain.length).toBeGreaterThan(0);
  });

  it('should use config override when provided', () => {
    const chain = generateFallbackChain('SIMPLE', 'simple_chat', ['deepseek'], {
      default: ['deepseek,deepseek-v4-pro'],
    });
    expect(chain).toEqual(['deepseek,deepseek-v4-pro']);
  });

  it('should use scenario-specific config override', () => {
    const chain = generateFallbackChain('COMPLEX', 'coding', ['deepseek', 'glm'], {
      complex_coding: ['glm,glm-5.1'],
    });
    expect(chain).toEqual(['glm,glm-5.1']);
  });
});

describe('getFallbackTemplates', () => {
  it('should return all templates', () => {
    const templates = getFallbackTemplates();
    expect(Object.keys(templates).length).toBe(32); // 4 tiers * 8 categories
    expect(templates['REASONING_reasoning']).toBeDefined();
    expect(templates['SIMPLE_simple_chat']).toBeDefined();
  });
});
