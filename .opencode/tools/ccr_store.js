const CCR_BASE_URL = process.env.CCR_BASE_URL || "http://localhost:4096";

async function ccrFetch(path, options = {}) {
  try {
    const resp = await fetch(`${CCR_BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(options.timeout || 5000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export default {
  description:
    "Store important context in the CCR semantic store for future retrieval. " +
    "Use this to save architecture decisions, important patterns, or session learnings.",
  args: {
    scope: {
      type: "string",
      description: "Scope: session, project, or reference",
    },
    topic: {
      type: "string",
      description: "Topic or category for this context",
    },
    content: {
      type: "string",
      description: "The context content to store",
    },
  },
  async execute(args) {
    const result = await ccrFetch("/api/context/store", {
      method: "POST",
      body: JSON.stringify({
        scope: args.scope,
        topic: args.topic,
        content: args.content,
        source: "opencode-tool",
      }),
    });

    if (!result || !result.success) {
      return `Failed to store context. CCR may be unavailable at ${CCR_BASE_URL}`;
    }

    return `Context stored successfully (id: ${result.id}). It will be available for future semantic searches.`;
  },
};
