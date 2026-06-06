---
description: Run tests and show coverage for the CCR proxy project
agent: build
---

Run the test suite for the CCR proxy project. The tests use vitest configured in `vitest.workspace.ts`.

If the user specified a specific test file or path, run only that test:
```
npx vitest run $ARGUMENTS
```

Otherwise run the full suite:
```
pnpm test
```

Show any failures with context and suggest fixes. If all tests pass, summarize the coverage.

Available test files:
- `packages/core/src/__tests__/phase3-routing.test.ts` — routing, fallback chains, adaptive params, rate limiting, RAG pipeline
- `packages/core/src/__tests__/v2-infrastructure.test.ts` — vault, adaptive router, multi-level cache, security, prometheus, reasoning chains, traffic mirror, context store
- `packages/server/src/**/*.test.ts` — server-layer tests
