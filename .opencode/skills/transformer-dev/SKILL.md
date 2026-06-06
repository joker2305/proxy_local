---
name: transformer-dev
description: Guide development of new transformers and modification of existing transformers in the CCR proxy's transformation pipeline
---

## What I do

I guide the creation and modification of transformer plugins for the CCR proxy. Transformers handle request/response conversion between the unified OpenAI-compatible format and provider-native formats.

## Transformer Architecture

### Location
All transformers live in `packages/core/src/transformer/`.

### Interface (`packages/core/src/types/transformer.ts`)
Each transformer implements the `Transformer` interface with optional methods:
- `transformRequestOut(request)` — modify outgoing request before provider-specific transform
- `transformRequestIn(request)` — modify request after general transform (provider-specific)
- `transformResponseOut(response)` — modify response from provider before general transform
- `transformResponseIn(response)` — modify response after provider transforms (final)
- `auth(request)` — set authentication headers
- `endPoint` — if set, registers a dedicated Fastify POST route for this transformer

### Registration
Register in `packages/core/src/transformer/index.ts` — import and add to the default export object.

### Pipeline Order
Request: `transformRequestOut` → provider `transformRequestIn` → model-specific `transformRequestIn`
Response: provider `transformResponseOut` → model-specific `transformResponseOut` → `transformResponseIn`

### Passthrough Mode
When a provider uses only one transformer matching the route's transformer, all other transformers are bypassed and the request is forwarded as-is with auth headers.

## Existing Transformers (reference implementations)

| Transformer | File | Purpose |
|-------------|------|---------|
| `AnthropicTransformer` | `anthropic.transformer.ts` | Anthropic ↔ Unified format (outer layer) |
| `OpenAITransformer` | `openai.transformer.ts` | OpenAI passthrough (empty class) |
| `GeminiTransformer` | `gemini.transformer.ts` | Unified ↔ Gemini native format |
| `DeepseekTransformer` | `deepseek.transformer.ts` | DeepSeek V4 thinking/reasoning |
| `OpenrouterTransformer` | `openrouter.transformer.ts` | OpenRouter-specific handling |
| `GroqTransformer` | `groq.transformer.ts` | Groq-specific (strips cache_control, fixes tool IDs) |
| `CerebrasTransformer` | `cerebras.transformer.ts` | Cerebras-specific |
| `VercelTransformer` | `vercel.transformer.ts` | Vercel AI SDK |
| `OpenAIResponsesTransformer` | `openai.responses.transformer.ts` | OpenAI Responses API ↔ Chat Completions |
| `TooluseTransformer` | `tooluse.transformer.ts` | Forces tool use via ExitTool pattern |
| `ReasoningTransformer` | `reasoning.transformer.ts` | Converts reasoning config to thinking format |
| `ForceReasoningTransformer` | `forcereasoning.transformer.ts` | Injects `<reasoning_content>` tags |
| `StreamOptionsTransformer` | `streamoptions.transformer.ts` | Adds `stream_options: {include_usage: true}` |
| `MaxTokenTransformer` | `maxtoken.transformer.ts` | Adjusts max_tokens |
| `MaxCompletionTokens` | `maxcompletiontokens.transformer.ts` | GPT-5 max_completion_tokens handling |
| `CustomParamsTransformer` | `customparams.transformer.ts` | Injects custom parameters from config |

## Key Patterns from Claw Code Reference

When building a new provider transformer, follow these patterns from `openai_compat.rs`:

1. **Orphaned tool message sanitization**: Drop `role: "tool"` messages without matching `role: "assistant"` with `tool_calls[].id`
2. **Schema normalization**: Add `properties: {}` and `additionalProperties: false` to all tool input schemas for OpenAI strict mode
3. **Model-specific body stripping**: Reasoning models strip temperature/top_p; kimi strips `is_error`; GPT-5 uses `max_completion_tokens`
4. **Thinking/reasoning mapping**: `reasoning_content` (DeepSeek/GLM) and `thinking.content` (others) map to Anthropic `thinking` blocks
5. **Finish reason normalization**: `stop` → `end_turn`, `tool_calls` → `tool_use`

## When to use me

Use this skill when:
- Creating a new provider transformer
- Modifying an existing transformer's request/response handling
- Debugging transformation pipeline issues
- Adding model-specific quirks (like GPT-5 or DeepSeek V4 handling)
- Understanding the passthrough mode optimization
