const CCR_BASE = process.env.CCR_BASE_URL || "http://localhost:4096";

async function ccrSemanticSearch(query, scope, limit, threshold) {
  try {
    const r = await fetch(`${CCR_BASE}/api/semantic/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, scope: scope || "project", limit: limit || 5, threshold: threshold || 0.5 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { error: `CCR returned ${r.status}`, results: [] };
    return await r.json();
  } catch (e) {
    return { error: e.message || "CCR unavailable", results: [] };
  }
}

module.exports = {
  name: "ccr_search",
  description: "Search CCR semantic store for project context. Queries the local CCR proxy's vector store for relevant documents, code patterns, or architectural notes.",
  args: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text" },
      scope: { type: "string", description: "Search scope: project, session, or global", default: "project" },
      limit: { type: "number", description: "Max results to return", default: 5 },
      threshold: { type: "number", description: "Similarity threshold (0-1)", default: 0.5 },
    },
    required: ["query"],
  },
  async execute(args) {
    const result = await ccrSemanticSearch(args.query, args.scope, args.limit, args.threshold);
    if (result.error) {
      return `CCR search failed: ${result.error}. Is the CCR proxy running at ${CCR_BASE}?`;
    }
    if (!result.results || result.results.length === 0) {
      return "No results found in CCR semantic store.";
    }
    return result.results
      .map((r, i) => {
        const score = r.score ? ` (score: ${r.score.toFixed(3)})` : "";
        return `[${i + 1}] ${r.source || "unknown"}${score}\n${(r.content || "").substring(0, 800)}`;
      })
      .join("\n\n");
  },
};
