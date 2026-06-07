---
description: Start the CCR proxy dev server and watch for changes
agent: build
---

Start the CCR proxy development server with hot reload.

Run the appropriate dev command based on what the user wants:
- Server: `pnpm dev:server` (runs via tsx, watches for changes)
- CLI: `pnpm dev:cli` (runs via ts-node)
- Core: `pnpm dev:core` (uses nodemon for auto-restart)
- UI: `pnpm dev:ui` (Vite dev server)

Default is server if not specified.

After starting, the server listens on the configured port (default 4096).
Config location: `~/.claude-code-router/config.json`

Quick health check after startup:
```
curl http://localhost:4096/health
```
