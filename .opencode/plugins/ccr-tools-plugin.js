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

export const CcrContextToolsPlugin = async ({ project, client, $, directory, worktree }) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(
        `## CCR Context Tools Available
Use ccr_search tool to find relevant project context from the CCR semantic store.
Use ccr_store tool to save important context for future sessions.
CCR endpoint: ${CCR_BASE_URL}`
      );
    },
  };
};

export const CcrSearchTool = async ({ project, client, $, directory, worktree }) => {
  const { tool } = await import("@opencode-ai/plugin");

  return {
    tool: {
      ccr_search: tool({
        description:
          "Search the CCR semantic store for relevant project context, architecture decisions, and past session insights. " +
          "Use this when you need background information about the project that may not be in the current files.",
        args: {
          query: tool.schema.string().describe("Search query - what context are you looking for?"),
          scope: tool.schema.string().optional().describe("Scope: session, project, or reference (default: project)"),
          limit: tool.schema.number().optional().describe("Max results to return (default: 5)"),
        },
        async execute(args, context) {
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

          const formatted = result.results
            .map(
              (r, i) =>
                `[${i + 1}] Scope: ${r.scope || "unknown"} | Topic: ${r.topic || "general"}\n    ${r.content || ""}`
            )
            .join("\n\n");

          return `Found ${result.results.length} results:\n\n${formatted}`;
        },
      }),

      ccr_store: tool({
        description:
          "Store important context in the CCR semantic store for future retrieval. " +
          "Use this to save architecture decisions, important patterns, or session learnings.",
        args: {
          scope: tool.schema.string().describe("Scope: session, project, or reference"),
          topic: tool.schema.string().describe("Topic or category for this context"),
          content: tool.schema.string().describe("The context content to store"),
        },
        async execute(args, context) {
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
      }),
    },
  };
};
