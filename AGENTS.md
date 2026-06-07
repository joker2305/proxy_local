# AGENTS.md

## Quick Reference

- **Build (all)**: `pnpm build` — builds in order: shared → core → server → cli → ui
- **Build (single)**: `pnpm build:<pkg>` e.g. `pnpm build:core`
- **Dev**: `pnpm dev:server` | `pnpm dev:cli` | `pnpm dev:core` | `pnpm dev:ui`
- **Test**: `pnpm test` (vitest) | `pnpm test:watch` (watch mode)
- **Lint**: `pnpm --filter @musistudio/llms lint` (only core has a lint script)
- **Typecheck**: No dedicated typecheck script — `tsc -b` runs inside `ui` build only

## Monorepo Structure

```
packages/shared  → @CCR/shared       (constants, types, preset utilities)
packages/core    → @musistudio/llms   (Fastify server, routing, transformers, providers)
packages/server  → @CCR/server        (auth, config/preset/log API, UI static serving)
packages/cli     → @CCR/cli           (ccr binary: start/stop/restart, model selector)
packages/ui      → @CCR/ui            (React + Vite + Tailwind dashboard, also has Tauri)
docs/            → Docusaurus site
```

**Dependency chain**: `cli → server → core → shared`. Always build `shared` before `core`, `core` before `server`.

## Key Facts

- `packages/core` is published to npm as **`@musistudio/llms`** — not `@CCR/core`.
- The core package uses `@/` path alias (→ `packages/core/src/`). Configured in `tsconfig.json` paths and esbuild scripts in `packages/core/scripts/`.
- `packages/ui` is ESM (`"type": "module"`); all other packages are CommonJS.
- **HTTP framework is Fastify** — not Express or Hono.
- Build uses **esbuild** (scripts in `scripts/` and `packages/core/scripts/`), except `ui` which uses Vite+TCL.
- Config lives at `~/.claude-code-router/config.json` (JSON5), not in the repo.
- Code comments must be in English.

## Architecture Entry Points

| Concern | File |
|---------|------|
| Core server setup | `packages/core/src/server.ts` |
| Request routing | `packages/core/src/utils/router.ts` |
| HTTP route handler | `packages/core/src/api/routes.ts` (~2320 lines) |
| Transformer registry | `packages/core/src/transformer/index.ts` |
| Server app layer | `packages/server/src/server.ts` |
| CLI entry | `packages/cli/src/cli.ts` |

## Testing

Tests use **vitest**. Config: `vitest.workspace.ts` at root.
- Core tests: `packages/core/src/**/*.test.ts`
- Server tests: `packages/server/src/**/*.test.ts`
- Run specific test: `npx vitest run packages/core/src/__tests__/phase3-routing.test.ts`

## Optional Services (docker-compose.yml)

Redis (port 16379), Qdrant (port 16333), Postgres+pgvector (port 55432). All optional — the gateway degrades gracefully without them.

## CI

- **Docker publish** (`.github/workflows/docker-publish.yml`): triggered on `v*.*.*` tags. Builds all packages then pushes `musistudio/claude-code-router` image.
- **Docs deploy** (`.github/workflows/docs.yml`): deploys Docusaurus to GitHub Pages on push to `main` touching `docs/`.

## Model Format Convention

Models are specified as `"providerName,modelName"` (comma-separated). The router preHandler splits this into `req.provider` and `req.model` before the route handler runs.

## Release

`pnpm release` builds all packages then runs `scripts/release.sh all`. Sub-commands: `release:npm`, `release:docker`.

## Protocol & Compatibility Context

### Anthropic Messages API Compatibility

The proxy exposes `POST /v1/messages` as its primary endpoint. It converts between Anthropic and provider-native formats via a 2-layer transformer pipeline:
1. **Outer layer** (`AnthropicTransformer`): Anthropic ↔ Unified OpenAI-compatible format
2. **Inner layer** (provider transformers like `GeminiTransformer`, `DeepseekTransformer`): Unified ↔ Provider-native

### Known Protocol Gaps (vs Anthropic spec and claw-code reference)

1. ~~**Error format**: Returns `{error: {message, type, code}}` instead of Anthropic's `{type: "error", error: {type, message}}`~~ — **Fixed** in Round 8 (middleware.ts)
2. ~~**No `/v1/models` endpoint**: Model listing not exposed~~ — **Fixed** in server.ts
3. ~~**No `/v1/messages/count_tokens`**: Token counting endpoint missing~~ — **Fixed** in server.ts
4. **Usage in `message_start`**: Always reports `input_tokens: 0` — real Anthropic includes input tokens here
5. **Synthetic thinking signatures**: Non-Anthropic providers get fake signatures (timestamps), not cryptographic ones
6. ~~**No request validation**: Missing schema checks on required fields (`max_tokens`, `messages`, `model`)~~ — **Fixed** in Round 8 (server.ts preHandler)
7. **`anthropic-version`/`anthropic-beta` headers**: Stripped for non-Anthropic but not validated on incoming requests
8. ~~**Orphaned tool messages**: No sanitization of tool messages without matching assistant tool_calls (claw-code does this)~~ — **Fixed** in Round 8 (server.ts `sanitizeOrphanedToolMessages`)
9. **Schema normalization**: Tool input schemas not normalized with `properties: {}` + `additionalProperties: false` for OpenAI strict mode

### OpenCode Integration

OpenCode connects via custom provider with `@ai-sdk/openai-compatible`:
```json
{
  "provider": {
    "ccr": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:4096/v1" },
      "models": {
        "deepseek,deepseek-chat": { "name": "DeepSeek Chat (via CCR)" },
        "gemini,gemini-2.5-pro": { "name": "Gemini 2.5 Pro (via CCR)" }
      }
    }
  }
}
```
Model IDs: `"ccr/deepseek,deepseek-chat"`. OpenCode expects OpenAI-compatible `/v1/chat/completions` — proxy registers this via `openai.transformer.ts`.

**Transformer compatibility**: The `/v1/chat/completions` path works natively with OpenAI-compatible providers (DeepSeek, Groq, OpenAI). Non-OpenAI providers (Gemini, GLM) are supported via their inner-layer transformers configured in CCR's `config.json`.

CCR also exposes an MCP endpoint at `/api/mcp` for semantic search/store, and REST APIs at `/api/context/*` for OpenCode plugins.

### Architecture Philosophy: CCR Serves OpenCode

CCR is a **proxy and context service** for OpenCode, not a replacement for OpenCode's own routing/provider system:
- **CCR core**: Transparent proxy (format transformation, caching, concurrency, circuit breaker)
- **Context service**: Semantic store, context collection — exposed via REST API and MCP
- **Routing**: OpenCode's own provider/model system handles this; CCR's router runs only when model format is `"providerName,modelName"`
- **RAG/Memory injection**: Disabled by default in proxy; available via MCP tools for OpenCode to call explicitly
- **OpenCode plugins** (`.opencode/plugins/`): Build dependency injection, compaction context, CCR semantic store queries
- **OpenCode MCP** (`/api/mcp`): `semantic_search`, `semantic_store`, `health_check` tools

### Claw-Code Reference Intelligence

Claw Code (`D:\project\claw-code-main`) is a Rust reimplementation of Claude Code with valuable reference data:
- 1,902 original TS files, 207 commands, 184 tools across 30 subsystems
- Multi-provider: Anthropic + OpenAI + xAI + DashScope via `openai_compat.rs`
- Key patterns: dual auth (x-api-key + Bearer simultaneously), model-specific body stripping, reasoning model param removal, GPT-5 `max_completion_tokens`, DeepSeek V4 `reasoning_content` in history, kimi `is_error` field stripping, preflight body size checks (6MB-100MB per provider)

### Reference Projects for Upgrades

| Project | Key Takeaway |
|---------|-------------|
| LiteLLM (20k+ stars) | Streaming chunk reassembly for accurate usage; thinking block reconstruction with signatures |
| Portkey Gateway (12k+ stars) | Configurable fallback/loadbalance routing; per-target retry/timeout; `x-api-key` header forwarding |
| OneAPI (22k+ stars) | Channel health monitoring with auto-disable; per-model billing ratios; model name rewriting |

## OpenCode Toolchain (`.opencode/`)

### Skills (loaded on-demand via `skill` tool)

| Skill | Purpose |
|-------|---------|
| `protocol-analysis` | Anthropic API protocol details, SSE event types, known compatibility gaps |
| `transformer-dev` | Transformer interface, pipeline order, passthrough mode, all existing transformers |
| `proxy-debug` | Request flow trace map, common failure patterns, debugging approaches |
| `claw-code-compare` | Claw-code file map, priority comparison points, original Claude Code intelligence |
| `agent-ecosystem` | AI coding agent architecture patterns (Aider/Crush/Cline/Cursor) for proxy design |

### Custom Agents (invoked via `@agent-name` or Task tool)

| Agent | Mode | Purpose |
|-------|------|---------|
| `protocol-compare` | subagent (read-only) | Gap analysis between claw-code and CCR for a specific feature |
| `os-research` | subagent (read-only) | Research open-source LLM gateways for improvement patterns |
| `pipeline-tracer` | subagent (read-only) | Trace full transformer pipeline for a specific provider/scenario |
| `provider-compat` | subagent (read-only) | Analyze client tool (Aider/Crush/Cline/OpenCode) compatibility with CCR |

### Custom Commands

| Command | Purpose |
|---------|---------|
| `/test` | Run vitest tests (all or specific file) |
| `/build` | Build packages (respects ordering) |
| `/dev` | Start dev server with hot reload |
| `/analyze-gap <topic>` | Analyze a specific protocol gap against claw-code reference |

### Custom Plugins (`.opencode/plugins/`)

| Plugin | Purpose |
|--------|---------|
| `ccr-plugin.js` | Build dependency auto-injection + compaction context preservation |
| `ccr-context-plugin.js` | CCR health check on init, semantic context during compaction, session idle event |
| `ccr-routing-plugin.js` | Discovers providers/models from CCR, injects model info during compaction |

### Custom Tools (`.opencode/tools/`)

| Tool | Purpose |
|------|---------|
| `ccr_search.js` | Search CCR semantic store for project context |
| `ccr_store.js` | Store context in CCR semantic store for future retrieval |

### Configuration

- **`opencode.example.jsonc`** — Template for project-level OpenCode config (copy to `opencode.jsonc`, fill in models/provider keys)
- **`opencode.json`/`opencode.jsonc`** are gitignored (contain API keys)
- **`examples/opencode-provider-config.json`** — Minimal provider-only config example

### Round 1 Context (commit 2e1712b)

Created full OpenCode toolchain based on:
- Deep analysis of claw-code Rust implementation (anthropic.rs, openai_compat.rs, sse.rs, mod.rs)
- OpenCode official docs (skills, agents, commands, plugins formats)
- Comparison of CCR's transformer pipeline against Anthropic spec and claw-code patterns
- Research of LiteLLM, Portkey, OneAPI for architectural reference

### Round 2 Context (commit fdf5fdd)

Expanded analysis to broader AI agent ecosystem:
- **Aider**: Architect/Editor multi-model pattern, per-model edit format YAML (6 formats), litellm universal provider layer, repo map (tree-sitter graph ranking), infinite output via prefill, cache keepalive pings
- **Crush (Charmbracelet)**: Go-based, dual protocol (`openai`/`openai-compat`/`anthropic` types), SQLite session persistence, agent skills standard (agentskills.io), local installation at `.crush/` with zai provider
- **Cline**: TypeScript SDK, `@cline/llms` handler factory + registry pattern, tool approval policies, plugin system with lifecycle hooks
- **Cursor**: Closed-source but model switching per task, worktrees for parallel agents, rules system
- Key cross-cutting patterns: `provider/model` model ID convention (all tools), prompt-based editing vs function calling (Aider avoids function calling), per-model streaming/capability flags

### Round 3 Context (commit b99ee18)

Completed operational tooling:
- **ccr-plugin.js**: Build dependency auto-injection + compaction context preservation
- **ccr-context-plugin.js**: CCR health check on init, semantic context during compaction, session idle event
- **ccr-routing-plugin.js**: Discovers providers/models from CCR, injects model info during compaction
- **ccr_search.js / ccr_store.js**: Standalone custom tools for CCR semantic store access
- **opencode.example.jsonc**: Full project config template with build/plan agents, CCR provider + MCP config

### Round 4 Context — Architecture Evolution: CCR Serves OpenCode

**Problem identified**: CCR was originally designed for Claude Code (black box). For OpenCode, CCR's transparent RAG/Memory/Session injection was overriding OpenCode's own provider/routing capabilities, making CCR "too smart" and removing user control.

**Solution**: Separated CCR into two clean layers:
1. **Transparent proxy core** (always on): Transformer pipeline, semantic cache, concurrency, circuit breaker, rate limiting, tool compression, prompt caching
2. **Opt-in context services** (disabled by default, enabled via config): RAG enricher, memory bridge, context capture, reasoning cache, session bridge, evolution bridge

**Config keys changed (from default-on to default-off)**:
- `RAG_ENRICHER_ENABLED`: `!== false` → `=== true`
- `MEMORY_BRIDGE_ENABLED`: `!== false` → `=== true`
- `MEMORY_EXTRACTION_ENABLED`: `!== false` → `=== true`
- `CONTEXT_CAPTURE_ENABLED`: `!== false` → `=== true`

**To re-enable**, add to `~/.claude-code-router/config.json`:
```json
{ "RAG_ENRICHER_ENABLED": true, "MEMORY_BRIDGE_ENABLED": true, "CONTEXT_CAPTURE_ENABLED": true, "REASONING_CACHE_ENABLED": true }
```

**OpenCode integration points**:
- **Provider**: `@ai-sdk/openai-compatible` with `baseURL: "http://localhost:4096/v1"` — model format `"providerName,modelName"`
- **MCP**: `"type": "remote", "url": "http://localhost:4096/api/mcp"` — tools: `semantic_search`, `semantic_store`, `health_check`
- **REST API**: `/api/context/*` endpoints for direct programmatic access

### Round 8 Context — Protocol Gap Fixes

Fixed 3 protocol gaps:
- **Error format** (gap #1): `errorHandler` in `middleware.ts` now returns `{type: "error", error: {type, message}}` for Anthropic endpoints (`/v1/messages`), with proper error type mapping (400→invalid_request_error, 401→authentication_error, 429→rate_limit_error, etc.). Non-Anthropic endpoints keep original format.
- **Request validation** (gap #6): PreHandler in `server.ts` validates `model` and `messages` fields for both `/v1/messages` and `/v1/chat/completions`. Returns proper Anthropic-format errors for the messages endpoint.
- **Orphaned tool messages** (gap #8): `sanitizeOrphanedToolMessages()` removes tool messages with no matching `tool_call_id` in preceding assistant messages, preventing 400 errors from upstream providers.

**Remaining gaps**: #4 (usage in message_start), #5 (synthetic signatures), #7 (header validation), #9 (schema normalization)

### Round 9 Context — Transparent Proxy Simplification for OpenCode

**Problem**: CCR had accumulated "smart" routing features (task classification, thinking strategy, adaptive router, adaptive params, reasoning-aware routing with context injection) that overlapped with OpenCode's own provider/routing system. Additionally, financial data APIs were completely out of scope for an LLM proxy.

**OpenCode Architecture Research** (key findings):
- OpenCode has its own LLM routing layer (`packages/llm`) with Protocol/Route/Endpoint patterns
- 75+ built-in providers via AI SDK + Models.dev
- Plugin system with 20+ hooks (`chat.headers`, `chat.params`, `tool.execute.before/after`, `experimental.session.compacting`)
- MCP integration (local/remote), SDK (`@opencode-ai/sdk`), extensive community plugins
- Model ID format: `provider/model-id` (slash), vs CCR's `provider,model` (comma)

**Changes made** (commit 9f2d04f):

1. **router.ts** (net -220 lines): Removed all "smart" routing that overlapped with OpenCode:
   - Task classification + strategy selection → OpenCode decides models
   - Thinking strategy manager → OpenCode decides thinking params
   - Adaptive router scoring → OpenCode's provider system handles provider selection
   - Adaptive parameter tuning → OpenCode handles max_tokens/temperature
   - Reasoning-aware routing with context injection → RAG belongs in OpenCode plugins, not proxy
   - Kept: slash-prefix routing, model alias, tier resolution (backward compat), config-driven scenario routing, health-based fallback
   - Routing now deterministic: `provider,model` → parse → validate → health check → done

2. **server.ts** (net -40 lines): Removed provider-specific logic from server core:
   - `classifyThinkingEffort()` heuristic method removed
   - DeepSeek-specific reasoning effort logic removed from preHandler
   - Unused imports removed (resolveReasoningEffort, thinking)
   - RAG pipeline and adaptive params exports removed

3. **routes.ts** (net -93 lines): Removed out-of-scope APIs:
   - All financial data endpoints (`/api/finance/*`) removed
   - `getFinancialDataService` import removed

**CCR Design Principle (established)**:
CCR is a **transparent proxy and context service** for OpenCode. It should NOT make routing or parameter decisions that override OpenCode's own provider/model system. The router only:
1. Parses model format (`provider,model`)
2. Supports slash-prefix convenience (`openai/gpt-4`)
3. Supports model alias (backward compat with Claude Code configs)
4. Supports config-driven scenario routing (opt-in via Router config)
5. Supports config-driven health fallback (transparent resilience)

**Remaining work for future rounds**:
- Make orchestrator middleware truly opt-in (MemoryBridge, RAGEnricher, ContextCapture, etc. all require `=== true`)
- Split routes.ts into separate files (routes/index.ts, routes/providers.ts, routes/metrics.ts)
- Consider moving remaining enterprise features (tenant isolation, AB testing, traffic mirror) to optional plugins
- Add OpenCode plugin that provides CCR routing capabilities via OpenCode's own plugin hooks
- Evaluate which OpenCode plugin hooks (`chat.headers`, `chat.params`, `experimental.session.compacting`) can be used for CCR integration
- Consider `opencode-llm-proxy` pattern (OpenCode SDK → providers) as alternative approach

### Round 10 Context — All Middleware Opt-In

**Problem**: Many middleware were enabled by default (`!== false`) even though they require external services (Redis, Qdrant, embedding service) or are enterprise features not needed for a local proxy. This caused unnecessary initialization overhead and confusing logs.

**Changes made** (commit 1cb308c):

Changed from `!== false` (default-on) to `=== true` (opt-in):
- `SEMANTIC_CACHE_ENABLED`: requires embedding service
- `REDIS_ENABLED`: requires Redis instance
- `QUALITY_SCORER_ENABLED`: enterprise monitoring
- `AUDIT_LOGGER_ENABLED`: enterprise logging
- `COMPLIANCE_DISCLAIMER_ENABLED`: specific use case
- `CACHE_REPORT_ENABLED`: monitoring feature
- `STRUCTURED_OUTPUT_ENABLED`: requires JSON schema
- `FINANCIAL_PII_MASKER_ENABLED`: financial-specific
- `FALLBACK_CHAIN_ENABLED`: needs fallback config
- `ADAPTIVE_PARAMS_ENABLED`: overlaps with OpenCode
- `SECURITY_HARDENER_ENABLED`: needs config

Kept default-on (`!== false`) — useful for all users:
- `TOOL_COMPRESSOR_ENABLED`: truncates long tool results
- `PROMPT_CACHING_ENABLED`: reduces token usage

**Default CCR startup now**: Only tool compressor and prompt caching are active. Everything else requires explicit `"KEY": true` in config.json. This makes CCR a truly lightweight transparent proxy by default.

### Round 11 Context — Streaming Cache (Phase 1)

**Problem**: The semantic cache explicitly skipped all streaming requests (`shouldSkip()` returned `true` for `stream: true`). Since OpenCode uses 100% streaming, the cache was completely useless. Additionally, cached non-streaming responses couldn't be replayed as SSE streams.

**Architecture**: Cache flow for streaming:
1. Request arrives with `stream: true` → check `SemanticCache.lookupStreaming()` → hit → `SSEReplayer` replays as SSE
2. Miss → upstream request → `formatResponse` wraps stream → `SSECollector` collects chunks in background → client gets immediate response → after stream completes, `SemanticCache.storeStreaming()` stores complete response
3. Next identical request → cache hit → replayed SSE (chunked into 20-char pieces for realistic streaming feel)

**Files created**:
- `packages/core/src/utils/sse-collector.ts`: SSE response collector — feeds raw SSE text, detects format (anthropic/openai), assembles complete response from chunks, generates deterministic streaming cache keys (hash of model + messages + provider)
- `packages/core/src/utils/sse-replayer.ts`: SSE response replayer — converts cached complete response back into SSE ReadableStream, supports both OpenAI (`chat.completion.chunk`) and Anthropic (`message_start`/`content_block_delta`/`message_stop`) formats, chunks content into 20-char pieces for realistic streaming feel, handles text/thinking/tool_use blocks

**Files modified**:
- `packages/core/src/middleware/semantic-cache.ts`:
  - Added `streamingData` field to `CacheEntry` (format + completeResponse)
  - Added `storeStreaming(collected: CollectedSSE)` — stores collected SSE with format metadata
  - Added `lookupStreaming()` — returns `{completeResponse, format}` for replay
  - Fixed `shouldSkip()` — no longer skips `stream: true` requests
  - Raised default `temperatureThreshold` from `0.5` to `0.99` (only skip extreme temperature)
  - Removed `"stream"` from default `skipPatterns`
- `packages/core/src/api/routes.ts`:
  - `formatResponse()` — integrated `SSECollector` to collect SSE in background during streaming, calls `semanticCache.storeStreaming()` after stream completes
  - `handleTransformerEndpoint()` — added streaming cache lookup before upstream request, returns replayed SSE on cache hit
  - Added `x-ccr-cache-force-refresh` header support (set to `"true"` to bypass cache)
  - Added `X-CCR-Cache-Status` response header (`HIT` or `MISS`)
- `packages/core/src/utils/sse/index.ts`: Re-exported new SSE utilities
- `packages/core/src/middleware/semantic-cache.test.ts`: Fixed temperature threshold test to explicitly set threshold

**Verification**: All 354 tests pass, all packages build successfully.

### Round 12 Context — Embedding Unification + Cache Cleanup + MCP Enhancement

**Three changes in this round**:

**1. Embedding Unification (Phase 2)**
- **Problem**: Three separate embedding implementations existed (`utils/embedding.ts`, `services/semantic-store.ts`, `services/context-store.ts`), each with its own fetch logic and format parsing.
- **Solution**: Made `semantic-store.ts` and `context-store.ts` delegate to the unified `getEmbeddingService()` singleton instead of implementing their own embedding.
- Removed `ContextStoreConfig.embeddingEndpoint` field — no longer needed.
- `semantic-store.ts`: Replaced 45-line `generateEmbedding()` with 2-line delegation to `getEmbeddingService()`.
- `context-store.ts`: Replaced 15-line `getEmbedding()` and 12-line `cosineSimilarity()` with delegation to `getEmbeddingService()` + `EmbeddingService.cosineSimilarity()`.
- Updated `semantic-store.test.ts` to mock `../utils/embedding` module instead of raw `fetch`.

**2. Cache Architecture Cleanup (Phase 3)**
- **Removed dead code**:
  - `MultiLevelCache` (496 lines): Initialized in orchestrator but never called in request pipeline. Had its own L1/L2/L3 implementation duplicating SemanticCache+RedisCache+QdrantCache. Removed from orchestrator config, initialization, stats, shutdown, and routes (`/api/cache/multilevel` endpoints).
  - `CacheWarmer`: Never started (`start()` never called). Removed initialization and shutdown.
- **Fixed QdrantCache bug**: `lookup()` was called with empty vector `[]` at orchestrator:716, making vector similarity search useless. Now passes actual embedding from `getEmbeddingService()`. Same fix for `store()`.

**3. Enhanced MCP Tools (Phase 4)**
Added 3 new MCP tools to `/api/mcp` endpoint:
- `cache_invalidate`: Clears semantic cache
- `context_list`: Lists stored context entries with scope/topic filtering
- `context_delete`: Deletes stored context by scope + topic
Enhanced `cache_status`: Now includes semantic cache stats (entries, hits) from `SemanticCache.getStats()`.

**Files modified**:
- `packages/core/src/services/semantic-store.ts`: Delegates to unified `getEmbeddingService()`
- `packages/core/src/services/context-store.ts`: Delegates to unified `getEmbeddingService()`
- `packages/core/src/services/semantic-store.test.ts`: Updated mocks for unified embedding
- `packages/core/src/middleware/orchestrator.ts`: Removed MultiLevelCache/CacheWarmer (~40 lines), fixed QdrantCache vector passing
- `packages/core/src/api/routes.ts`: Removed `/api/cache/multilevel` endpoints (~24 lines)
- `packages/server/src/server.ts`: Added 3 MCP tools + enhanced `cache_status`

**Verification**: All 352 tests pass, all packages build successfully.
