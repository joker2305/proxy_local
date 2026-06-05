import type { Config } from '../types/llm';

export interface ProviderPreset {
  name: string;
  api_base_url: string;
  models: string[];
  transformer: { use: string[]; [key: string]: any };
  role?: 'primary' | 'fallback';
  mappedTo?: ('opus' | 'sonnet' | 'haiku')[];
}

export const DEEPSEEK_PRESET: ProviderPreset = {
  name: 'deepseek',
  api_base_url: 'https://api.deepseek.com/chat/completions',
  models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  transformer: {
    use: ['deepseek'],
    'deepseek-v4-pro': { use: ['deepseek'] },
    'deepseek-v4-flash': { use: ['deepseek'] },
  },
  role: 'fallback',
  mappedTo: ['opus', 'sonnet', 'haiku'],
};

export const GLM_PRESET: ProviderPreset = {
  name: 'glm',
  api_base_url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  models: ['glm-5.1'],
  transformer: {
    use: ['glm'],
    'glm-5.1': { use: ['glm'] },
  },
  role: 'primary',
  mappedTo: ['opus'],
};

export const GLM_CODING_PRESET: ProviderPreset = {
  name: 'glm-coding',
  api_base_url: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
  models: ['glm-5.1'],
  transformer: {
    use: ['glm'],
    'glm-5.1': { use: ['glm'] },
  },
  role: 'primary',
  mappedTo: ['opus'],
};

export const OLLAMA_PRESET: ProviderPreset = {
  name: 'ollama',
  api_base_url: 'http://localhost:11434/v1/chat/completions',
  models: ['qwen2.5-coder:7b'],
  transformer: { use: ['openai'] },
  role: 'fallback',
  mappedTo: ['haiku'],
};

interface RoleMapping {
  opus: string;
  sonnet: string;
  haiku: string;
}

function getProviderModel(providers: any[], providerName: string, modelPrefix: string): string | null {
  const provider = providers.find(p => p.name === providerName);
  if (!provider) return null;
  const model = (provider.models || []).find((m: string) => m.startsWith(modelPrefix) || m === modelPrefix);
  return model ? `${providerName},${model}` : null;
}

function hasProviderWithName(providers: any[], name: string): boolean {
  return providers.some(p => p.name === name);
}

function hasProviderWithModel(providers: any[], modelPrefix: string): boolean {
  return providers.some(p => (p.models || []).some((m: string) => m.startsWith(modelPrefix)));
}

export function generateSmartMapping(providers: any[]): {
  mapping: Record<string, string>;
  router: Record<string, string>;
  fallback: Record<string, string[]>;
} {
  const hasDeepseek = hasProviderWithName(providers, 'deepseek');
  const hasGlm = hasProviderWithName(providers, 'glm') || hasProviderWithName(providers, 'glm-coding');
  const hasOllama = hasProviderWithName(providers, 'ollama');
  const hasOpenai = hasProviderWithName(providers, 'openai');
  const hasGemini = hasProviderWithName(providers, 'gemini');

  const mapping: Record<string, string> = {};
  const router: Record<string, string> = {};
  const fallback: Record<string, string[]> = {};

  const hasV4Pro = hasProviderWithModel(providers, 'deepseek-v4-pro');
  const hasV4Flash = hasProviderWithModel(providers, 'deepseek-v4-flash') || hasProviderWithModel(providers, 'deepseek-chat');
  const hasGlm51 = hasProviderWithModel(providers, 'glm-5.1');

  let opusTarget: string | null = null;
  let sonnetTarget: string | null = null;
  let haikuTarget: string | null = null;
  const opusFallback: string[] = [];
  const sonnetFallback: string[] = [];

  if (hasGlm && hasGlm51) {
    const glmProvider = providers.find(p => p.name === 'glm' || p.name === 'glm-coding');
    opusTarget = `${glmProvider.name},glm-5.1`;
    if (hasDeepseek && hasV4Pro) {
      opusFallback.push('deepseek,deepseek-v4-pro');
    }
  } else if (hasDeepseek && hasV4Pro) {
    opusTarget = 'deepseek,deepseek-v4-pro';
  }

  if (hasDeepseek && hasV4Flash) {
    sonnetTarget = 'deepseek,deepseek-v4-flash';
    haikuTarget = 'deepseek,deepseek-v4-flash';
  } else if (hasDeepseek && hasV4Pro) {
    sonnetTarget = 'deepseek,deepseek-v4-pro';
    haikuTarget = 'deepseek,deepseek-v4-pro';
  }

  if (hasGlm && hasGlm51 && !sonnetTarget) {
    sonnetTarget = `${providers.find(p => p.name === 'glm' || p.name === 'glm-coding')?.name || 'glm'},glm-5.1`;
  }

  if (hasOllama && !haikuTarget) {
    const ollamaModels = providers.find(p => p.name === 'ollama')?.models || [];
    if (ollamaModels.length > 0) {
      haikuTarget = `ollama,${ollamaModels[0]}`;
    }
  }

  if (hasOpenai && !opusTarget) {
    const openaiModels = providers.find(p => p.name === 'openai')?.models || [];
    const gpt4 = openaiModels.find((m: string) => m.startsWith('gpt-4'));
    if (gpt4) {
      opusTarget = `openai,${gpt4}`;
    }
  }

  if (hasGemini && !sonnetTarget) {
    const geminiModels = providers.find(p => p.name === 'gemini')?.models || [];
    const flash = geminiModels.find((m: string) => m.includes('flash'));
    if (flash) {
      sonnetTarget = `gemini,${flash}`;
    }
  }

  if (opusTarget) {
    mapping['claude-opus-4-6'] = opusTarget;
    mapping['claude-opus-4-20250514'] = opusTarget;
    mapping['claude-opus-4'] = opusTarget;
    mapping['opus'] = opusTarget;
    router.default = opusTarget;
    router.think = opusTarget;
    router.reasoningProMax = opusTarget;
    router.longContext = opusTarget;
  }

  if (sonnetTarget) {
    mapping['claude-sonnet-4-6'] = sonnetTarget;
    mapping['claude-sonnet-4-20250514'] = sonnetTarget;
    mapping['claude-sonnet-4'] = sonnetTarget;
    mapping['sonnet'] = sonnetTarget;
    if (!router.default) router.default = sonnetTarget;
    router.reasoningFlash = sonnetTarget;
  }

  if (haikuTarget) {
    mapping['claude-haiku-4-5-20251213'] = haikuTarget;
    mapping['claude-haiku-4-5'] = haikuTarget;
    mapping['haiku'] = haikuTarget;
    router.background = haikuTarget;
  }

  if (opusFallback.length > 0) {
    fallback.default = [...opusFallback];
    fallback.think = [...opusFallback];
  }
  if (sonnetTarget && opusTarget !== sonnetTarget) {
    if (!fallback.default) fallback.default = [];
    fallback.default.push(sonnetTarget);
  }

  router.longContextThreshold = 60000;

  return { mapping, router, fallback };
}

export function generateDefaultConfig(userApiKey?: string, glmApiKey?: string): Partial<Config> {
  const deepseekProvider: any = {
    name: 'deepseek',
    api_base_url: 'https://api.deepseek.com/chat/completions',
    api_key: userApiKey || '${DEEPSEEK_API_KEY}',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    transformer: {
      use: ['deepseek'],
    },
    priority: 1,
  };

  const providers = [deepseekProvider];

  const { mapping, router, fallback } = generateSmartMapping(providers);

  return {
    Providers: providers as any,
    Router: router as any,
    ModelMapping: mapping as any,
    fallback,
    Concurrency: {
      global: 10,
      providers: { deepseek: 5 },
      queueTimeoutMs: 120000,
    },
  } as any;
}
