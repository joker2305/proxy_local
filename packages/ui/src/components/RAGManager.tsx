import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { Database, Upload, Search, RefreshCw, FileText, Activity } from "lucide-react";

interface RAGStatus {
  available: boolean;
  embedding_service: string;
  vector_store: string;
  collections: number;
  total_documents: number;
}

interface SearchResult {
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export function RAGManager() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RAGStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingestText, setIngestText] = useState('');
  const [ingestCollection, setIngestCollection] = useState('default');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const data = await api.get<any>('/rag/status');
      setStatus(data);
    } catch {
      setStatus({ available: false, embedding_service: 'unavailable', vector_store: 'unavailable', collections: 0, total_documents: 0 });
    }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const handleIngest = async () => {
    if (!ingestText.trim()) return;
    setIngesting(true);
    setMessage(null);
    try {
      await api.post('/rag/ingest', { content: ingestText, collection: ingestCollection });
      setMessage({ text: `Ingested ${ingestText.length} chars to "${ingestCollection}"`, type: 'success' });
      setIngestText('');
      loadStatus();
    } catch (e: any) {
      setMessage({ text: `Ingest failed: ${e.message}`, type: 'error' });
    }
    setIngesting(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setMessage(null);
    try {
      const results = await api.post<SearchResult[]>('/rag/query', { query: searchQuery, limit: 5 });
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (e: any) {
      setMessage({ text: `Search failed: ${e.message}`, type: 'error' });
      setSearchResults([]);
    }
    setSearching(false);
  };

  return (
    <Card className="rounded-lg border shadow-sm">
      <CardHeader className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            <CardTitle className="text-lg">{t("rag.title", "RAG Manager")}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <Badge variant={status.available ? "default" : "destructive"} className="text-xs">
                {status.available ? 'Available' : 'Unavailable'}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={loadStatus}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {loading ? (
          <div className="text-muted-foreground text-sm">Loading RAG status...</div>
        ) : status ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Embedding</div>
                <div className="text-sm font-medium mt-1">{status.embedding_service}</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Vector Store</div>
                <div className="text-sm font-medium mt-1">{status.vector_store}</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Collections</div>
                <div className="text-lg font-bold mt-1">{status.collections}</div>
              </div>
              <div className="border rounded-lg p-3 text-center">
                <div className="text-xs text-muted-foreground">Documents</div>
                <div className="text-lg font-bold mt-1">{status.total_documents}</div>
              </div>
            </div>

            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Ingest Document</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={ingestCollection}
                  onChange={(e) => setIngestCollection(e.target.value)}
                  placeholder="Collection name"
                  className="w-40"
                />
                <div className="flex-1">
                  <Textarea
                    value={ingestText}
                    onChange={(e) => setIngestText(e.target.value)}
                    placeholder="Paste document content to ingest into vector store..."
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </div>
              <Button size="sm" onClick={handleIngest} disabled={ingesting || !ingestText.trim()}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                {ingesting ? 'Ingesting...' : 'Ingest'}
              </Button>
            </div>

            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Semantic Search</span>
              </div>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search documents by semantic similarity..."
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button size="sm" onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                  <Search className="h-3.5 w-3.5 mr-1" />
                  {searching ? 'Searching...' : 'Search'}
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2 mt-2">
                  {searchResults.map((result, i) => (
                    <div key={i} className="border rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary" className="text-xs">
                          Score: {(result.score * 100).toFixed(1)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-3">{result.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {message && (
              <div className={`text-xs p-2 rounded ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {message.text}
              </div>
            )}

            {!status.available && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">
                  RAG requires Ollama (nomic-embed-text) and Qdrant running.
                  Start Docker containers: Redis (16379), Qdrant (16333).
                  The proxy will gracefully degrade without them.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground text-sm">Failed to load RAG status</div>
        )}
      </CardContent>
    </Card>
  );
}
