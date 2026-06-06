---
description: Build a specific package or all packages in the monorepo
agent: build
---

Build the CCR proxy monorepo. Build order matters: shared → core → server → cli → ui.

If the user specified a specific package, build only that one:
- shared: `pnpm build:shared`
- core: `pnpm build:core`
- server: `pnpm build:server`
- cli: `pnpm build:cli`
- ui: `pnpm build:ui`

If no package specified or "all", run:
```
pnpm build
```

**Important**: If building `core`, ensure `shared` is built first. If building `server`, ensure `core` is built first. The root `pnpm build` handles ordering automatically.

After building, verify the output exists in the `dist/` directory of the relevant package.
