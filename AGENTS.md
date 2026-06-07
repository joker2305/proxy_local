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
| HTTP route handler | `packages/core/src/api/routes.ts` (2414 lines) |
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

1. **Error format**: Returns `{error: {message, type, code}}` instead of Anthropic's `{type: "error", error: {type, message}}`
2. ~~**No `/v1/models` endpoint**: Model listing not exposed~~ — **Fixed** in server.ts
3. ~~**No `/v1/messages/count_tokens`**: Token counting endpoint missing~~ — **Fixed** in server.ts
4. **Usage in `message_start`**: Always reports `input_tokens: 0` — real Anthropic includes input tokens here
5. **Synthetic thinking signatures**: Non-Anthropic providers get fake signatures (timestamps), not cryptographic ones
6. **No request validation**: Missing schema checks on required fields (`max_tokens`, `messages`, `model`)
7. **`anthropic-version`/`anthropic-beta` headers**: Stripped for non-Anthropic but not validated on incoming requests
8. **Orphaned tool messages**: No sanitization of tool messages without matching assistant tool_calls (claw-code does this)
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
