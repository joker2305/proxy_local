---
name: claw-code-compare
description: Compare CCR proxy implementation against claw-code (Rust Claude Code reimplementation) to find protocol gaps and improvement opportunities
---

## What I do

I help compare the CCR proxy's implementation against the claw-code reference project at `D:\project\claw-code-main\claw-code-main\`. Claw Code is a Rust reimplementation of Claude Code that contains valuable reference data about the original TypeScript source structure and multi-provider protocol handling.

## Claw Code Key File Map

| Concern | File | Lines |
|---------|------|-------|
| Anthropic provider | `rust/crates/api/src/providers/anthropic.rs` | ~1716 |
| OpenAI-compatible provider | `rust/crates/api/src/providers/openai_compat.rs` | ~2733 |
| Provider detection/routing | `rust/crates/api/src/providers/mod.rs` | ~1711 |
| SSE parsing | `rust/crates/api/src/sse.rs` | ~330 |
| Type definitions | `rust/crates/api/src/types.rs` | ~355 |
| Error types | `rust/crates/api/src/error.rs` | ~629 |
| Prompt cache | `rust/crates/api/src/prompt_cache.rs` | ~735 |
| System prompt assembly | `rust/crates/runtime/src/prompt.rs` | ~1039 |
| Tool definitions (40 tools) | `rust/crates/tools/src/lib.rs` | ~10595 |
| Original TS reference data | `src/reference_data/` | snapshots |
| Original TS commands | `src/reference_data/commands_snapshot.json` | 207 entries |
| Original TS tools | `src/reference_data/tools_snapshot.json` | 184 entries |
| Original TS subsystems | `src/reference_data/subsystems/` | 29 JSON files |

## Priority Comparison Points

### 1. Authentication (anthropic.rs)
Claw Code sends BOTH `x-api-key` AND `Authorization: Bearer` simultaneously when both env vars are set (`ApiKeyAndBearer` variant). CCR only uses one auth method at a time.

### 2. Body Field Stripping (anthropic.rs:984-997)
`strip_unsupported_beta_body_fields()` removes:
- `betas` (beta opt-in is header-only)
- `frequency_penalty` (OpenAI-only)
- `presence_penalty` (OpenAI-only)
- Converts `stop` → `stop_sequences`

### 3. Tool Message Sanitization (openai_compat.rs:1241-1295)
`sanitize_tool_message_pairing()` drops `role: "tool"` messages without a preceding `role: "assistant"` message containing a matching `tool_calls[].id`. CCR does NOT do this.

### 4. Schema Normalization (openai_compat.rs:1334-1357)
`normalize_object_schema()` recursively ensures every `type: "object"` node has `properties: {}` and `additionalProperties: false`. Required for OpenAI strict mode.

### 5. Model-Specific Quirks (openai_compat.rs)
- GPT-5: `max_completion_tokens` instead of `max_tokens`
- kimi models: strip `is_error` field from tool results
- DeepSeek V4: preserve `reasoning_content` in assistant history
- Reasoning models (o1/o3/o4/grok-3-mini/qwq): strip temperature/top_p/frequency_penalty/presence_penalty

### 6. Preflight Body Size Checks (openai_compat.rs)
- DashScope: 6MB limit
- xAI: 50MB limit
- OpenAI: 100MB limit

### 7. Retry Logic (anthropic.rs)
- Up to 8 retries with exponential backoff (1s → 128s) + jitter
- Retryable status codes: 408, 409, 429, 500, 502, 503, 504

### 8. Token Counting (anthropic.rs)
- Best-effort call to `POST /v1/messages/count_tokens`
- Falls back to local byte estimate (`bytes / 4 + 1`) if endpoint unavailable
- Used for preflight context window check

## Original Claude Code Intelligence

The `src/reference_data/` directory contains snapshots of the original Claude Code TypeScript source:
- **1,902 TypeScript files** across 30 subsystems
- **207 commands**: add-dir, agents, bridge, bughunter, chrome, compact, config, cost, desktop, diff, doctor, export, files, help, hooks, init, issue, mcp, memory, model, permissions, plugin, pr, release-notes, review, security-review, session, skills, status, subagent, tasks, team, telemetry, ultraplan, usage, version, etc.
- **184 tools**: AgentTool, BashTool, FileEditTool, GrepTool, McpTool, WebSearchTool, etc.
- **30 subsystems**: hooks (104 modules), cli (19 modules), tools (184 modules), commands (207 entries), etc.

## When to use me

Use this skill when:
- Comparing CCR's protocol handling against a known-good implementation
- Finding gaps in transformer logic by comparing with claw-code's approach
- Understanding model-specific quirks that CCR should handle
- Looking up original Claude Code feature coverage data
- Planning new feature development based on Claude Code's capabilities
