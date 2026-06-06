import { createHash } from 'crypto';

export interface RAGDocument {
  id: string;
  content: string;
  source: string;
  tags: string[];
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface RAGQueryResult {
  document: RAGDocument;
  score: number;
  snippet: string;
}

export interface RAGPipelineConfig {
  ollamaEndpoint: string;
  ollamaModel: string;
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingDimension: number;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  minScore: number;
}

const DEFAULT_CONFIG: RAGPipelineConfig = {
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'nomic-embed-text',
  qdrantUrl: 'http://127.0.0.1:16333',
  qdrantCollection: 'ccr_rag',
  embeddingDimension: 768,
  chunkSize: 500,
  chunkOverlap: 50,
  topK: 5,
  minScore: 0.5,
};

export class RAGPipeline {
  private config: RAGPipelineConfig;
  private logger?: any;
  private initialized = false;

  constructor(config: Partial<RAGPipelineConfig> = {}, logger?: any) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.ensureCollection();
      this.initialized = true;
      this.logger?.info(`RAGPipeline: initialized (ollama=${this.config.ollamaModel}, qdrant=${this.config.qdrantCollection})`);
    } catch (e: any) {
      this.logger?.warn(`RAGPipeline: initialization partial — ${e.message}`);
    }
  }

  async ingestDocument(doc: Omit<RAGDocument, 'id' | 'createdAt'>): Promise<string[]> {
    if (!this.initialized) await this.initialize();

    const chunks = this.chunkText(doc.content);
    const ids: string[] = [];

    if (chunks.length === 0) {
      this.logger?.warn(`RAGPipeline: no chunks produced from ${doc.source} (${doc.content.length} chars)`);
      return ids;
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const id = this.generateDocId(doc.source, i);

      const embedding = await this.getEmbedding(chunk);
      if (embedding.length === 0) {
        this.logger?.warn(`RAGPipeline: embedding failed for chunk ${i} of ${doc.source}, skipping`);
        continue;
      }

      const ok = await this.upsertPoint(id, embedding, {
        content: chunk,
        source: doc.source,
        tags: doc.tags,
        metadata: doc.metadata,
        chunkIndex: i,
        totalChunks: chunks.length,
        createdAt: Date.now(),
      });

      if (ok) {
        ids.push(id);
      } else {
        this.logger?.warn(`RAGPipeline: upsert failed for chunk ${i} of ${doc.source}`);
      }
    }

    this.logger?.info(`RAGPipeline: ingested ${ids.length}/${chunks.length} chunks from ${doc.source}`);
    return ids;
  }

  async query(queryText: string, filter?: { tags?: string[]; source?: string }): Promise<RAGQueryResult[]> {
    if (!this.initialized) await this.initialize();

    const embedding = await this.getEmbedding(queryText);
    if (embedding.length === 0) {
      this.logger?.warn('RAGPipeline: query embedding failed, returning empty results');
      return [];
    }

    try {
      const must: any[] = [];
      if (filter?.tags && filter.tags.length > 0) {
        must.push({
          should: filter.tags.map(tag => ({
            key: 'tags',
            match: { value: tag },
          })),
        });
      }
      if (filter?.source) {
        must.push({
          key: 'source',
          match: { value: filter.source },
        });
      }

      const response = await fetch(
        `${this.config.qdrantUrl}/collections/${this.config.qdrantCollection}/points/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vector: embedding,
            limit: this.config.topK,
            score_threshold: this.config.minScore,
            with_payload: true,
            filter: must.length > 0 ? { must } : undefined,
          }),
        }
      );

      if (!response.ok) {
        this.logger?.warn(`RAGPipeline query: Qdrant returned ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (!data.result) return [];

      return data.result.map((point: any) => ({
        document: {
          id: point.id,
          content: point.payload.content,
          source: point.payload.source,
          tags: point.payload.tags || [],
          metadata: point.payload.metadata,
          createdAt: point.payload.createdAt,
        },
        score: point.score,
        snippet: point.payload.content.substring(0, 200),
      }));
    } catch (e: any) {
      this.logger?.warn(`RAGPipeline query failed: ${e.message}`);
      return [];
    }
  }

  async enrichSystemPrompt(
    systemPrompt: any,
    queryText: string,
    maxTokens: number = 2000
  ): Promise<{ enriched: any; injections: number; totalChars: number }> {
    const results = await this.query(queryText);
    if (results.length === 0) {
      return { enriched: systemPrompt, injections: 0, totalChars: 0 };
    }

    let totalChars = 0;
    const injectionLines: string[] = ['\n<rag_context>'];

    for (const result of results) {
      const entry = `[${result.score.toFixed(2)}] ${result.snippet}`;
      if (totalChars + entry.length > maxTokens * 4) break;
      injectionLines.push(entry);
      totalChars += entry.length;
    }

    injectionLines.push('</rag_context>');
    const injection = injectionLines.join('\n');

    if (typeof systemPrompt === 'string') {
      return { enriched: systemPrompt + injection, injections: results.length, totalChars };
    }

    if (Array.isArray(systemPrompt)) {
      return {
        enriched: [...systemPrompt, { type: 'text', text: injection }],
        injections: results.length,
        totalChars,
      };
    }

    return { enriched: systemPrompt, injections: 0, totalChars: 0 };
  }

  async deleteBySource(source: string): Promise<number> {
    try {
      const response = await fetch(
        `${this.config.qdrantUrl}/collections/${this.config.qdrantCollection}/points/delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter: {
              must: [{ key: 'source', match: { value: source } }],
            },
          }),
        }
      );
      if (!response.ok) return 0;
      return 1;
    } catch {
      return 0;
    }
  }

  getStats(): { initialized: boolean; collection: string; ollamaModel: string } {
    return {
      initialized: this.initialized,
      collection: this.config.qdrantCollection,
      ollamaModel: this.config.ollamaModel,
    };
  }

  /**
   * Character-based chunking that works for both Chinese and English text.
   * Splits by paragraph boundaries first, then by character count.
   */
  private chunkText(text: string): string[] {
    if (!text || text.trim().length === 0) return [];

    const chunks: string[] = [];
    // Split by paragraph boundaries (double newline or double CRLF)
    const paragraphs = text.split(/\n{2,}|\r\n{2,}/);

    let current = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (current.length + trimmed.length + 2 <= this.config.chunkSize) {
        current += (current ? '\n\n' : '') + trimmed;
      } else {
        // Flush current chunk
        if (current) chunks.push(current);

        // If single paragraph exceeds chunk size, split by character count
        if (trimmed.length > this.config.chunkSize) {
          let offset = 0;
          while (offset < trimmed.length) {
            const end = Math.min(offset + this.config.chunkSize, trimmed.length);
            chunks.push(trimmed.substring(offset, end));
            // Move forward, applying overlap
            const step = Math.max(this.config.chunkSize - this.config.chunkOverlap, 1);
            offset += step;
          }
          current = '';
        } else {
          current = trimmed;
        }
      }
    }

    if (current.trim()) chunks.push(current);

    return chunks;
  }

  /**
   * Get embedding vector from Ollama. Tries /api/embed first (newer),
   * falls back to /api/embeddings (legacy).
   */
  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const truncated = text.substring(0, 8000);

      // Try newer /api/embed endpoint first
      let response = await fetch(`${this.config.ollamaEndpoint}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.ollamaModel, input: truncated }),
      });

      if (response.ok) {
        const data = await response.json();
        const embedding = data.embeddings?.[0] || [];
        if (embedding.length > 0) return embedding;
      }

      // Fallback to legacy /api/embeddings endpoint
      response = await fetch(`${this.config.ollamaEndpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.ollamaModel, prompt: truncated }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.embedding && data.embedding.length > 0) return data.embedding;
      }

      this.logger?.warn(`RAGPipeline getEmbedding: Ollama returned no embedding (status: ${response.status})`);
      return [];
    } catch (e: any) {
      this.logger?.warn(`RAGPipeline getEmbedding failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Ensure Qdrant collection exists. Creates with correct PUT endpoint.
   */
  private async ensureCollection(): Promise<void> {
    try {
      const response = await fetch(
        `${this.config.qdrantUrl}/collections/${this.config.qdrantCollection}`
      );
      if (response.ok) return;

      // Create collection using PUT with collection name in URL path
      const createResponse = await fetch(
        `${this.config.qdrantUrl}/collections/${this.config.qdrantCollection}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vectors: { size: this.config.embeddingDimension, distance: 'Cosine' },
          }),
        }
      );

      if (createResponse.ok) {
        this.logger?.info(`RAGPipeline: created Qdrant collection '${this.config.qdrantCollection}'`);
      } else {
        const body = await createResponse.text();
        this.logger?.warn(`RAGPipeline: failed to create collection: ${createResponse.status} ${body}`);
      }
    } catch (e: any) {
      this.logger?.warn(`RAGPipeline ensureCollection failed: ${e.message}`);
    }
  }

  /**
   * Upsert a point into Qdrant with deterministic UUID ID.
   * Qdrant requires integer or UUID-format string IDs.
   */
  private async upsertPoint(id: string, vector: number[], payload: Record<string, any>): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.config.qdrantUrl}/collections/${this.config.qdrantCollection}/points?wait=true`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            points: [{ id, vector, payload }],
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        this.logger?.warn(`RAGPipeline upsertPoint failed: ${response.status} ${body}`);
      }
      return response.ok;
    } catch (e: any) {
      this.logger?.warn(`RAGPipeline upsertPoint error: ${e.message}`);
      return false;
    }
  }

  /**
   * Generate a deterministic UUID v4 from source+chunkIndex.
   * Qdrant requires either uint64 or UUID-format string IDs.
   */
  private generateDocId(source: string, chunkIndex: number): string {
    const hash = createHash('sha256')
      .update(`${source}:${chunkIndex}`)
      .digest('hex');
    // Format as UUID v4 (xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
    return [
      hash.substring(0, 8),
      hash.substring(8, 12),
      '4' + hash.substring(13, 16),
      ((parseInt(hash.substring(16, 18), 16) & 0x3) | 0x8).toString(16) + hash.substring(17, 20),
      hash.substring(20, 32),
    ].join('-');
  }
}

let _pipeline: RAGPipeline | null = null;

export function getRAGPipeline(config?: Partial<RAGPipelineConfig>, logger?: any): RAGPipeline {
  if (!_pipeline) {
    _pipeline = new RAGPipeline(config, logger);
  }
  return _pipeline;
}
