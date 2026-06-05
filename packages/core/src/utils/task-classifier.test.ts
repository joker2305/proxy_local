import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyRequest,
  extractLastUserMessage,
  isSimpleRequest,
} from '../utils/task-classifier';
import type { TaskTier, TaskCategory } from '../utils/task-classifier';
import { ThinkingStrategyManager } from '../utils/thinking-strategy';
import type { ThinkingStrategy } from '../utils/thinking-strategy';

// ===========================================================================
// Task Classifier Tests
// ===========================================================================

describe('classifyRequest', () => {
  it('should classify a simple greeting as SIMPLE or MEDIUM', () => {
    const result = classifyRequest('hello, thanks for the help!', undefined, 10);
    expect(['SIMPLE', 'MEDIUM']).toContain(result.tier);
    expect(['simple_chat', 'general']).toContain(result.category);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should classify a code request as COMPLEX/coding', () => {
    const result = classifyRequest(
      'Please implement a function that class import and export data using async await',
      undefined, 500
    );
    expect(['COMPLEX', 'REASONING']).toContain(result.tier);
    expect(result.category).toBe('coding');
  });

  it('should classify a reasoning request as REASONING', () => {
    const result = classifyRequest(
      'Please analyze the trade-off between using a microservice architecture vs monolith. Prove why one approach is better. Justify your reasoning.',
      undefined, 2000
    );
    expect(result.tier).toBe('REASONING');
    expect(result.category).toBe('reasoning');
  });

  it('should classify agentic tasks correctly', () => {
    const result = classifyRequest(
      'Use the search tool to browse the web, execute the script, and fetch the results from the API',
      undefined, 1500
    );
    expect(result.category).toBe('agentic');
    expect(result.agenticScore).toBeGreaterThan(0);
  });

  it('should classify multi-step tasks', () => {
    const result = classifyRequest(
      'First, read the file. Then, parse the data. Finally, generate the report.',
      undefined, 1000
    );
    expect(result.signals.some(s => s.includes('multi-step'))).toBe(true);
  });

  it('should classify domain-specific (trading) tasks', () => {
    const result = classifyRequest(
      'Calculate the Sharpe ratio for the backtest results, including max drawdown and position sizing',
      undefined, 1500
    );
    expect(result.dimensions.some(d => d.name === 'domainSpecificity' && d.score > 0)).toBe(true);
  });

  it('should classify short messages as SIMPLE or MEDIUM', () => {
    const result = classifyRequest('ok, got it', undefined, 5);
    expect(['SIMPLE', 'MEDIUM']).toContain(result.tier);
  });

  it('should classify long messages with complexity', () => {
    const longMsg = 'Implement a comprehensive error handling system. '.repeat(100) +
      'The system must ensure all errors are captured, validated, and properly formatted as JSON.';
    const result = classifyRequest(longMsg, undefined, 15000);
    expect(result.tier).not.toBe('SIMPLE');
  });

  it('should return dimensions with signals', () => {
    const result = classifyRequest('implement a class with async function', undefined, 500);
    expect(result.dimensions.length).toBe(15);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('should respect custom config boundaries', () => {
    const result = classifyRequest('hello', undefined, 10, {
      tierBoundaries: { simpleMedium: 0.5, mediumComplex: 0.6, complexReasoning: 0.7 },
    });
    expect(result.tier).toBe('SIMPLE');
  });

  it('should handle Chinese text', () => {
    const result = classifyRequest('请优化这段代码，重构架构设计，验证正确性', undefined, 500);
    expect(['COMPLEX', 'REASONING']).toContain(result.tier);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});

describe('extractLastUserMessage', () => {
  it('should extract string content from last user message', () => {
    const body = {
      messages: [
        { role: 'user', content: 'first message' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'second message' },
      ],
    };
    expect(extractLastUserMessage(body)).toBe('second message');
  });

  it('should extract text from array content', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello world' },
            { type: 'image', source: { data: '...' } },
          ],
        },
      ],
    };
    expect(extractLastUserMessage(body)).toBe('hello world');
  });

  it('should return empty string for no messages', () => {
    expect(extractLastUserMessage({})).toBe('');
    expect(extractLastUserMessage({ messages: [] })).toBe('');
  });
});

describe('isSimpleRequest', () => {
  it('should return true for clearly simple requests', () => {
    expect(isSimpleRequest('yes ok thank you goodbye', 5)).toBe(true);
  });

  it('should return false for complex requests', () => {
    expect(isSimpleRequest('Implement a complex algorithm and optimize the performance', 5000)).toBe(false);
  });
});

// ===========================================================================
// Thinking Strategy Manager Tests
// ===========================================================================

describe('ThinkingStrategyManager', () => {
  let manager: ThinkingStrategyManager;

  beforeEach(() => {
    manager = new ThinkingStrategyManager();
    manager.updateAvailableProviders([
      { name: 'deepseek', api_key: 'sk-test' },
      { name: 'glm', api_key: 'sk-test' },
      { name: 'ollama', api_key: 'anything' },
    ]);
  });

  it('should select glm_coding_plan for coding COMPLEX', () => {
    const result = manager.selectStrategy('COMPLEX', 'coding', 5000);
    expect(result.strategy.name).toBe('glm_coding_plan');
    expect(result.model).toBe('glm,glm-5.1');
    expect(result.fallbackStrategies.length).toBeGreaterThan(0);
  });

  it('should select deepseek_pro_max for REASONING/reasoning', () => {
    const result = manager.selectStrategy('REASONING', 'reasoning', 8000);
    expect(result.strategy.name).toBe('deepseek_pro_max');
    expect(result.model).toBe('deepseek,deepseek-v4-pro');
  });

  it('should select deepseek_flash_fast for SIMPLE/simple_chat', () => {
    const result = manager.selectStrategy('SIMPLE', 'simple_chat', 50);
    expect(result.strategy.name).toBe('deepseek_flash_fast');
    expect(result.model).toBe('deepseek,deepseek-v4-flash');
  });

  it('should respect user overrides', () => {
    manager.setUserOverride('REASONING', 'glm_coding_plan');
    const result = manager.selectStrategy('REASONING', 'reasoning', 5000);
    expect(result.strategy.name).toBe('glm_coding_plan');
    expect(result.reason).toContain('User override');
  });

  it('should clear user overrides', () => {
    manager.setUserOverride('REASONING', 'glm_coding_plan');
    manager.clearUserOverride('REASONING');
    const result = manager.selectStrategy('REASONING', 'reasoning', 5000);
    expect(result.strategy.name).toBe('deepseek_pro_max');
  });

  it('should skip unavailable providers', () => {
    const limitedManager = new ThinkingStrategyManager();
    limitedManager.updateAvailableProviders([
      { name: 'deepseek', api_key: 'sk-test' },
    ]);
    const result = limitedManager.selectStrategy('COMPLEX', 'coding', 5000);
    expect(result.strategy.provider).toBe('deepseek');
  });

  it('should apply thinking config to request body', () => {
    const strategy = manager.getStrategy('deepseek_pro_max')!;
    const body = { messages: [], model: 'test' };
    const applied = manager.applyParams(body, strategy);
    expect(applied.thinking).toBeDefined();
    expect(applied.thinking.type).toBe('enabled');
    expect(applied.thinking.reasoning_effort).toBe('max');
  });

  it('should apply GLM thinking config with clear_thinking', () => {
    const strategy = manager.getStrategy('glm_coding_plan')!;
    const body = { messages: [], model: 'test' };
    const applied = manager.applyParams(body, strategy);
    expect(applied.thinking.clear_thinking).toBe(false);
    expect(applied.do_sample).toBe(true);
    expect(applied.temperature).toBe(1.0);
  });

  it('should not override existing thinking config', () => {
    const strategy = manager.getStrategy('deepseek_pro_max')!;
    const body = { messages: [], model: 'test', thinking: { type: 'disabled' } };
    const applied = manager.applyParams(body, strategy);
    expect(applied.thinking.type).toBe('disabled');
  });

  it('should return all strategies', () => {
    const strategies = manager.getAllStrategies();
    expect(strategies.length).toBeGreaterThanOrEqual(7);
  });

  it('should add custom strategy', () => {
    const custom: ThinkingStrategy = {
      name: 'custom_test',
      description: 'Test',
      provider: 'deepseek',
      model: 'custom-model',
      thinking: {},
      params: {},
      bestFor: ['general'],
      tierRange: ['SIMPLE'],
      priority: 100,
    };
    manager.addCustomStrategy(custom);
    const found = manager.getStrategy('custom_test');
    expect(found).toBeDefined();
    expect(found!.model).toBe('custom-model');
  });

  it('should not remove builtin strategies', () => {
    manager.removeStrategy('deepseek_pro_max');
    expect(manager.getStrategy('deepseek_pro_max')).toBeDefined();
  });

  it('should remove custom strategies', () => {
    const custom: ThinkingStrategy = {
      name: 'removable',
      description: 'Test',
      provider: 'test',
      model: 'test',
      thinking: {},
      params: {},
      bestFor: ['general'],
      tierRange: ['SIMPLE'],
      priority: 50,
    };
    manager.addCustomStrategy(custom);
    manager.removeStrategy('removable');
    expect(manager.getStrategy('removable')).toBeUndefined();
  });

  it('should fallback when no providers available', () => {
    const emptyManager = new ThinkingStrategyManager();
    emptyManager.updateAvailableProviders([]);
    const result = emptyManager.selectStrategy('COMPLEX', 'coding', 5000);
    expect(result.strategy).toBeDefined();
    expect(result.model).toContain('deepseek');
  });

  it('should get thinking config correctly for each strategy', () => {
    const glmConfig = manager.getThinkingConfig(manager.getStrategy('glm_coding_plan')!);
    expect(glmConfig.thinking.clear_thinking).toBe(false);

    const dsConfig = manager.getThinkingConfig(manager.getStrategy('deepseek_pro_max')!);
    expect(dsConfig.thinking.reasoning_effort).toBe('max');

    const flashConfig = manager.getThinkingConfig(manager.getStrategy('deepseek_flash_fast')!);
    expect(flashConfig.thinking).toBeUndefined();
  });
});
