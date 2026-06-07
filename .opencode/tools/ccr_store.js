const CCR_BASE = process.env.CCR_BASE_URL || "http://localhost:4096";

async function ccrSemanticStore(content, scope, topic, source) {
  try {
    const r = await fetch(`${CCR_BASE}/api/semantic/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, scope: scope || "project", topic, source: source || "opencode" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { error: `CCR returned ${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: e.message || "CCR unavailable" };
  }
}

module.exports = {
  name: "ccr_store",
  description: "Store context in CCR semantic store for future retrieval. Saves architectural decisions, code patterns, or project knowledge to the local CCR proxy's vector store.",
  args: {
    type: "object",
    properties: {
      content: { type: "string", description: "Content to store" },
      scope: { type: "string", description: "Storage scope: project, session, or global", default: "project" },
      topic: { type: "string", description: "Topic/category for the stored content" },
      source: { type: "string", description: "Source identifier", default: "opencode" },
    },
    required: ["content", "topic"],
  },
  async execute(args) {
    const result = await ccrSemanticStore(args.content, args.scope, args.topic, args.source);
    if (result.error) {
      return `CCR store failed: ${result.error}. Is the CCR proxy running at ${CCR_BASE}?`;
    }
    return `Stored successfully in CCR semantic store (scope: ${args.scope || "project"}, topic: ${args.topic})`;
  },
};
