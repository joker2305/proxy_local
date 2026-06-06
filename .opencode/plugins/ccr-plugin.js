export const CcrPlugin = async ({ project, directory, worktree }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash" && output.args) {
        const cmd = output.args.command || output.args || "";
        if (typeof cmd === "string" && cmd.includes("pnpm build")) {
          const fs = await import("fs");
          const path = await import("path");
          const root = worktree || directory;
          const checks = [
            { pkg: "shared", dir: "packages/shared/dist" },
            { pkg: "core", dir: "packages/core/dist" },
            { pkg: "server", dir: "packages/server/dist" },
          ];
          const missing = checks
            .filter((c) => !fs.existsSync(path.join(root, c.dir)))
            .map((c) => c.pkg);
          if (missing.length > 0) {
            const prefix = missing
              .map((m) => `pnpm build:${m}`)
              .join(" && ");
            output.args.command =
              typeof output.args === "string"
                ? `${prefix} && ${cmd}`
                : cmd.replace("pnpm build", `${prefix} && pnpm build`);
          }
        }
      }
    },

    "experimental.session.compacting": async (input, output) => {
      output.context.push(
        `## CCR Proxy Architecture (preserve across compaction)
- Monorepo: shared → core(@musistudio/llms) → server → cli, plus ui (ESM)
- Build: esbuild (core/server/cli/shared), Vite (ui). Always build shared before core.
- Framework: Fastify. Transformer pipeline: Anthropic → Unified(OpenAI) → Provider-native.
- Key files: routes.ts (2414L), router.ts (654L), anthropic.transformer.ts, server.ts
- Config: ~/.claude-code-router/config.json (JSON5). Model format: "providerName,modelName"
- Tests: vitest. Run: pnpm test or npx vitest run <path>
- See AGENTS.md for full reference including protocol gaps and ecosystem patterns.`
      );
    },
  };
};
