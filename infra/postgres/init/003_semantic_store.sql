CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Semantic documents table (used by SemanticStoreService)
CREATE TABLE IF NOT EXISTS semantic_documents (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('session', 'project', 'reference')),
  topic TEXT NOT NULL,
  depth TEXT NOT NULL DEFAULT 's1',
  trust TEXT NOT NULL DEFAULT 'raw',
  source TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_scope_topic ON semantic_documents(scope, topic);

-- Gateway sessions table
CREATE TABLE IF NOT EXISTS gateway_sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Gateway requests table
CREATE TABLE IF NOT EXISTS gateway_requests (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT REFERENCES gateway_sessions(id) ON DELETE SET NULL,
  scenario TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requests_session ON gateway_requests(session_id, created_at DESC);

-- Gateway config table
CREATE TABLE IF NOT EXISTS gateway_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
