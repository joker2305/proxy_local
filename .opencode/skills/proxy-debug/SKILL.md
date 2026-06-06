---
name: proxy-debug
description: Debug CCR proxy issues — trace request flow, analyze transformer pipeline, inspect SSE streaming, and diagnose routing problems
---

## What I do

I help trace and debug the full request lifecycle through the CCR proxy, from client request through routing, transformation, upstream provider call, and response back to the client.

## Request Flow Trace Map

```
Client (Claude Code / OpenCode)
  → Fastify server (packages/core/src/server.ts)
  → Router preHandler hook (packages/core/src/utils/router.ts)
      - Extracts session ID from metadata.user_id
      - Calculates token count (tiktoken cl100k_base)
      - Resolves target model via priority chain:
        1. Explicit model (contains comma) → use directly
        2. Long context (tokens > longContextThreshold, default 60000) → Router.longContext
        3. Subagent tag <CCR-SUBAGENT-MODEL> → Router.subagent
        4. Background (claude + haiku in name) → Router.background
        5. Web search tools present → Router.webSearch
        6. Thinking enabled → Router.think
        7. Default → Router.default
      - Sets req.body.model to "providerName,modelName"
  → preHandler hook (packages/server/src/server.ts) splits into req.provider / req.model
  → Route handler (packages/core/src/api/routes.ts)
      - Resolves provider from TransformerService
      - Request transforms: transformRequestOut → provider transformRequestIn → model transformRequestIn
      - Sends to upstream (with concurrency Semaphore)
      - Response transforms: provider transformResponseOut → model transformResponseOut → transformResponseIn
      - Returns streaming (SSE) or JSON response
```

## Debugging Approaches

### 1. Check if the proxy is running
```bash
curl http://localhost:4096/health
```

### 2. Test a basic Anthropic-format request
```bash
curl -X POST http://localhost:4096/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"model":"your-provider,your-model","max_tokens":100,"messages":[{"role":"user","content":"hello"}]}'
```

### 3. Test streaming
Add `"stream": true` to the request body and check SSE output format.

### 4. Check config
Config at `~/.claude-code-router/config.json` (JSON5). Verify:
- `Providers` section has correct `HOST` and `APIKEY`
- Model aliases in `ModelMapping` if used
- Router configuration for different scenarios

### 5. Check circuit breaker state
```bash
curl http://localhost:4096/api/circuit-breakers
```

### 6. Check provider health
```bash
curl http://localhost:4096/api/health
```

## Common Failure Patterns

| Symptom | Likely Cause | File to Check |
|---------|-------------|---------------|
| 401/403 errors | API key mismatch or missing auth headers | Transformer's `auth()` method |
| Malformed SSE output | Stream conversion bug | Provider transformer's streaming code |
| Empty tool call response | Tool call ID not generated | `GroqTransformer` or response conversion |
| Wrong stop_reason | Finish reason not normalized | `AnthropicTransformer.transformResponseIn()` |
| Request hangs forever | Concurrency semaphore full | `packages/core/src/utils/concurrency.ts` |
| 500 from upstream | Body format wrong for provider | Provider transformer's `transformRequestIn()` |
| Missing thinking blocks | Reasoning not configured | `ReasoningTransformer` or `DeepseekTransformer` |

## Log Locations

- Server stdout/stderr (when running via `ccr start` or `pnpm dev:server`)
- Run logs: `local/run-logs/` directory
- Dashboard: `http://localhost:4096/ui/`

## When to use me

Use this skill when:
- A request through the proxy fails or returns unexpected results
- SSE streaming is broken or incomplete
- Tool calls are not working correctly across providers
- Routing resolves to the wrong provider or model
- Need to understand which transformer handles a specific request
