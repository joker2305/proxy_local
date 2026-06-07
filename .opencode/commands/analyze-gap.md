---
description: Analyze a specific protocol gap and compare CCR implementation against claw-code reference and Anthropic spec
agent: build
subtask: true
---

Load the `claw-code-compare` skill, then analyze the protocol gap specified by the user.

The analysis should cover:
1. What the Anthropic Messages API spec says about this feature
2. How claw-code (Rust) implements it at `D:\project\claw-code-main\claw-code-main\rust\crates\api\src\providers\`
3. How CCR proxy currently handles it in `packages/core/src/transformer/` and `packages/core/src/api/routes.ts`
4. The exact gap with file:line references
5. A proposed fix approach

Known gaps to investigate:
- Error format normalization
- Orphaned tool message sanitization
- Schema normalization for OpenAI strict mode
- Request body validation
- Usage reporting in message_start
- Model-specific body stripping (GPT-5, kimi, reasoning models)
- Preflight body size checks
- Token counting endpoint

User's topic: $ARGUMENTS
