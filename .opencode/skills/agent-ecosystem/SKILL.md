---
name: agent-ecosystem
description: Comprehensive reference for AI coding agent architectures — Aider, Crush, Cline, Cursor, Claw Code patterns applicable to LLM proxy/gateway development
---

## What I do

I provide architectural patterns and reference data from the broader AI coding agent ecosystem. Use me when designing proxy features, evaluating multi-model strategies, or understanding how different AI tools connect to LLM providers.

## Ecosystem Map

| Tool | Language | Stars | Provider Layer | Key Innovation |
|------|----------|-------|---------------|----------------|
| Aider | Python | 30k+ | litellm (universal) | Architect/Editor multi-model; per-model edit format YAML; repo map (tree-sitter graph ranking) |
| Crush | Go | 25k+ | Custom (openai/anthropic/openai-compat types) | Dual protocol support; SQLite session persistence; agent skills standard (agentskills.io) |
| Cline | TypeScript | 50k+ | `@cline/llms` handler factory + registry | SDK platform; gateway pattern; plugin system; tool approval policies |
| Cursor | Closed | — | Custom IDE integration | Model switching per task; worktrees for parallel agents; rules system |
| Claw Code | Rust | — | Multi-provider (anthropic/openai_compat) | Claude Code reverse engineering reference; model-specific body stripping |
| OpenCode | Go | 160k+ | AI SDK + `@ai-sdk/openai-compatible` | Skills/agents/commands/plugins system; MCP with OAuth |

## Cross-Cutting Patterns

### 1. Provider Connection Patterns

| Pattern | Tool | How It Works |
|---------|------|-------------|
| Universal completion API | Aider (via litellm) | `litellm.completion()` normalizes 100+ providers behind OpenAI format |
| Handler factory + registry | Cline (`@cline/llms`) | `createHandler(providerId)` → provider-specific handler from registry |
| Dual protocol types | Crush | `openai` / `openai-compat` / `anthropic` config types per endpoint |
| Transformer pipeline | CCR proxy | Anthropic → Unified → Provider-native via 2-layer transformer chain |
| AI SDK providers | OpenCode | `@ai-sdk/openai-compatible` for any OpenAI-compatible endpoint |

### 2. Model ID Convention

All tools use `provider/model-name` format:
- Aider: `deepseek/deepseek-chat`, `gemini/gemini-2.5-pro`
- Cline: `openai/gpt-5.5`, `gemini/gemini-3.1-pro-preview`
- Crush: configured per-model with `id`, `name`, `context_window`
- CCR: `providerName,modelName` (comma-separated — differs from standard)

### 3. Multi-Model Orchestration

| Pattern | Tool | Description |
|---------|------|-------------|
| Architect/Editor | Aider | Strong reasoner plans → fast editor formats edits. Cross-provider pairing (o1 + Sonnet = 82.7%) |
| Main/Weak model | Aider | Weak model for commit messages and summarization |
| Plan/Act toggle | Cline | User-controlled mode switching between exploration and execution |
| Coordinator/Workers | Cline | Multi-agent teams with specialist sub-agents |
| Model switching | Cursor | Different models for different task phases |
| Routing tiers | CCR | longContext / background / webSearch / thinking / default scenarios |

### 4. Streaming Patterns

| Pattern | Tool | Details |
|---------|------|---------|
| Per-model streaming toggle | Aider | Reasoning models (o1, o3-pro) set `streaming: false` |
| Infinite output via prefill | Aider | Mid-edit token limit → new request with partial response prefilled |
| Event-driven streaming | Cline | `onEvent` callback: `content_update`, `content_start`, `usage` |
| Cache keepalive pings | Aider | Every 5 min to prevent Anthropic prompt cache expiration |
| Stream options | CCR | `stream_options: {include_usage: true}` for OpenAI |

### 5. Tool/Function Calling Patterns

| Pattern | Tool | Details |
|---------|------|---------|
| Prompt-based editing | Aider | No function calling — structured text (diff/search-replace) parsed with regex |
| JSON Schema tools | Cline, Cursor | `createTool({ name, description, inputSchema, execute })` |
| MCP integration | Cline, Cursor, Crush, OpenCode | Model Context Protocol for external tool discovery |
| Tool approval policies | Cline | Per-tool `autoApprove` or dynamic `requestToolApproval` callback |
| Plugin lifecycle hooks | Cline, OpenCode | `beforeRun`, `beforeTool`, `afterRun` hooks |

### 6. Code Edit Formats

| Format | Used By | Description |
|--------|---------|-------------|
| Search/Replace diff | Aider | `<<< SEARCH` / `===` / `>>> REPLACE` merge conflict markers |
| Unified diff | Aider | Traditional `--- a/file` / `+++ b/file` format |
| Whole file | Aider | Full file replacement — highest token cost |
| apply_patch | Cline | Structured patch application |
| Diff review | Cursor, Cline | Show diffs for human approval |

### 7. Context Management

| Technique | Tool | Details |
|-----------|------|---------|
| Repo map (tree-sitter) | Aider | Graph-ranked AST summary within `--map-tokens` budget |
| SQLite session persistence | Crush | Sessions, messages (JSON parts), file versions, read tracking |
| Checkpoint/restore | Cline, Cursor | Undo capability via git worktrees or snapshots |
| Dynamic map sizing | Aider | Adjusts context window based on chat state |
| Prompt cache ordering | Aider | System → read-only files → repo map → editable files → history |

### 8. Per-Model Configuration (Aider Pattern — most comprehensive)

```yaml
- name: anthropic/claude-sonnet-4-20250514
  edit_format: diff
  weak_model_name: anthropic/claude-haiku-4-20250514
  use_repo_map: true
  use_temperature: true
  streaming: true
  cache_control: true
  extra_params:
    extra_headers:
      anthropic-beta: prompt-caching-2024-07-31,pdfs-2024-09-25
    max_tokens: 64000

- name: openai/o3
  edit_format: diff
  use_system_prompt: false      # o3 doesn't support system prompts
  use_temperature: false        # reasoning models require temp disabled
  streaming: false
  system_prompt_prefix: "Formatting re-enabled. "  # workaround
```

## Crush-Specific Integration (local project)

Crush is installed globally (v0.74.1) and has session data in `.crush/`:
- Config: `~/.config/crush/crush.json` — provider `zai` (GLM)
- Database: `.crush/crush.db` (SQLite) — sessions, messages, file versions
- Logs: `.crush/logs/crush.log` — structured JSON
- Skills: reads from `.claude/skills`, `.agents/skills`, `.cursor/skills`

Crush can connect to CCR proxy via `openai-compat` type:
```json
{
  "type": "openai-compat",
  "base_url": "http://localhost:4096/v1",
  "api_key": "your-key",
  "models": [{ "id": "claude-sonnet-4-5", "context_window": 200000 }]
}
```

## When to use me

Use this skill when:
- Designing new proxy features informed by ecosystem patterns
- Evaluating multi-model routing strategies
- Understanding how different AI tools connect to providers
- Planning provider compatibility for a new client tool
- Researching edit format or context management patterns
- Comparing CCR's approach against established tools
