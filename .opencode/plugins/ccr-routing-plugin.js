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

export const CcrRoutingPlugin = async ({ project, client, $, directory, worktree }) => {
  const health = await ccrFetch("/api/health");
  const ccrAvailable = health?.status === "ok";
  const ccrProviders = ccrAvailable ? (health.providers || []) : [];

  if (ccrAvailable) {
    const providerNames = ccrProviders.map((p) => p.name);
    const modelList = ccrProviders.flatMap((p) =>
      (p.models || []).map((m) => `  ${p.name},${m}`)
    );

    await client.app.log({
      body: {
        service: "ccr-routing-plugin",
        level: "info",
        message: `CCR routing available. Providers: ${providerNames.join(", ")}`,
        extra: { models: modelList },
      },
    });
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      if (ccrAvailable) {
        const providerList = ccrProviders
          .map((p) => `${p.name}: ${(p.models || []).join(", ")}`)
          .join("\n");
        output.context.push(
          `## CCR Available Models (via ${CCR_BASE_URL})
${providerList}
Use model format "providerName,modelName" in CCR provider config.
CCR provides semantic cache, transformer pipeline, and context services.`
        );
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.created" && ccrAvailable) {
        try {
          await ccrFetch("/api/context/store", {
            method: "POST",
            body: JSON.stringify({
              scope: "session",
              topic: "session_start",
              content: JSON.stringify({
                sessionId: event.properties?.id,
                timestamp: new Date().toISOString(),
                project: project?.path,
              }),
              source: "opencode-routing-plugin",
            }),
          });
        } catch {}
      }

      if (event.type === "session.idle" && ccrAvailable) {
        try {
          const searchResult = await ccrFetch("/api/semantic/search", {
            method: "POST",
            body: JSON.stringify({
              query: event.properties?.title || "recent context",
              scope: "project",
              limit: 3,
            }),
          });
          if (searchResult?.results?.length > 0) {
            await client.app.log({
              body: {
                service: "ccr-routing-plugin",
                level: "debug",
                message: `Found ${searchResult.results.length} relevant context entries from CCR`,
              },
            });
          }
        } catch {}
      }
    },
  };
};
