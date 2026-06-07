import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  let mockEmbedService: any;

  beforeEach(async () => {
    vi.resetModules();

    mockEmbedService = {
      isAvailable: vi.fn().mockReturnValue(true),
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
    };

    vi.doMock('../utils/embedding', () => ({
      getEmbeddingService: vi.fn().mockReturnValue(mockEmbedService),
      EmbeddingService: {
        cosineSimilarity: vi.fn().mockReturnValue(0.95),
      },
    }));

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

  describe('embedding integration', () => {
    it('should use unified EmbeddingService for embeddings', async () => {
      const { Pool } = await import('pg');
      const mockPool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }),
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
      expect(mockEmbedService.embed).toHaveBeenCalledWith('test content');
      const insertCall = mockPool.query.mock.calls[1];
      expect(insertCall[1][6]).not.toBeNull();
    });

    it('should handle embedding unavailable gracefully', async () => {
      mockEmbedService.isAvailable.mockReturnValue(false);
      mockEmbedService.embed.mockResolvedValue(null);

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

      expect(result).toEqual({ id: 4 });
      const insertCall = mockPool.query.mock.calls[1];
      expect(insertCall[1][6]).toBeNull();
    });
  });
});
