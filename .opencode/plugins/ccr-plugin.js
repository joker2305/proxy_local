export const CcrPlugin = async ({ project, client, directory, worktree }) => {
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
- Framework: Fastify. Transformer pipeline: Anthropic ↔ Unified(OpenAI) ↔ Provider-native.
- Key files: routes.ts, router.ts, anthropic.transformer.ts, server.ts
- Config: ~/.claude-code-router/config.json (JSON5). Model format: "providerName,modelName"
- Tests: vitest. Run: pnpm test or npx vitest run <path>
- Architecture: CCR is a proxy service for OpenCode. Routing/context injection via plugins/MCP.
- See AGENTS.md for full reference.`
      );

      try {
        const resp = await fetch("http://localhost:4096/api/semantic/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: input.session?.title || "project context",
            scope: "project",
            limit: 3,
            threshold: 0.5,
          }),
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.results?.length > 0) {
            const ctx = data.results
              .map((r, i) => `[${i + 1}] (${r.source || "semantic"}) ${(r.content || "").substring(0, 500)}`)
              .join("\n");
            output.context.push(`## CCR Semantic Context\n${ctx}`);
          }
        }
      } catch {}
    },
  };
};
