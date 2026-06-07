---
name: protocol-analysis
description: Analyze Anthropic Messages API protocol details, compare with OpenAI/Gemini formats, and identify compatibility gaps in the CCR proxy
---

## What I do

I analyze protocol-level details of LLM API formats and compare them against the CCR proxy implementation. I focus on the Anthropic Messages API (`POST /v1/messages`) and its translation to/from other provider formats.

## Key Reference Architecture

The CCR proxy uses a 2-layer transformer pipeline:
1. **Outer layer** (`AnthropicTransformer` at `packages/core/src/transformer/anthropic.transformer.ts`): Anthropic ↔ Unified OpenAI-compatible format
2. **Inner layer** (provider transformers like `GeminiTransformer`, `DeepseekTransformer`): Unified ↔ Provider-native

## Known Protocol Gaps (vs Anthropic spec)

1. **Error format**: Returns `{error: {message, type, code}}` instead of Anthropic's `{type: "error", error: {type, message}}`
2. **No `/v1/models` endpoint**: Model listing not exposed
3. **No `/v1/messages/count_tokens`**: Token counting endpoint missing
4. **Usage in `message_start`**: Always reports `input_tokens: 0` — real Anthropic includes input tokens here
5. **Synthetic thinking signatures**: Non-Anthropic providers get fake signatures (timestamps), not cryptographic ones
6. **No request validation**: Missing schema checks on required fields (`max_tokens`, `messages`, `model`)
7. **Orphaned tool messages**: No sanitization of tool messages without matching assistant tool_calls
8. **Schema normalization**: Tool input schemas not normalized with `properties: {}` + `additionalProperties: false` for OpenAI strict mode

## Anthropic SSE Event Types

- `message_start` — contains initial message object with id, type, role, model, usage
- `content_block_start` — `{index, content_block: {type, ...}}` where type is text|tool_use|thinking
- `content_block_delta` — `{index, delta}` where delta is text_delta|input_json_delta|thinking_delta|signature_delta
- `content_block_stop` — `{index}`
- `message_delta` — `{delta: {stop_reason, stop_sequence}, usage: {output_tokens}}`
- `message_stop` — `{}`

## Claw Code Reference Patterns (from `D:\project\claw-code-main`)

Key patterns to look for in `rust/crates/api/src/providers/openai_compat.rs`:
- `sanitize_tool_message_pairing()` — drops orphaned tool messages
- `normalize_object_schema()` — ensures `properties: {}` + `additionalProperties: false`
- `model_rejects_is_error_field()` — strips `is_error` for kimi models
- `model_requires_reasoning_content_in_history()` — DeepSeek V4 preserves reasoning in history
- GPT-5 uses `max_completion_tokens` instead of `max_tokens`
- Reasoning models (o1/o3/o4/grok-3-mini/qwq) strip temperature/top_p/frequency/presence penalties
- Preflight body size checks: DashScope 6MB, xAI 50MB, OpenAI 100MB

## When to use me

Use this skill when:
- Investigating why a specific Claude Code request fails through the proxy
- Adding support for a new Anthropic API feature
- Comparing the proxy's format conversion against the Anthropic spec
- Debugging SSE streaming issues
- Evaluating protocol compatibility for new provider integrations
