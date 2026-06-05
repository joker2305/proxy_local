import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "./ui/combobox";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plus, Trash2, GripVertical } from "lucide-react";
import { useConfig } from "./ConfigProvider";

const CLAUDE_MODELS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-opus-4-5-20250514', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251213', label: 'Claude Haiku 4.5' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
];

interface MappingEntry {
  claudeModel: string;
  targetProvider: string;
  targetModel: string;
  fallbacks: string[];
}

export function ModelMapping() {
  const { t } = useTranslation();
  const { config, setConfig } = useConfig();

  if (!config) {
    return (
      <Card className="rounded-lg border shadow-sm">
        <CardHeader className="border-b p-4">
          <CardTitle className="text-lg">{t("modelMapping.title", "Model Mapping")}</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-gray-500">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const providers = Array.isArray(config.Providers) ? config.Providers : [];
  const modelOptions = providers.flatMap((p: any) => {
    if (!p?.name || !Array.isArray(p.models)) return [];
    return p.models.map((m: string) => ({
      value: `${p.name},${m}`,
      label: `${p.name} / ${m}`,
    }));
  });

  const mapping = config.ModelMapping || {};
  const fallback = config.fallback || {};

  const entries: MappingEntry[] = CLAUDE_MODELS.map(cm => {
    const target = mapping[cm.value] || '';
    const fb = (fallback as any)[cm.value] || [];
    return {
      claudeModel: cm.value,
      targetProvider: target.split(',')[0] || '',
      targetModel: target.split(',')[1] || '',
      fallbacks: Array.isArray(fb) ? fb : [],
    };
  });

  const handleMappingChange = (claudeModel: string, value: string) => {
    const newMapping = { ...mapping, [claudeModel]: value };
    setConfig({ ...config, ModelMapping: newMapping });
  };

  const handleFallbackAdd = (claudeModel: string, fallbackValue: string) => {
    const current = ((fallback as any)[claudeModel] || []) as string[];
    const newFallback = { ...fallback, [claudeModel]: [...current, fallbackValue] };
    setConfig({ ...config, fallback: newFallback });
  };

  const handleFallbackRemove = (claudeModel: string, index: number) => {
    const current = [...((fallback as any)[claudeModel] || [])] as string[];
    current.splice(index, 1);
    const newFallback = { ...fallback, [claudeModel]: current };
    setConfig({ ...config, fallback: newFallback });
  };

  const [addingFallbackFor, setAddingFallbackFor] = useState<string | null>(null);
  const [newFallbackValue, setNewFallbackValue] = useState('');

  return (
    <Card className="rounded-lg border shadow-sm">
      <CardHeader className="border-b p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{t("modelMapping.title", "Model Mapping")}</CardTitle>
          <Badge variant="secondary">{entries.length} models</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {entries.map(entry => {
          const cm = CLAUDE_MODELS.find(m => m.value === entry.claudeModel)!;
          return (
            <div key={entry.claudeModel} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-44 shrink-0">
                  <Badge variant="outline" className="font-mono text-xs">
                    {cm.label}
                  </Badge>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <Combobox
                    options={modelOptions}
                    value={mapping[entry.claudeModel] || ''}
                    onChange={(v) => handleMappingChange(entry.claudeModel, v)}
                    placeholder={t("modelMapping.selectTarget", "Select target model")}
                    searchPlaceholder={t("modelMapping.search", "Search models...")}
                    emptyPlaceholder={t("modelMapping.noModel", "No model found")}
                  />
                </div>
              </div>

              {entry.fallbacks.length > 0 && (
                <div className="ml-48 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Fallback:</span>
                  {entry.fallbacks.map((fb, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Badge variant="secondary" className="text-xs font-mono">{fb}</Badge>
                      <button onClick={() => handleFallbackRemove(entry.claudeModel, i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                      {i < entry.fallbacks.length - 1 && <span className="text-xs text-muted-foreground">→</span>}
                    </div>
                  ))}
                </div>
              )}

              {addingFallbackFor === entry.claudeModel ? (
                <div className="ml-48 flex items-center gap-2">
                  <Combobox
                    options={modelOptions}
                    value={newFallbackValue}
                    onChange={(v) => {
                      handleFallbackAdd(entry.claudeModel, v);
                      setAddingFallbackFor(null);
                      setNewFallbackValue('');
                    }}
                    placeholder="Add fallback model"
                    searchPlaceholder="Search..."
                    emptyPlaceholder="No model"
                  />
                  <Button variant="ghost" size="sm" onClick={() => { setAddingFallbackFor(null); setNewFallbackValue(''); }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="ml-48">
                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => setAddingFallbackFor(entry.claudeModel)}>
                    <Plus className="h-3 w-3 mr-1" /> Add fallback
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
