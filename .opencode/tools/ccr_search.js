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
    "Search the CCR semantic store for relevant project context, architecture decisions, and past session insights. " +
    "Use this when you need background information about the project that may not be in the current files.",
  args: {
    query: {
      type: "string",
      description: "Search query - what context are you looking for?",
    },
    scope: {
      type: "string",
      description: "Scope: session, project, or reference (default: project)",
    },
    limit: {
      type: "number",
      description: "Max results to return (default: 5)",
    },
  },
  async execute(args) {
    const result = await ccrFetch("/api/semantic/search", {
      method: "POST",
      body: JSON.stringify({
        query: args.query,
        scope: args.scope || "project",
        limit: args.limit || 5,
        threshold: 0.4,
      }),
    });

    if (!result || !result.results || result.results.length === 0) {
      return `No results found in CCR semantic store for: "${args.query}"`;
    }

    return result.results
      .map(
        (r, i) =>
          `[${i + 1}] Scope: ${r.scope || "unknown"} | Topic: ${r.topic || "general"}\n    ${r.content || ""}`
      )
      .join("\n\n");
  },
};
