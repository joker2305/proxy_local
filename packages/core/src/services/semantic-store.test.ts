import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg module
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('SemanticStoreService', () => {
  let SemanticStoreService: any;
  let mockConfigService: any;
  let logger: any;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./semantic-store');
    SemanticStoreService = mod.SemanticStoreService;

    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockConfigService = {
      get: vi.fn().mockReturnValue({
        postgresUrl: 'postgresql://test:test@localhost:5432/test',
        semanticStore: {
          enabled: true,
          embeddingModel: 'nomic-embed-text',
          embeddingEndpoint: 'http://localhost:11434/api/embed',
          dimension: 768,
        },
      }),
    };
  });

  describe('constructor', () => {
    it('should load config from configService', () => {
      const service = new SemanticStoreService(mockConfigService, logger);
      expect(mockConfigService.get).toHaveBeenCalledWith('Storage');
    });

    it('should work without Storage config', () => {
      mockConfigService.get.mockReturnValue(null);
      const service = new SemanticStoreService(mockConfigService, logger);
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('upsert', () => {
    it('should return null when not connected and connection fails', async () => {
      mockConfigService.get.mockReturnValue(null);
      const service = new SemanticStoreService(mockConfigService, logger);
      const result = await service.upsert({
        scope: 'reference',
        topic: 'test',
        content: 'test content',
      });
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('should return empty array when not connected', async () => {
      mockConfigService.get.mockReturnValue(null);
      const service = new SemanticStoreService(mockConfigService, logger);
      const results = await service.search('test');
      expect(results).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should return 0 when not connected', async () => {
      mockConfigService.get.mockReturnValue(null);
      const service = new SemanticStoreService(mockConfigService, logger);
      const count = await service.delete('session', 'test');
      expect(count).toBe(0);
    });
  });

  describe('healthCheck', () => {
    it('should return disconnected when no config', async () => {
      mockConfigService.get.mockReturnValue(null);
      const service = new SemanticStoreService(mockConfigService, logger);
      const health = await service.healthCheck();
      expect(health.connected).toBe(false);
    });
  });

  describe('generateEmbedding response parsing', () => {
    it('should parse Ollama /api/embed format { embeddings: [[...]] }', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          embeddings: [new Array(768).fill(0.1)],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      // Create service and connect to trigger embedding generation
      const { Pool } = await import('pg');
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // SELECT 1
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }), // INSERT RETURNING
        end: vi.fn(),
      };
      Pool.mockImplementation(() => mockPool);

      const service = new SemanticStoreService(mockConfigService, logger);
      await service.connect();

      const result = await service.upsert({
        scope: 'reference',
        topic: 'test',
        content: 'test content',
      });

      expect(result).toEqual({ id: 1 });
      // Verify the embedding was passed to the INSERT
      const insertCall = mockPool.query.mock.calls[1];
      expect(insertCall[1][6]).not.toBeNull(); // embedding column
    });

    it('should parse Ollama legacy format { embedding: [...] }', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          embedding: new Array(768).fill(0.2),
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Pool } = await import('pg');
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: 2 }] }),
        end: vi.fn(),
      };
      Pool.mockImplementation(() => mockPool);

      const service = new SemanticStoreService(mockConfigService, logger);
      await service.connect();

      const result = await service.upsert({
        scope: 'reference',
        topic: 'test',
        content: 'test',
      });

      expect(result).toEqual({ id: 2 });
    });

    it('should parse OpenAI format { data: [{ embedding: [...] }] }', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{ embedding: new Array(768).fill(0.3) }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Pool } = await import('pg');
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: 3 }] }),
        end: vi.fn(),
      };
      Pool.mockImplementation(() => mockPool);

      const service = new SemanticStoreService(mockConfigService, logger);
      await service.connect();

      const result = await service.upsert({
        scope: 'reference',
        topic: 'test',
        content: 'test',
      });

      expect(result).toEqual({ id: 3 });
    });

    it('should handle unknown embedding format gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unknown: true }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { Pool } = await import('pg');
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: 4 }] }),
        end: vi.fn(),
      };
      Pool.mockImplementation(() => mockPool);

      const service = new SemanticStoreService(mockConfigService, logger);
      await service.connect();

      const result = await service.upsert({
        scope: 'reference',
        topic: 'test',
        content: 'test',
      });

      // Should still insert, just without embedding
      expect(result).toEqual({ id: 4 });
      const insertCall = mockPool.query.mock.calls[1];
      expect(insertCall[1][6]).toBeNull(); // embedding should be null
    });
  });
});
