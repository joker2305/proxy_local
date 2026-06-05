import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "./ui/combobox";
import { ArrowRight, Plus, Trash2, Zap, Brain, Sparkles, Cpu } from "lucide-react";
import { useConfig } from "./ConfigProvider";

interface StrategyEntry {
  name: string;
  description: string;
  provider: string;
  model: string;
  thinking: { type?: string; reasoning_effort?: string; clear_thinking?: boolean };
  bestFor: string[];
  tierRange: string[];
  priority: number;
}

const BUILTIN_STRATEGIES: StrategyEntry[] = [
  {
    name: 'glm_coding_plan',
    description: 'GLM-5.1 coding plan — keeps reasoning context across turns',
    provider: 'glm', model: 'glm-5.1',
    thinking: { type: 'enabled', clear_thinking: false },
    bestFor: ['coding', 'agentic'], tierRange: ['COMPLEX', 'REASONING'], priority: 90,
  },
  {
    name: 'deepseek_pro_max',
    description: 'DeepSeek V4 Pro max reasoning — strongest single-pass reasoning',
    provider: 'deepseek', model: 'deepseek-v4-pro',
    thinking: { type: 'enabled', reasoning_effort: 'max' },
    bestFor: ['reasoning', 'data'], tierRange: ['REASONING'], priority: 95,
  },
  {
    name: 'deepseek_pro_standard',
    description: 'DeepSeek V4 Pro standard — balanced reasoning',
    provider: 'deepseek', model: 'deepseek-v4-pro',
    thinking: { type: 'enabled', reasoning_effort: 'medium' },
    bestFor: ['coding', 'reasoning', 'general'], tierRange: ['COMPLEX', 'REASONING'], priority: 80,
  },
  {
    name: 'deepseek_flash_thinking',
    description: 'DeepSeek V4 Flash with thinking — fast reasoning',
    provider: 'deepseek', model: 'deepseek-v4-flash',
    thinking: { type: 'enabled', reasoning_effort: 'low' },
    bestFor: ['general', 'data', 'coding'], tierRange: ['MEDIUM', 'COMPLEX'], priority: 60,
  },
  {
    name: 'deepseek_flash_fast',
    description: 'DeepSeek V4 Flash — fast responses for simple tasks',
    provider: 'deepseek', model: 'deepseek-v4-flash',
    thinking: {}, bestFor: ['simple_chat', 'general', 'translation'],
    tierRange: ['SIMPLE', 'MEDIUM'], priority: 50,
  },
  {
    name: 'glm_standard',
    description: 'GLM-5.1 standard — balanced coding and general',
    provider: 'glm', model: 'glm-5.1',
    thinking: { type: 'enabled', clear_thinking: true },
    bestFor: ['coding', 'general', 'creative'], tierRange: ['MEDIUM', 'COMPLEX'], priority: 70,
  },
];

const TIER_COLORS: Record<string, string> = {
  SIMPLE: 'bg-green-100 text-green-800',
  MEDIUM: 'bg-blue-100 text-blue-800',
  COMPLEX: 'bg-orange-100 text-orange-800',
  REASONING: 'bg-purple-100 text-purple-800',
};

const CATEGORY_ICONS: Record<string, any> = {
  coding: Zap,
  reasoning: Brain,
  agentic: Cpu,
  creative: Sparkles,
};

export function ThinkingStrategy() {
  const { t } = useTranslation();
  const { config } = useConfig();
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);

  const providers = Array.isArray(config?.Providers) ? config.Providers : [];
  const availableProviders = new Set(
    providers.filter((p: any) => p.api_key?.length > 0).map((p: any) => p.name.toLowerCase())
  );

  return (
    <Card className="rounded-lg border shadow-sm">
      <CardHeader className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{t("thinkingStrategy.title", "Thinking Strategies")}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t("thinkingStrategy.subtitle", "Configure how different models handle reasoning tasks based on difficulty")}
            </p>
          </div>
          <Badge variant="secondary">{BUILTIN_STRATEGIES.length} strategies</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {BUILTIN_STRATEGIES.map(strategy => {
          const isAvailable = availableProviders.has(strategy.provider.toLowerCase());
          const isExpanded = expandedStrategy === strategy.name;

          return (
            <div
              key={strategy.name}
              className={`border rounded-lg p-3 transition-colors ${isAvailable ? 'bg-card' : 'bg-muted/30 opacity-60'}`}
            >
              <button
                className="w-full flex items-center gap-3 text-left"
                onClick={() => setExpandedStrategy(isExpanded ? null : strategy.name)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{strategy.name}</span>
                    {!isAvailable && (
                      <Badge variant="destructive" className="text-xs">No API Key</Badge>
                    )}
                    {isAvailable && (
                      <Badge variant="default" className="text-xs bg-green-600">Active</Badge>
                    )}
                    <Badge variant="outline" className="text-xs font-mono">
                      {strategy.provider},{strategy.model}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{strategy.description}</p>
                </div>
                <div className="flex items-center gap-1">
                  {strategy.tierRange.map(tier => (
                    <span key={tier} className={`px-1.5 py-0.5 rounded text-xs font-medium ${TIER_COLORS[tier] || 'bg-gray-100'}`}>
                      {tier}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {strategy.bestFor.map(cat => {
                    const Icon = CATEGORY_ICONS[cat];
                    return Icon ? <Icon key={cat} className="h-3.5 w-3.5 text-muted-foreground" /> : null;
                  })}
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Thinking</span>
                      <div className="font-mono mt-1">
                        {strategy.thinking.type ? (
                          <Badge variant="secondary" className="text-xs">
                            {strategy.thinking.type}
                            {strategy.thinking.reasoning_effort && ` (${strategy.thinking.reasoning_effort})`}
                            {strategy.thinking.clear_thinking !== undefined && ` (clear: ${String(strategy.thinking.clear_thinking)})`}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Priority</span>
                      <div className="mt-1 font-mono">{strategy.priority}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Categories</span>
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {strategy.bestFor.map(cat => (
                          <Badge key={cat} variant="outline" className="text-xs">{cat}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <div className="border-t pt-3 mt-3">
          <p className="text-xs text-muted-foreground">
            Strategy selection logic: Task difficulty is classified using a 14-dimension weighted scoring system.
            REASONING + coding → GLM coding plan | REASONING + reasoning/data → DeepSeek Pro Max |
            COMPLEX → DeepSeek Pro Standard | MEDIUM → DeepSeek Flash Thinking | SIMPLE → DeepSeek Flash Fast.
            Override per-tier in config.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
