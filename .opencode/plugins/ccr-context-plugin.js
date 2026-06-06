const CCR_BASE_URL = process.env.CCR_BASE_URL || "http://localhost:4096";

async function ccrFetch(path, options = {}) {
  try {
    const resp = await fetch(`${CCR_BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(options.timeout || 3000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export const CcrContextPlugin = async ({ project, client, directory, worktree }) => {
  const health = await ccrFetch("/api/health");
  const ccrAvailable = health?.status === "ok";

  if (ccrAvailable) {
    await client.app.log({
      body: {
        service: "ccr-context-plugin",
        level: "info",
        message: `CCR proxy connected at ${CCR_BASE_URL}`,
        extra: {
          providers: health.providers?.map((p) => p.name) || [],
          semanticStore: health.semanticStore?.connected || false,
        },
      },
    });
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(
        `## CCR Proxy Architecture (preserve across compaction)
- Monorepo: shared → core(@musistudio/llms) → server → cli, plus ui (ESM)
- Build: esbuild (core/server/cli/shared), Vite (ui). Always build shared before core.
- Framework: Fastify. Transformer pipeline: Anthropic ↔ Unified(OpenAI) ↔ Provider-native.
- Key files: routes.ts, router.ts, anthropic.transformer.ts, server.ts
- Config: ~/.claude-code-router/config.json (JSON5). Model format: "providerName,modelName"
- Architecture: CCR is a proxy service for OpenCode. Context via MCP/REST API, not transparent injection.
- CCR Status: ${ccrAvailable ? "connected" : "unavailable"} at ${CCR_BASE_URL}
- See AGENTS.md for full reference.`
      );

      if (ccrAvailable) {
        try {
          const searchResult = await ccrFetch("/api/semantic/search", {
            method: "POST",
            body: JSON.stringify({
              query: input.session?.title || "project context",
              scope: "project",
              limit: 3,
              threshold: 0.4,
            }),
          });
          if (searchResult?.results?.length > 0) {
            const ctx = searchResult.results
              .map((r, i) => `[${i + 1}] (${r.source || "semantic"}) ${(r.content || "").substring(0, 500)}`)
              .join("\n");
            output.context.push(`## CCR Semantic Context\n${ctx}`);
          }
        } catch {}
      }
    },

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
            const prefix = missing.map((m) => `pnpm build:${m}`).join(" && ");
            output.args.command =
              typeof output.args === "string"
                ? `${prefix} && ${cmd}`
                : cmd.replace("pnpm build", `${prefix} && pnpm build`);
          }
        }
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.idle" && ccrAvailable) {
        try {
          await ccrFetch("/api/context/collect", {
            method: "POST",
            body: JSON.stringify({}),
          });
        } catch {}
      }
    },
  };
};
