import Server, { calculateTokenCount, TokenizerService, SemanticStoreService, MODEL_LIMITS, DEFAULT_MODEL_LIMITS } from "@musistudio/llms";
import { readConfigFile, writeConfigFile, backupConfigFile } from "./utils";
import path, { join } from "path";
import fastifyStatic from "@fastify/static";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { homedir } from "os";
import {
  getPresetDir,
  readManifestFromDir,
  manifestToPresetFile,
  saveManifest,
  isPresetInstalled,
  extractPreset,
  HOME_DIR,
  extractMetadata,
  loadConfigFromManifest,
  downloadPresetToTemp,
  getTempDir,
  findMarketPresetByName,
  getMarketPresets,
  type PresetFile,
  type ManifestFile,
  type PresetMetadata,
} from "@CCR/shared";
import fastifyMultipart from "@fastify/multipart";
import AdmZip from "adm-zip";

const getServer = (app: any): any => {
  return (app as any)._server || null;
};

export const createServer = async (config: any): Promise<any> => {
  const server = new Server(config);
  const app = server.app;
  // Attach server to app early so API routes can access services
  (app as any)._server = server;

  app.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  app.post("/v1/messages/count_tokens", async (req: any, reply: any) => {
    const {messages, tools, system, model} = req.body;
    const srv = getServer(app);
    const tokenizerService = srv?.tokenizerService as TokenizerService | undefined;

    // If model is specified in "providerName,modelName" format, use the configured tokenizer
    if (model && model.includes(",") && tokenizerService) {
      try {
        const [provider, modelName] = model.split(",");
        req.log?.info(`Looking up tokenizer for provider: ${provider}, model: ${modelName}`);

        const tokenizerConfig = tokenizerService.getTokenizerConfigForModel(provider, modelName);

        if (!tokenizerConfig) {
          req.log?.warn(`No tokenizer config found for ${provider},${modelName}, using default tiktoken`);
        } else {
          req.log?.info(`Using tokenizer config: ${JSON.stringify(tokenizerConfig)}`);
        }

        const result = await tokenizerService.countTokens(
          { messages, system, tools },
          tokenizerConfig
        );

        return {
          "input_tokens": result.tokenCount,
          "tokenizer": result.tokenizerUsed,
        };
      } catch (error: any) {
        req.log?.error(`Error using configured tokenizer: ${error.message}`);
        req.log?.error(error.stack);
        // Fall back to default calculation
      }
    } else {
      if (!model) {
        req.log?.info(`No model specified, using default tiktoken`);
      } else if (!model.includes(",")) {
        req.log?.info(`Model "${model}" does not contain comma, using default tiktoken`);
      } else if (!tokenizerService) {
        req.log?.warn(`TokenizerService not available, using default tiktoken`);
      }
    }

    // Default to tiktoken calculation
    const tokenCount = calculateTokenCount(messages, system, tools);
    return { "input_tokens": tokenCount }
  });

  // Add endpoint to read config.json with access control
  app.get("/api/config", async (req: any, reply: any) => {
    return await readConfigFile();
  });

  app.get("/api/transformers", async (req: any, reply: any) => {
    const srv = getServer(app);
    const transformers =
      srv?.transformerService.getAllTransformers() || new Map();
    const transformerList = Array.from(transformers.entries()).map(
      ([name, transformer]: any) => ({
        name,
        endpoint: transformer.endPoint || null,
      })
    );
    return { transformers: transformerList };
  });

  // Add endpoint to save config.json with access control
  app.post("/api/config", async (req: any, reply: any) => {
    const newConfig = req.body;

    // Validate config before saving
    try {
      const { validateConfig } = require('@musistudio/llms');
      if (typeof validateConfig === 'function') {
        const issues = validateConfig(newConfig);
        const errors = issues.filter((i: any) => i.severity === 'error');
        if (errors.length > 0) {
          return reply.code(400).send({
            error: 'Config validation failed',
            issues: errors,
          });
        }
      }
    } catch {
      // Validation module not available, proceed
    }

    // Backup existing config file if it exists
    const backupPath = await backupConfigFile();
    if (backupPath) {
      console.log(`Backed up existing configuration file to ${backupPath}`);
    }

    await writeConfigFile(newConfig);
    return { success: true, message: "Config saved successfully" };
  });

  // Config validation endpoint
  app.post("/api/config/validate", async (req: any, reply: any) => {
    try {
      const { validateConfig } = require('@musistudio/llms');
      if (typeof validateConfig !== 'function') {
        return reply.code(501).send({ error: 'Validation module not available' });
      }
      const issues = validateConfig(req.body);
      return {
        valid: issues.filter((i: any) => i.severity === 'error').length === 0,
        issues,
      };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.register(fastifyStatic, {
    root: join(__dirname, "..", "dist"),
    prefix: "/ui/",
    maxAge: 0,
  });

  app.get("/ui", async (_: any, reply: any) => {
    return reply.redirect("/ui/");
  });

  app.setNotFoundHandler(async (req: any, reply: any) => {
    if (req.url?.startsWith("/ui/") && !req.url.includes(".")) {
      reply.header("Cache-Control", "no-cache, no-store, must-revalidate");
      return reply.type("text/html").sendFile("index.html");
    }
    reply.code(404).send({ error: "Not Found" });
  });

  // Get log file list endpoint
  app.get("/api/logs/files", async (req: any, reply: any) => {
    try {
      const logDir = join(homedir(), ".claude-code-router", "logs");
      const logFiles: Array<{ name: string; path: string; size: number; lastModified: string }> = [];

      if (existsSync(logDir)) {
        const files = readdirSync(logDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const filePath = join(logDir, file);
            const stats = statSync(filePath);

            logFiles.push({
              name: file,
              path: path.basename(filePath),
              size: stats.size,
              lastModified: stats.mtime.toISOString()
            });
          }
        }

        // Sort by modification time in descending order
        logFiles.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
      }

      return logFiles;
    } catch (error) {
      console.error("Failed to get log files:", error);
      reply.status(500).send({ error: "Failed to get log files" });
    }
  });

  // Get log content endpoint
  app.get("/api/logs", async (req: any, reply: any) => {
    try {
      const logDir = path.resolve(join(homedir(), ".claude-code-router", "logs"));
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        logFilePath = path.resolve(logDir, filePath);
        if (!logFilePath.startsWith(logDir)) {
          return reply.code(403).send({ error: 'Invalid file path' });
        }
      } else {
        logFilePath = join(logDir, "app.log");
      }

      if (!existsSync(logFilePath)) {
        return [];
      }

      const logContent = readFileSync(logFilePath, 'utf8');
      const logLines = logContent.split('\n').filter(line => line.trim())

      return logLines;
    } catch (error) {
      console.error("Failed to get logs:", error);
      reply.status(500).send({ error: "Failed to get logs" });
    }
  });

  // Clear log content endpoint
  app.delete("/api/logs", async (req: any, reply: any) => {
    try {
      const logDir = path.resolve(join(homedir(), ".claude-code-router", "logs"));
      const filePath = (req.query as any).file as string;
      let logFilePath: string;

      if (filePath) {
        logFilePath = path.resolve(logDir, filePath);
        if (!logFilePath.startsWith(logDir)) {
          return reply.code(403).send({ error: 'Invalid file path' });
        }
      } else {
        logFilePath = join(logDir, "app.log");
      }

      if (existsSync(logFilePath)) {
        writeFileSync(logFilePath, '', 'utf8');
      }

      return { success: true, message: "Logs cleared successfully" };
    } catch (error) {
      console.error("Failed to clear logs:", error);
      reply.status(500).send({ error: "Failed to clear logs" });
    }
  });

  // Get presets list
  app.get("/api/presets", async (req: any, reply: any) => {
    try {
      const presetsDir = join(HOME_DIR, "presets");

      if (!existsSync(presetsDir)) {
        return { presets: [] };
      }

      const entries = readdirSync(presetsDir, { withFileTypes: true });
      const presetDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

      const presets: Array<PresetMetadata & { installed: boolean; id: string }> = [];

      for (const dirName of presetDirs) {
        const presetDir = join(presetsDir, dirName);
        try {
          const manifestPath = join(presetDir, "manifest.json");
          const content = readFileSync(manifestPath, 'utf-8');
          const manifest = JSON.parse(content);

          // Extract metadata fields
          const { Providers, Router, PORT, HOST, API_TIMEOUT_MS, PROXY_URL, LOG, LOG_LEVEL, StatusLine, NON_INTERACTIVE_MODE, ...metadata } = manifest;

          presets.push({
            id: dirName,  // Use directory name as unique identifier
            name: metadata.name || dirName,
            version: metadata.version || '1.0.0',
            description: metadata.description,
            author: metadata.author,
            homepage: metadata.homepage,
            repository: metadata.repository,
            license: metadata.license,
            keywords: metadata.keywords,
            ccrVersion: metadata.ccrVersion,
            source: metadata.source,
            sourceType: metadata.sourceType,
            checksum: metadata.checksum,
            installed: true,
          });
        } catch (error) {
          console.error(`Failed to read preset ${dirName}:`, error);
        }
      }

      return { presets };
    } catch (error) {
      console.error("Failed to get presets:", error);
      reply.status(500).send({ error: "Failed to get presets" });
    }
  });

  // Get preset details
  app.get("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      const manifest = await readManifestFromDir(presetDir);
      const presetFile = manifestToPresetFile(manifest);

      // Return preset info, config uses the applied userValues configuration
      return {
        ...presetFile,
        config: loadConfigFromManifest(manifest, presetDir),
        userValues: manifest.userValues || {},
      };
    } catch (error: any) {
      console.error("Failed to get preset:", error);
      reply.status(500).send({ error: error.message || "Failed to get preset" });
    }
  });

  // Apply preset (configure sensitive information)
  app.post("/api/presets/:name/apply", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const { secrets } = req.body;

      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Read existing manifest
      const manifest = await readManifestFromDir(presetDir);

      // Save user input to userValues (keep original config unchanged)
      const updatedManifest: ManifestFile = { ...manifest };

      // Save or update userValues
      if (secrets && Object.keys(secrets).length > 0) {
        updatedManifest.userValues = {
          ...updatedManifest.userValues,
          ...secrets,
        };
      }

      // Save updated manifest
      await saveManifest(name, updatedManifest);

      return { success: true, message: "Preset applied successfully" };
    } catch (error: any) {
      console.error("Failed to apply preset:", error);
      reply.status(500).send({ error: error.message || "Failed to apply preset" });
    }
  });

  // Delete preset
  app.delete("/api/presets/:name", async (req: any, reply: any) => {
    try {
      const { name } = req.params;
      const presetDir = getPresetDir(name);

      if (!existsSync(presetDir)) {
        reply.status(404).send({ error: "Preset not found" });
        return;
      }

      // Recursively delete entire directory
      rmSync(presetDir, { recursive: true, force: true });

      return { success: true, message: "Preset deleted successfully" };
    } catch (error: any) {
      console.error("Failed to delete preset:", error);
      reply.status(500).send({ error: error.message || "Failed to delete preset" });
    }
  });

  // Get preset market list
  app.get("/api/presets/market", async (req: any, reply: any) => {
    try {
      // Use market presets function
      const marketPresets = await getMarketPresets();
      return { presets: marketPresets };
    } catch (error: any) {
      console.error("Failed to get market presets:", error);
      reply.status(500).send({ error: error.message || "Failed to get market presets" });
    }
  });

  // Install preset from GitHub repository by preset name
  app.post("/api/presets/install/github", async (req: any, reply: any) => {
    try {
      const { presetName } = req.body;

      if (!presetName) {
        reply.status(400).send({ error: "Preset name is required" });
        return;
      }

      // Check if preset is in the marketplace
      const marketPreset = await findMarketPresetByName(presetName);
      if (!marketPreset) {
        reply.status(400).send({
          error: "Preset not found in marketplace",
          message: `Preset '${presetName}' is not available in the official marketplace. Please check the available presets.`
        });
        return;
      }

      // Get repository from market preset
      if (!marketPreset.repo) {
        reply.status(400).send({
          error: "Invalid preset data",
          message: `Preset '${presetName}' does not have repository information`
        });
        return;
      }

      // Parse GitHub repository URL
      const githubRepoMatch = marketPreset.repo.match(/(?:github\.com[:/]|^)([^/]+)\/([^/\s#]+?)(?:\.git)?$/);
      if (!githubRepoMatch) {
        reply.status(400).send({ error: "Invalid GitHub repository URL" });
        return;
      }

      const [, owner, repoName] = githubRepoMatch;

      // Use preset name from market
      const installedPresetName = marketPreset.name || presetName;

      // Check if already installed BEFORE downloading
      if (await isPresetInstalled(installedPresetName)) {
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' is already installed. To update or reconfigure, please delete it first using the delete button.`,
          presetName: installedPresetName
        });
        return;
      }

      // Download GitHub repository ZIP file
      const downloadUrl = `https://github.com/${owner}/${repoName}/archive/refs/heads/main.zip`;
      const tempFile = await downloadPresetToTemp(downloadUrl);

      // Load preset to validate structure
      const preset = await loadPresetFromZip(tempFile);

      // Double-check if already installed (in case of race condition)
      if (await isPresetInstalled(installedPresetName)) {
        unlinkSync(tempFile);
        reply.status(409).send({
          error: "Preset already installed",
          message: `Preset '${installedPresetName}' was installed while downloading. Please try again.`,
          presetName: installedPresetName
        });
        return;
      }

      // Extract to target directory
      const targetDir = getPresetDir(installedPresetName);
      await extractPreset(tempFile, targetDir);

      // Read manifest and add repo information
      const manifest = await readManifestFromDir(targetDir);

      // Add repo information to manifest from market data
      manifest.repository = marketPreset.repo;
      if (marketPreset.url) {
        manifest.source = marketPreset.url;
      }

      // Save updated manifest
      await saveManifest(installedPresetName, manifest);

      // Clean up temp file
      unlinkSync(tempFile);

      return {
        success: true,
        presetName: installedPresetName,
        preset: {
          ...preset.metadata,
          installed: true,
        }
      };
    } catch (error: any) {
      console.error("Failed to install preset from GitHub:", error);
      reply.status(500).send({ error: error.message || "Failed to install preset from GitHub" });
    }
  });

  // Helper function: Load preset from ZIP
  async function loadPresetFromZip(zipFile: string): Promise<PresetFile> {
    const zip = new AdmZip(zipFile);

    // First try to find manifest.json in root directory
    let entry = zip.getEntry('manifest.json');

    // If not in root, try to find in subdirectories (handle GitHub repo archive structure)
    if (!entry) {
      const entries = zip.getEntries();
      // Find any manifest.json file
      entry = entries.find(e => e.entryName.includes('manifest.json')) || null;
    }

    if (!entry) {
      throw new Error('Invalid preset file: manifest.json not found');
    }

    const manifest = JSON.parse(entry.getData().toString('utf-8')) as ManifestFile;
    return manifestToPresetFile(manifest);
  }

  // --- Semantic Store API ---
  // Lightweight vector storage backed by Postgres+pgvector.
  // Graceful degradation: if Postgres is unavailable, returns empty results.
  const srv = getServer(app);
  const semanticStore = new SemanticStoreService(
    srv?.configService || {},
    app.log
  );

  // Semantic store health check
  app.get("/api/semantic/status", async (req: any, reply: any) => {
    try {
      const health = await semanticStore.healthCheck();
      return health;
    } catch (error: any) {
      return { connected: false, error: error.message };
    }
  });

  // Upsert document into semantic store
  app.post("/api/semantic/upsert", async (req: any, reply: any) => {
    try {
      const { scope, topic, content, depth, trust, source, metadata } = req.body;
      if (!scope || !topic || !content) {
        reply.status(400).send({ error: "scope, topic, and content are required" });
        return;
      }
      const validScopes = ['session', 'project', 'reference'];
      if (!validScopes.includes(scope)) {
        reply.status(400).send({ error: `scope must be one of: ${validScopes.join(', ')}` });
        return;
      }
      const result = await semanticStore.upsert({
        scope,
        topic,
        content,
        depth,
        trust,
        source,
        metadata,
      });
      if (!result) {
        reply.status(503).send({ error: "Semantic store unavailable" });
        return;
      }
      return { success: true, id: result.id };
    } catch (error: any) {
      reply.status(500).send({ error: error.message || "Failed to upsert document" });
    }
  });

  // Search semantic store
  app.post("/api/semantic/search", async (req: any, reply: any) => {
    try {
      const { query, scope, topic, limit, threshold } = req.body;
      if (!query) {
        reply.status(400).send({ error: "query is required" });
        return;
      }
      const results = await semanticStore.search(query, {
        scope,
        topic,
        limit,
        threshold,
      });
      return { results };
    } catch (error: any) {
      reply.status(500).send({ error: error.message || "Failed to search" });
    }
  });

  // Delete documents by scope and topic
  app.delete("/api/semantic/:scope/:topic", async (req: any, reply: any) => {
    try {
      const { scope, topic } = req.params;
      const deleted = await semanticStore.delete(scope, topic);
      return { success: true, deleted };
    } catch (error: any) {
      reply.status(500).send({ error: error.message || "Failed to delete" });
    }
  });

  // --- Gateway Health API ---
  app.get("/api/health", async (req: any, reply: any) => {
    const srv = getServer(app);
    const providers = srv?.providerService.getProviders() || [];
    const semanticHealth = await semanticStore.healthCheck();
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: providers.map((p: any) => ({
        name: p.name,
        models: p.models,
      })),
      semanticStore: semanticHealth,
    };
  });

  // --- Anthropic-compatible /v1/models endpoint ---
  // Claude Code v2.x calls this to validate available models.
  // Without this, Claude Code shows "model may not exist" errors.
  app.get("/v1/models", async (req: any, reply: any) => {
    const srv = getServer(app);
    const providerService = srv?.providerService;
    const configService = srv?.configService;
    
    let modelIds: string[] = [];
    
    // Get models from providers
    if (providerService) {
      try {
        const providers = providerService.getProviders();
        for (const p of providers) {
          if (p.models && Array.isArray(p.models)) {
            modelIds.push(...p.models);
          }
        }
      } catch {}
    }
    
    // Also include ModelMapping keys (the Claude model names we accept)
    if (configService) {
      try {
        const mapping = configService.get("ModelMapping");
        if (mapping && typeof mapping === 'object') {
          for (const key of Object.keys(mapping)) {
            if (!modelIds.includes(key)) {
              modelIds.push(key);
            }
          }
        }
      } catch {}
    }
    
    // Deduplicate
    modelIds = [...new Set(modelIds)];

    const sorted = modelIds.sort();
    return {
      object: "list",
      data: sorted.map((id) => ({
        id,
        object: "model",
        type: "model",
        display_name: id,
        created_at: "2025-01-01T00:00:00Z",
      })),
      has_more: false,
      first_id: sorted[0] || null,
      last_id: sorted[sorted.length - 1] || null,
    };
  });

  // Diagnostic: test AnthropicTransformer conversion
  app.post("/api/debug/convert", async (req: any, reply: any) => {
    try {
      const srv = getServer(app);
      const config = srv?.configService;
      if (!config?.get('debug')?.enabled) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const { provider: pName } = req.body;
      const prov = srv?.providerService.getProvider(pName);
      if (!prov) return reply.code(404).send({ error: "Provider not found" });
      const url = new URL(prov.baseUrl);
      const rawBody = {
        model: "deepseek-chat",
        messages: [{ role: "user", content: "Say hi in one word" }],
        max_tokens: 10,
        stream: false,
      };
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(rawBody),
      });
      const rawJson = await res.json();
      
      // Now test the Anthropic conversion
      const anthropicTransformer = srv?.transformerService.getTransformer("Anthropic");
      if (!anthropicTransformer) {
        return reply.code(500).send({ error: "AnthropicTransformer not initialized" });
      }
      const converted = anthropicTransformer.convertOpenAIResponseToAnthropic(rawJson, { req: { id: "test" } });
      
      return {
        raw: { model: rawJson.model, content: rawJson.choices?.[0]?.message?.content },
        converted: { 
          model: converted.model, 
          contentTypes: converted.content?.map((c:any) => c.type),
          contentTexts: converted.content?.map((c:any) => c.text?.substring(0,50)),
          contentLength: converted.content?.length
        },
      };
    } catch (e: any) {
      return { error: e.message, stack: e.stack?.split('\n').slice(0,3) };
    }
  });

  // --- Provider Model Discovery ---
  app.get("/api/providers/:providerName/discover-models", async (req: any, reply: any) => {
    try {
      const { providerName } = req.params;
      const config = await readConfigFile();
      const providers = config.Providers || config.providers || [];
      const provider = providers.find((p: any) => p.name === providerName);
      if (!provider) {
        return reply.code(404).send({ error: `Provider "${providerName}" not found` });
      }

      let modelsUrl: string;
      let authHeader: string;
      const baseUrl = provider.api_base_url || provider.apiKey || '';

      if (providerName === 'glm') {
        modelsUrl = 'https://open.bigmodel.cn/api/paas/v4/models';
        authHeader = `Bearer ${provider.api_key || provider.apiKey}`;
      } else if (providerName === 'deepseek') {
        modelsUrl = 'https://api.deepseek.com/models';
        authHeader = `Bearer ${provider.api_key || provider.apiKey}`;
      } else if (baseUrl.includes('localhost:11434') || baseUrl.includes('127.0.0.1:11434')) {
        modelsUrl = 'http://localhost:11434/v1/models';
        authHeader = '';
      } else {
        const url = new URL(baseUrl);
        modelsUrl = `${url.protocol}//${url.host}/v1/models`;
        authHeader = `Bearer ${provider.api_key || provider.apiKey}`;
      }

      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (authHeader) headers['Authorization'] = authHeader;

      const resp = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        return reply.code(502).send({ error: `Upstream returned ${resp.status}`, modelsUrl });
      }
      const data = await resp.json() as any;
      const rawModels: Array<{ id: string; object?: string; owned_by?: string; created?: number }> = data.data || data.models || [];

      const discovered = rawModels.map((m: any) => {
        const limits = (MODEL_LIMITS as Record<string, any>)[m.id] || DEFAULT_MODEL_LIMITS;
        return {
          id: m.id,
          owned_by: m.owned_by || providerName,
          contextWindow: limits.contextWindow,
          maxOutputTokens: limits.maxOutputTokens,
          supportsThinking: limits.supportsThinking || false,
          thinkingBudgetTokens: limits.thinkingBudgetTokens || 0,
        };
      });

      const configured = (provider.models || []).map((id: string) => {
        const limits = (MODEL_LIMITS as Record<string, any>)[id] || DEFAULT_MODEL_LIMITS;
        return {
          id,
          owned_by: providerName,
          contextWindow: limits.contextWindow,
          maxOutputTokens: limits.maxOutputTokens,
          supportsThinking: limits.supportsThinking || false,
          thinkingBudgetTokens: limits.thinkingBudgetTokens || 0,
          configured: true,
        };
      });

      const configuredIds = new Set(configured.map((m: any) => m.id));
      const newModels = discovered.filter((m: any) => !configuredIds.has(m.id));

      return { provider: providerName, configured, discovered: newModels, total: configured.length + newModels.length };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.post("/api/providers/:providerName/models", async (req: any, reply: any) => {
    try {
      const { providerName } = req.params;
      const { models } = req.body;
      if (!Array.isArray(models)) {
        return reply.code(400).send({ error: 'models must be an array of strings' });
      }
      const config = await readConfigFile();
      const providers = config.Providers || config.providers || [];
      const idx = providers.findIndex((p: any) => p.name === providerName);
      if (idx === -1) {
        return reply.code(404).send({ error: `Provider "${providerName}" not found` });
      }
      providers[idx].models = models;
      await writeConfigFile(config);
      return { success: true, provider: providerName, models };
    } catch (e: any) {
      return reply.code(500).send({ error: e.message });
    }
  });

  app.get("/api/model-limits", async (req: any, reply: any) => {
    try {
      const config = await readConfigFile();
      const providers = config.Providers || config.providers || [];
      const allModels: Record<string, any> = {};

      for (const [id, limits] of Object.entries(MODEL_LIMITS as Record<string, any>)) {
        allModels[id] = { ...limits, provider: 'unknown' };
      }

      for (const p of providers) {
        for (const m of (p.models || [])) {
          if (!allModels[m]) {
            allModels[m] = { ...DEFAULT_MODEL_LIMITS, provider: p.name };
          }
          allModels[m].provider = p.name;
        }
      }

      return { models: allModels, defaultContextWindow: DEFAULT_MODEL_LIMITS.contextWindow };
    } catch (e: any) {
      return { models: {}, error: e.message };
    }
  });

  // --- Context Service API (for OpenCode plugins/MCP) ---
  app.post("/api/context/store", async (req: any, reply: any) => {
    try {
      const { scope, topic, content, metadata } = req.body;
      if (!scope || !topic || !content) {
        return reply.status(400).send({ error: "scope, topic, and content are required" });
      }
      const result = await semanticStore.upsert({
        scope: scope || "session",
        topic,
        content,
        metadata,
        depth: req.body.depth,
        trust: req.body.trust,
        source: req.body.source || "opencode",
      });
      if (!result) {
        return reply.status(503).send({ error: "Semantic store unavailable" });
      }
      return { success: true, id: result.id };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || "Failed to store context" });
    }
  });

  app.post("/api/context/query", async (req: any, reply: any) => {
    try {
      const { query, scope, topic, limit, threshold } = req.body;
      if (!query) {
        return reply.status(400).send({ error: "query is required" });
      }
      const results = await semanticStore.search(query, {
        scope,
        topic,
        limit: limit || 5,
        threshold: threshold || 0.5,
      });
      return { results };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message || "Failed to query context" });
    }
  });

  app.get("/api/context/stats", async (req: any, reply: any) => {
    try {
      const health = await semanticStore.healthCheck();
      return {
        semanticStore: health,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      return { semanticStore: { connected: false, error: error.message } };
    }
  });

  app.post("/api/context/collect", async (req: any, reply: any) => {
    try {
      return { success: true, message: "Context collection is automatic via proxy pipeline" };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message });
    }
  });

  // --- MCP-compatible endpoint for OpenCode ---
  app.post("/api/mcp", async (req: any, reply: any) => {
    try {
      const { jsonrpc, method, params, id } = req.body || {};

      if (jsonrpc !== "2.0") {
        return { jsonrpc: "2.0", error: { code: -32600, message: "Invalid Request" }, id: id || null };
      }

      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "ccr-context-service", version: "2.0.0" },
          },
          id,
        };
      }

      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          result: {
            tools: [
              {
                name: "semantic_search",
                description: "Search the CCR semantic store for relevant context about the project",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: { type: "string", description: "Search query" },
                    scope: { type: "string", enum: ["session", "project", "reference"], description: "Search scope" },
                    limit: { type: "number", description: "Max results (default 5)" },
                  },
                  required: ["query"],
                },
              },
              {
                name: "semantic_store",
                description: "Store context information in the CCR semantic store for future retrieval",
                inputSchema: {
                  type: "object",
                  properties: {
                    scope: { type: "string", enum: ["session", "project", "reference"] },
                    topic: { type: "string", description: "Topic/category" },
                    content: { type: "string", description: "Content to store" },
                  },
                  required: ["scope", "topic", "content"],
                },
              },
              {
                name: "health_check",
                description: "Check CCR proxy health status",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
          id,
        };
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (toolName === "semantic_search") {
          const results = await semanticStore.search(args.query || "", {
            scope: args.scope,
            limit: args.limit || 5,
          });
          return {
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
            },
            id,
          };
        }

        if (toolName === "semantic_store") {
          const result = await semanticStore.upsert({
            scope: args.scope || "session",
            topic: args.topic || "general",
            content: args.content || "",
            source: "opencode-mcp",
          });
          return {
            jsonrpc: "2.0",
            result: {
              content: [{ type: "text", text: result ? `Stored: ${result.id}` : "Store unavailable" }],
            },
            id,
          };
        }

        if (toolName === "health_check") {
          const health = await semanticStore.healthCheck();
          const srv = getServer(app);
          const providers = srv?.providerService.getProviders() || [];
          return {
            jsonrpc: "2.0",
            result: {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "ok",
                  providers: providers.map((p: any) => p.name),
                  semanticStore: health,
                }),
              }],
            },
            id,
          };
        }

        return {
          jsonrpc: "2.0",
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
          id,
        };
      }

      return {
        jsonrpc: "2.0",
        error: { code: -32601, message: `Unknown method: ${method}` },
        id: id || null,
      };
    } catch (error: any) {
      return {
        jsonrpc: "2.0",
        error: { code: -32603, message: error.message },
        id: (req.body || {}).id || null,
      };
    }
  });

  return server;
};
