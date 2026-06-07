const CCR_BASE = process.env.CCR_BASE_URL || "http://localhost:4096";

async function ccrFetch(path, opts = {}) {
  try {
    const r = await fetch(`${CCR_BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...opts.headers },
      signal: AbortSignal.timeout(opts.timeout || 3000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export const CcrRoutingPlugin = async ({ project, client }) => {
  let discoveredModels = null;

  async function discoverModels() {
    if (discoveredModels) return discoveredModels;
    const providers = await ccrFetch("/providers");
    if (!providers) return [];
    discoveredModels = providers.map((p) => ({
      id: p.name,
      models: p.models || [],
      status: p.status || "unknown",
    }));
    return discoveredModels;
  }

  try {
    await client.app.log({
      body: {
        service: "ccr-routing-plugin",
        level: "info",
        message: "CCR routing plugin initialized",
      },
    });
  } catch {}

  return {
    "experimental.session.compacting": async (input, output) => {
      const models = await discoverModels();
      if (models && models.length > 0) {
        const modelInfo = models
          .map((p) => `${p.id}: ${p.models.join(", ") || "no models listed"} [${p.status}]`)
          .join("\n");
        output.context.push(`## CCR Available Providers/Models\n${modelInfo}`);
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.created") {
        discoveredModels = null;
      }
      if (event.type === "session.idle") {
        discoveredModels = null;
      }
    },
  };
};
