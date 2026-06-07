import { get_encoding } from "tiktoken";
import { sessionUsageCache, Usage } from "./cache";
import { readFile } from "fs/promises";
import { opendir, stat } from "fs/promises";
import { join } from "path";
import { CLAUDE_PROJECTS_DIR, HOME_DIR } from "@CCR/shared";
import { LRUCache } from "lru-cache";
import { ConfigService } from "../services/config";
import { TokenizerService } from "../services/tokenizer";
import { resolveModelAlias } from "./model-alias";
import { resolveTier, resolveScenarioModel } from "./tier-resolver";
import type { TierResolution } from "./tier-resolver";

// ==========================================================================
// Transparent Router for OpenCode
//
// Design principle: CCR is a transparent proxy. Routing decisions should be
// made by the client (OpenCode), not by the proxy. The router only:
// 1. Parses model format (provider,model) from the request
// 2. Supports slash-prefix convenience (openai/gpt-4 → openai,gpt-4)
// 3. Supports model alias for backward compatibility
// 4. Supports config-driven tier/scenario routing (opt-in via config)
// 5. Supports config-driven health fallback
//
// Removed (OpenCode handles these):
// - Task classification + strategy selection
// - Thinking strategy manager
// - Adaptive router scoring
// - Adaptive parameter tuning
// - Reasoning-aware routing with context injection
// ==========================================================================

interface Tool {
  name: string;
  description?: string;
  input_schema: object;
}

interface ContentBlockParam {
  type: string;
  [key: string]: any;
}

interface MessageParam {
  role: string;
  content: string | ContentBlockParam[];
}

interface MessageCreateParamsBase {
  messages?: MessageParam[];
  system?: string | any[];
  tools?: Tool[];
  [key: string]: any;
}

const enc = get_encoding("cl100k_base");

export const calculateTokenCount = (
  messages: MessageParam[],
  system: any,
  tools: Tool[]
) => {
  let tokenCount = 0;
  if (Array.isArray(messages)) {
    messages.forEach((message) => {
      if (typeof message.content === "string") {
        tokenCount += enc.encode(message.content).length;
      } else if (Array.isArray(message.content)) {
        message.content.forEach((contentPart: any) => {
          if (contentPart.type === "text") {
            tokenCount += enc.encode(contentPart.text).length;
          } else if (contentPart.type === "tool_use") {
            tokenCount += enc.encode(JSON.stringify(contentPart.input)).length;
          } else if (contentPart.type === "tool_result") {
            tokenCount += enc.encode(
              typeof contentPart.content === "string"
                ? contentPart.content
                : JSON.stringify(contentPart.content)
            ).length;
          }
        });
      }
    });
  }
  if (typeof system === "string") {
    tokenCount += enc.encode(system).length;
  } else if (Array.isArray(system)) {
    system.forEach((item: any) => {
      if (item.type !== "text") return;
      if (typeof item.text === "string") {
        tokenCount += enc.encode(item.text).length;
      } else if (Array.isArray(item.text)) {
        item.text.forEach((textPart: any) => {
          tokenCount += enc.encode(textPart || "").length;
        });
      }
    });
  }
  if (tools) {
    tools.forEach((tool: Tool) => {
      if (tool.description) {
        tokenCount += enc.encode(tool.name + tool.description).length;
      }
      if (tool.input_schema) {
        tokenCount += enc.encode(JSON.stringify(tool.input_schema)).length;
      }
    });
  }
  return tokenCount;
};

const getProjectSpecificRouter = async (
  req: any,
  configService: ConfigService
) => {
  if (req.sessionId) {
    const project = await searchProjectBySession(req.sessionId);
    if (project) {
      const projectConfigPath = join(HOME_DIR, project, "config.json");
      const sessionConfigPath = join(
        HOME_DIR,
        project,
        `${req.sessionId}.json`
      );

      try {
        const sessionConfig = JSON.parse(await readFile(sessionConfigPath, "utf8"));
        if (sessionConfig && sessionConfig.Router) {
          return sessionConfig.Router;
        }
      } catch {}
      try {
        const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
        if (projectConfig && projectConfig.Router) {
          return projectConfig.Router;
        }
      } catch {}
    }
  }
  return undefined;
};

const SLASH_PREFIX_MAP: Record<string, string> = {
  'openai': 'openai',
  'xai': 'xai',
  'qwen': 'dashscope',
  'kimi': 'dashscope',
  'deepseek': 'deepseek',
  'anthropic': 'anthropic',
  'google': 'google',
  'groq': 'groq',
  'glm': 'glm',
  'cerebras': 'cerebras',
  'openrouter': 'openrouter',
};

const resolveModel = async (
  req: any,
  tokenCount: number,
  configService: ConfigService,
  lastUsage?: Usage | undefined
): Promise<{ model: string; scenarioType: RouterScenarioType }> => {
  const projectSpecificRouter = await getProjectSpecificRouter(req, configService);
  const providers = configService.get<any[]>("providers") || [];
  const Router = projectSpecificRouter || configService.get("Router");

  // Step 1: Slash-prefix routing: "openai/gpt-4.1" → "openai,gpt-4.1"
  if (req.body.model?.includes('/') && !req.body.model.includes(',')) {
    const [prefix, ...rest] = req.body.model.split('/');
    const actualModel = rest.join('/');
    const resolvedProvider = SLASH_PREFIX_MAP[prefix.toLowerCase()];
    if (resolvedProvider) {
      req.log.info(`Slash-prefix routing: ${req.body.model} → ${resolvedProvider},${actualModel}`);
      req.body.model = `${resolvedProvider},${actualModel}`;
    }
  }

  // Step 2: Tier-based resolution (only for non-comma model names, backward compat)
  let tierResolution: TierResolution | null = null;

  if (!req.body.model.includes(",")) {
    tierResolution = resolveTier(req.body.model, configService);

    if (tierResolution) {
      (req as any)._tierResolution = tierResolution;
      req.log.info(`Tier resolved: ${req.body.model} → tier=${tierResolution.tier}`);
    } else {
      // Fall back to ModelAlias (backward compatible)
      const aliasTarget = resolveModelAlias(req.body.model, configService);
      if (aliasTarget) {
        req.log.info(`Model alias resolved: ${req.body.model} → ${aliasTarget}`);
        req.body.model = aliasTarget;
      }
    }
  }

  // Step 3: If model is "provider,model" → validate and return
  if (req.body.model.includes(",")) {
    const [provider, model] = req.body.model.split(",");
    const providerLower = provider.toLowerCase();
    const modelLower = model.toLowerCase();
    const finalProvider = providers.find(
      (p: any) => p.name.toLowerCase() === providerLower
    );
    const finalModel = finalProvider?.models?.find(
      (m: any) => m.toLowerCase() === modelLower
    );
    if (finalProvider && finalModel) {
      return { model: `${finalProvider.name},${finalModel}`, scenarioType: 'default' };
    }
    return { model: req.body.model, scenarioType: 'default' };
  }

  // Step 4: Config-driven scenario routing (only activates if Router config exists)
  // Long context model
  const longContextThreshold = Router?.longContextThreshold || 60000;
  const lastUsageThreshold =
    lastUsage &&
    lastUsage.input_tokens > longContextThreshold &&
    tokenCount > 20000;
  const tokenCountThreshold = tokenCount > longContextThreshold;
  if ((lastUsageThreshold || tokenCountThreshold)) {
    const model = resolveScenarioModel(tierResolution, 'longContext', Router?.longContext);
    if (model) {
      req.log.info(
        `Long context routing: token count ${tokenCount} > threshold ${longContextThreshold}`
      );
      return { model, scenarioType: 'longContext' };
    }
  }

  // Subagent model extraction
  const subagentModel = extractSubagentModel(req);
  if (subagentModel) {
    return { model: subagentModel, scenarioType: 'default' };
  }

  // Background model (fast tier)
  const modelName = (req.body.model || '').toLowerCase();
  const isHaikuOrFastTier = tierResolution?.tier === 'fast' ||
    modelName.includes("haiku") ||
    modelName === 'fast';
  if (isHaikuOrFastTier) {
    const model = resolveScenarioModel(tierResolution, 'background', Router?.background);
    if (model) {
      req.log.info(`Background model for ${req.body.model}`);
      return { model, scenarioType: 'background' };
    }
  }

  // Web search model
  if (
    Array.isArray(req.body.tools) &&
    req.body.tools.some((tool: any) => tool.type?.startsWith("web_search"))
  ) {
    const model = resolveScenarioModel(tierResolution, 'webSearch', Router?.webSearch);
    if (model) {
      return { model, scenarioType: 'webSearch' };
    }
  }

  // Thinking model
  if (req.body.thinking) {
    const model = resolveScenarioModel(tierResolution, 'think', Router?.think);
    if (model) {
      req.log.info(`Think model for thinking request`);
      return { model, scenarioType: 'think' };
    }
  }

  // Default: tier-aware or Router.default
  const defaultModel = resolveScenarioModel(tierResolution, 'default', Router?.default);
  return { model: defaultModel, scenarioType: 'default' };
};

const extractSubagentModel = (req: any): string | undefined => {
  if (!Array.isArray(req.body?.system)) {
    return undefined;
  }

  for (let i = 0; i < req.body.system.length; i++) {
    const block = req.body.system[i];
    if (typeof block?.text !== "string") continue;

    const match = block.text.match(
      /<CCR-SUBAGENT-MODEL>(.*?)<\/CCR-SUBAGENT-MODEL>/s
    );
    if (match) {
      req.body.system[i].text = block.text.replace(
        `<CCR-SUBAGENT-MODEL>${match[1]}</CCR-SUBAGENT-MODEL>`,
        ""
      );
      return match[1];
    }
  }
  return undefined;
};

export interface RouterContext {
  configService: ConfigService;
  tokenizerService?: TokenizerService;
  event?: any;
}

export type RouterScenarioType =
  | 'default'
  | 'background'
  | 'think'
  | 'longContext'
  | 'webSearch'
  | 'health_fallback'
  | string;

export interface RouterFallbackConfig {
  default?: string[];
  background?: string[];
  think?: string[];
  longContext?: string[];
  webSearch?: string[];
}

export const router = async (req: any, _res: any, context: RouterContext) => {
  const { configService, event } = context;

  if (req.body.metadata?.user_id) {
    const parts = req.body.metadata.user_id.split("_session_");
    if (parts.length > 1) {
      req.sessionId = parts[1];
    }
  }
  const lastMessageUsage = sessionUsageCache.get(req.sessionId);
  const { messages, system = [], tools }: MessageCreateParamsBase = req.body;
  const rewritePrompt = configService.get("REWRITE_SYSTEM_PROMPT");
  if (
    rewritePrompt &&
    system.length > 1 &&
    system[1]?.text?.includes("<env>")
  ) {
    const prompt = await readFile(rewritePrompt, "utf-8");
    system[1].text = `${prompt}<env>${system[1].text.split("<env>").pop()}`;
  }

  try {
    // Token counting
    const [providerName, modelName] = (req.body.model || '').split(",");
    const tokenizerConfig = context.tokenizerService?.getTokenizerConfigForModel(
      providerName,
      modelName
    );

    let tokenCount: number;

    if (context.tokenizerService) {
      const result = await context.tokenizerService.countTokens(
        {
          messages: messages as MessageParam[],
          system,
          tools: tools as Tool[],
        },
        tokenizerConfig
      );
      tokenCount = result.tokenCount;
    } else {
      tokenCount = calculateTokenCount(
        messages as MessageParam[],
        system,
        tools as Tool[]
      );
    }

    // Custom router (external JS module, opt-in)
    let model = extractSubagentModel(req);
    const customRouterPath = configService.get("CUSTOM_ROUTER_PATH");
    if (!model && customRouterPath) {
      try {
        const resolved = require.resolve(customRouterPath);
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const realResolved = fs.realpathSync(resolved);
        const allowed = [process.cwd(), os.homedir(), path.join(os.homedir(), '.claude-code-router')];
        const isAllowed = allowed.some(dir => realResolved.startsWith(path.resolve(dir)));
        if (!isAllowed) {
          req.log.error(`Custom router path outside allowed directories: ${realResolved}`);
        } else {
          const customRouter = require(realResolved);
          req.tokenCount = tokenCount;
          model = await customRouter(req, configService.getAll(), {
            event,
          });
        }
      } catch (e: any) {
        req.log.error(`failed to load custom router: ${e.message}`);
      }
    }

    if (!model) {
      const result = await resolveModel(req, tokenCount, configService, lastMessageUsage);
      model = result.model;
      req.scenarioType = result.scenarioType;

      // Health-based fallback (config-driven, transparent resilience)
      try {
        const [targetProvider] = model.split(",");
        const healthMonitor = configService.get("_healthMonitor");
        if (healthMonitor && targetProvider) {
          const isHealthy = await healthMonitor.checkBeforeRoute(targetProvider);
          if (!isHealthy) {
            const fallbackConfig = configService.get<any>('fallback');
            const scenarioType = req.scenarioType || 'default';
            const fallbackList = fallbackConfig?.[scenarioType] || fallbackConfig?.default || [];
            const fallback = Array.isArray(fallbackList) ? fallbackList[0] : fallbackList;
            if (fallback) {
              req.log.warn(
                `Provider ${targetProvider} UNHEALTHY → falling back to ${fallback}`
              );
              model = fallback;
              req.scenarioType = 'health_fallback';
            } else {
              req.log.warn(
                `Provider ${targetProvider} UNHEALTHY, no fallback configured`
              );
            }
          }
        }
      } catch (e: any) {
        req.log.debug(`Health check skipped: ${e?.message}`);
      }
    } else {
      req.scenarioType = req.gatewayScenario || req.scenarioType || 'default';
    }
    req.body.model = model;
  } catch (error: any) {
    req.log.error(`Error in router middleware: ${error.message}`);
    const Router = configService.get("Router");
    req.body.model = Router?.default;
    req.scenarioType = 'default';
  }
  return;
};

const sessionProjectCache = new LRUCache<string, string>({
  max: 1000,
});

export const searchProjectBySession = async (
  sessionId: string
): Promise<string | null> => {
  if (sessionProjectCache.has(sessionId)) {
    const result = sessionProjectCache.get(sessionId);
    if (!result || result === '') {
      return null;
    }
    return result;
  }

  try {
    const dir = await opendir(CLAUDE_PROJECTS_DIR);
    const folderNames: string[] = [];

    for await (const dirent of dir) {
      if (dirent.isDirectory()) {
        folderNames.push(dirent.name);
      }
    }

    const checkPromises = folderNames.map(async (folderName) => {
      const sessionFilePath = join(
        CLAUDE_PROJECTS_DIR,
        folderName,
        `${sessionId}.jsonl`
      );
      try {
        const fileStat = await stat(sessionFilePath);
        return fileStat.isFile() ? folderName : null;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(checkPromises);

    for (const result of results) {
      if (result) {
        sessionProjectCache.set(sessionId, result);
        return result;
      }
    }

    sessionProjectCache.set(sessionId, '');
    return null;
  } catch {
    sessionProjectCache.set(sessionId, '');
    return null;
  }
};
