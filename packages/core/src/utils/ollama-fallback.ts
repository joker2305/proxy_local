/**
 * Ollama Fallback - 本地模型降级
 *
 * When upstream providers timeout or fail, falls back to local Ollama models:
 * - Timeout detection (configurable threshold)
 * - Automatic retry with local model
 * - Response quality preservation
 * - Graceful degradation
 *
 * Design: Zero external dependencies. Uses proxy self-calls to Ollama provider.
 */

export interface OllamaFallbackConfig {
  enabled: boolean;
  /** Ollama provider name in config */
  ollamaProvider: string;
  /** Local model to use for fallback */
  fallbackModel: string;
  /** Direct Ollama API endpoint (bypasses proxy self-call) */
  ollamaEndpoint: string;
  /** Proxy port (kept for backward compat, prefer ollamaEndpoint) */
  proxyPort: number;
  /** API key for self-calls */
  apiKey: string;
  /** Timeout threshold in ms before triggering fallback */
  timeoutThresholdMs: number;
  /** Max retry attempts with Ollama */
  maxRetries: number;
  /** Timeout for Ollama requests in ms */
  ollamaTimeoutMs: number;
}

const DEFAULT_CONFIG: OllamaFallbackConfig = {
  enabled: false,
  ollamaProvider: 'ollama',
  fallbackModel: 'qwen2.5-coder:7b',
  ollamaEndpoint: 'http://127.0.0.1:11434',
  proxyPort: 3456,
  apiKey: '',
  timeoutThresholdMs: 30000,
  maxRetries: 1,
  ollamaTimeoutMs: 60000,
};

export interface FallbackResult {
  used: boolean;
  response: any | null;
  model: string;
  latencyMs: number;
  reason: string;
}

export class OllamaFallback {
  private config: OllamaFallbackConfig;
  private logger?: any;

  constructor(config: Partial<OllamaFallbackConfig> = {}, logger?: any) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Try to get a response from Ollama when upstream fails.
   */
  async fallback(body: any, reason: string): Promise<FallbackResult> {
    if (!this.config.enabled) {
      return { used: false, response: null, model: '', latencyMs: 0, reason };
    }

    const startTime = Date.now();
    const model = this.config.fallbackModel;
    this.logger?.warn(`OllamaFallback: triggered (${reason}), using ${model}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.ollamaTimeoutMs);

    try {
      const messages = (body?.messages || []).map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

      const response = await fetch(`${this.config.ollamaEndpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: body?.temperature,
            top_p: body?.top_p,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger?.warn(`OllamaFallback: Ollama returned ${response.status}`);
        return { used: true, response: null, model, latencyMs: Date.now() - startTime, reason };
      }

      const data = await response.json();

      const anthropicResponse = {
        id: `ollama-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: data.message?.content || '' }],
        model,
        stop_reason: data.done_reason || 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: data.prompt_eval_count || 0,
          output_tokens: data.eval_count || 0,
        },
      };

      this.logger?.info(`OllamaFallback: succeeded in ${Date.now() - startTime}ms`);

      return {
        used: true,
        response: anthropicResponse,
        model,
        latencyMs: Date.now() - startTime,
        reason,
      };
    } catch (e: any) {
      clearTimeout(timeout);
      this.logger?.warn(`OllamaFallback: failed (${e?.message})`);
      return { used: true, response: null, model, latencyMs: Date.now() - startTime, reason };
    }
  }

  /**
   * Check if a request is eligible for Ollama fallback.
   */
  isEligible(body: any): boolean {
    if (!this.config.enabled) return false;
    if (body?.model?.includes('ollama')) return false;
    return true;
  }

  /**
   * Update configuration.
   */
  updateConfig(config: Partial<OllamaFallbackConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

let globalFallback: OllamaFallback | null = null;

export function getOllamaFallback(config?: Partial<OllamaFallbackConfig>, logger?: any): OllamaFallback {
  if (!globalFallback) {
    globalFallback = new OllamaFallback(config, logger);
  } else if (config) {
    globalFallback.updateConfig(config);
  }
  return globalFallback;
}
