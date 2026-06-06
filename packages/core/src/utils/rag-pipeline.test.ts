import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Helper: create a successful JSON response mock
function jsonOk(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as any as Response;
}

// Embedding vector mock
const MOCK_EMBEDDING = new Array(768).fill(0.1);

// Must import after global mock setup
describe('RAGPipeline', () => {
  let RAGPipeline: any;
  let mockFetch: any;

  beforeEach(async () => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Dynamic import to get fresh module each time
    vi.resetModules();
    const mod = await import('./rag-pipeline');
    RAGPipeline = mod.RAGPipeline;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

  function createPipeline(overrides = {}) {
    return new RAGPipeline({
      ollamaEndpoint: 'http://localhost:11434',
      ollamaModel: 'nomic-embed-text',
      qdrantUrl: 'http://localhost:16333',
      qdrantCollection: 'test_rag',
      embeddingDimension: 768,
      chunkSize: 500,
      chunkOverlap: 50,
      ...overrides,
    }, logger);
  }

  /** Mock: collection exists (green) */
  function mockCollectionExists() {
    mockFetch.mockResolvedValueOnce(jsonOk({ result: { status: 'green' } }));
  }

  /** Mock: successful embedding via /api/embed */
  function mockEmbedOk() {
    mockFetch.mockResolvedValueOnce(jsonOk({ embeddings: [MOCK_EMBEDDING] }));
  }

  /** Mock: /api/embed fails, /api/embeddings succeeds (legacy) */
  function mockEmbedFallback() {
    mockFetch.mockResolvedValueOnce(jsonOk({ error: 'not found' }, 404));
    mockFetch.mockResolvedValueOnce(jsonOk({ embedding: MOCK_EMBEDDING }));
  }

  /** Mock: both embedding endpoints fail */
  function mockEmbedFail() {
    mockFetch.mockResolvedValueOnce(jsonOk({ error: 'fail' }, 500));
    mockFetch.mockResolvedValueOnce(jsonOk({ error: 'fail' }, 500));
  }

  /** Mock: successful Qdrant upsert */
  function mockUpsertOk() {
    mockFetch.mockResolvedValueOnce(jsonOk({ result: true }));
  }

  describe('initialize', () => {
    it('should create collection with PUT if it does not exist', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonOk({ status: { error: 'Not found' } }, 404))
        .mockResolvedValueOnce(jsonOk({ result: true, status: 'ok' }));

      const pipeline = createPipeline();
      await pipeline.initialize();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call must be PUT to /collections/test_rag (not POST to /collections)
      const createCall = mockFetch.mock.calls[1];
      expect(createCall[0]).toBe('http://localhost:16333/collections/test_rag');
      expect(createCall[1].method).toBe('PUT');
      expect(pipeline.getStats().initialized).toBe(true);
    });

    it('should skip creation if collection exists', async () => {
      mockCollectionExists();
      const pipeline = createPipeline();
      await pipeline.initialize();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(pipeline.getStats().initialized).toBe(true);
    });
  });

  describe('ingestDocument', () => {
    it('should ingest a single-chunk document', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockUpsertOk();

      const pipeline = createPipeline();
      const ids = await pipeline.ingestDocument({
        content: '短文本',
        source: 'test/short',
        tags: ['test'],
      });

      expect(ids).toHaveLength(1);
      // Verify UUID format
      expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should return empty for empty content', async () => {
      mockCollectionExists();

      const pipeline = createPipeline();
      const ids = await pipeline.ingestDocument({
        content: '',
        source: 'test/empty',
        tags: [],
      });

      expect(ids).toEqual([]);
    });

    it('should return empty ids when embedding fails', async () => {
      mockCollectionExists();
      mockEmbedFail();

      const pipeline = createPipeline();
      const ids = await pipeline.ingestDocument({
        content: 'test fail',
        source: 'test/fail',
        tags: [],
      });

      expect(ids).toHaveLength(0);
    });

    it('should produce multiple chunks for long text', async () => {
      mockCollectionExists();
      // Long Chinese text that will split into multiple chunks
      const longText = '这是一段很长的测试文本。'.repeat(200); // ~4000 chars
      const chunkCount = Math.ceil(longText.length / 500);
      for (let i = 0; i < chunkCount; i++) {
        mockEmbedOk();
        mockUpsertOk();
      }

      const pipeline = createPipeline();
      const ids = await pipeline.ingestDocument({
        content: longText,
        source: 'test/long',
        tags: [],
      });

      expect(ids.length).toBeGreaterThan(1);
    });

    it('should generate deterministic IDs for same source', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockUpsertOk();

      const pipeline = createPipeline();
      const ids1 = await pipeline.ingestDocument({
        content: 'test content',
        source: 'deterministic/source',
        tags: [],
      });

      // Second ingest - same source
      mockEmbedOk();
      mockUpsertOk();
      const ids2 = await pipeline.ingestDocument({
        content: 'test content',
        source: 'deterministic/source',
        tags: [],
      });

      expect(ids1[0]).toBe(ids2[0]);
    });

    it('should use PUT with wait=true for upsert', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockUpsertOk();

      const pipeline = createPipeline();
      await pipeline.ingestDocument({ content: 'test', source: 'test/upsert', tags: [] });

      const upsertCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0]?.includes('/points?wait=true')
      );
      expect(upsertCall).toBeDefined();
      expect(upsertCall[1].method).toBe('PUT');

      const body = JSON.parse(upsertCall[1].body);
      expect(body.points[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    });
  });

  describe('getEmbedding', () => {
    it('should prefer /api/embed endpoint', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockUpsertOk();

      const pipeline = createPipeline();
      await pipeline.ingestDocument({ content: 'test', source: 'test/embed', tags: [] });

      const embedCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === 'http://localhost:11434/api/embed'
      );
      expect(embedCall).toBeDefined();
    });

    it('should fallback to /api/embeddings when /api/embed fails', async () => {
      mockCollectionExists();
      mockEmbedFallback();
      mockUpsertOk();

      const pipeline = createPipeline();
      const ids = await pipeline.ingestDocument({
        content: 'test fallback',
        source: 'test/fallback',
        tags: [],
      });

      const legacyCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0] === 'http://localhost:11434/api/embeddings'
      );
      expect(legacyCall).toBeDefined();
      expect(ids).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('should search Qdrant and return results', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockFetch.mockResolvedValueOnce(jsonOk({
        result: [{
          id: 'test-id',
          score: 0.85,
          payload: {
            content: 'test content for search',
            source: 'test/search',
            tags: ['test'],
            metadata: null,
            createdAt: Date.now(),
          },
        }],
      }));

      const pipeline = createPipeline();
      const results = await pipeline.query('test query');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.85);
      expect(results[0].document.source).toBe('test/search');
      expect(results[0].snippet).toBeTruthy();
    });

    it('should return empty when embedding fails', async () => {
      mockCollectionExists();
      mockEmbedFail();

      const pipeline = createPipeline();
      const results = await pipeline.query('test query');
      expect(results).toEqual([]);
    });
  });

  describe('enrichSystemPrompt', () => {
    it('should inject RAG context into string system prompt', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockFetch.mockResolvedValueOnce(jsonOk({
        result: [{
          id: 'test-id',
          score: 0.9,
          payload: {
            content: 'RAG context content for testing',
            source: 'test',
            tags: [],
            metadata: null,
            createdAt: Date.now(),
          },
        }],
      }));

      const pipeline = createPipeline();
      const { enriched, injections, totalChars } = await pipeline.enrichSystemPrompt(
        'You are a helpful assistant.',
        'test query'
      );

      expect(typeof enriched).toBe('string');
      expect(enriched).toContain('<rag_context>');
      expect(enriched).toContain('</rag_context>');
      expect(injections).toBe(1);
      expect(totalChars).toBeGreaterThan(0);
    });

    it('should inject into array system prompt', async () => {
      mockCollectionExists();
      mockEmbedOk();
      mockFetch.mockResolvedValueOnce(jsonOk({
        result: [{
          id: 'test-id',
          score: 0.8,
          payload: { content: 'RAG context', source: 'test', tags: [], metadata: null, createdAt: Date.now() },
        }],
      }));

      const pipeline = createPipeline();
      const prompt = [{ type: 'text', text: 'System prompt' }];
      const { enriched, injections } = await pipeline.enrichSystemPrompt(prompt, 'test');

      expect(Array.isArray(enriched)).toBe(true);
      expect(enriched).toHaveLength(2);
      expect(injections).toBe(1);
    });

    it('should return unchanged prompt when no results', async () => {
      mockCollectionExists();
      mockEmbedFail();

      const pipeline = createPipeline();
      const { enriched, injections } = await pipeline.enrichSystemPrompt('test', 'query');
      expect(enriched).toBe('test');
      expect(injections).toBe(0);
    });
  });

  describe('deleteBySource', () => {
    it('should send delete request with source filter', async () => {
      mockCollectionExists();
      const pipeline = createPipeline();
      await pipeline.initialize();

      mockFetch.mockResolvedValueOnce(jsonOk({ result: true }));
      const count = await pipeline.deleteBySource('test/source');

      expect(count).toBe(1);
      const deleteCall = mockFetch.mock.calls.find(
        (c: any[]) => c[0]?.includes('/points/delete')
      );
      expect(deleteCall).toBeDefined();
      const body = JSON.parse(deleteCall[1].body);
      expect(body.filter.must[0].key).toBe('source');
      expect(body.filter.must[0].match.value).toBe('test/source');
    });
  });

  describe('getStats', () => {
    it('should report stats before initialization', () => {
      const pipeline = createPipeline();
      const stats = pipeline.getStats();
      expect(stats.initialized).toBe(false);
      expect(stats.collection).toBe('test_rag');
      expect(stats.ollamaModel).toBe('nomic-embed-text');
    });

    it('should report stats after initialization', async () => {
      mockCollectionExists();
      const pipeline = createPipeline();
      await pipeline.initialize();
      const stats = pipeline.getStats();
      expect(stats.initialized).toBe(true);
    });
  });
});
