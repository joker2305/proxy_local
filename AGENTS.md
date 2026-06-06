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
2. **No `/v1/models` endpoint**: Model listing not exposed
3. **No `/v1/messages/count_tokens`**: Token counting endpoint missing
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
      "models": { "claude-sonnet-4-5": { "name": "Sonnet 4.5" } }
    }
  }
}
```
Model IDs: `"ccr/claude-sonnet-4-5"`. OpenCode expects OpenAI-compatible `/v1/chat/completions` — proxy needs both endpoints working.

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
