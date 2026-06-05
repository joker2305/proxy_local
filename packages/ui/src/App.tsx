import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Providers } from "@/components/Providers";
import { Router } from "@/components/Router";
import { Transformers } from "@/components/Transformers";
import { ModelMapping } from "@/components/ModelMapping";
import { ThinkingStrategy } from "@/components/ThinkingStrategy";
import { ViewTabs, type ViewName } from "@/components/ViewTabs";
import { Dashboard } from "@/components/Dashboard";
import { CacheManager } from "@/components/CacheManager";
import { BudgetTracker } from "@/components/BudgetTracker";
import { Pipeline } from "@/components/Pipeline";
import { ProviderMonitor } from "@/components/ProviderMonitor";
import { DebugPage } from "@/components/DebugPage";
import { Presets } from "@/components/Presets";
import { JsonEditor } from "@/components/JsonEditor";
import { LogViewer } from "@/components/LogViewer";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/components/ConfigProvider";
import { api } from "@/lib/api";
import { Save, RefreshCw, FileJson, FileText, Settings, Languages, Bug, Package } from "lucide-react";
import { Toast } from "@/components/ui/toast";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

function App() {
  const { t, i18n } = useTranslation();
  const { config, setConfig, error } = useConfig();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isJsonEditorOpen, setIsJsonEditorOpen] = useState(false);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [activeView, setActiveView] = useState<ViewName>('providers');
  const hasCheckedOnce = useRef(false);

  const checkServerStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/health', { headers: { 'X-API-Key': localStorage.getItem('apiKey') || '' } });
      setServerStatus(resp.ok ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    }
  }, []);

  useEffect(() => {
    if (!hasCheckedOnce.current) {
      hasCheckedOnce.current = true;
      checkServerStatus();
    }
    const interval = setInterval(checkServerStatus, 30000);
    return () => clearInterval(interval);
  }, [checkServerStatus]);

  const saveConfig = async () => {
    if (!config) return;
    try {
      await api.updateConfig(config);
      setToast({ message: t('app.config_saved_success'), type: 'success' });
    } catch (err) {
      setToast({ message: `${t('app.config_saved_failed')}: ${(err as Error).message}`, type: 'error' });
    }
  };

  const saveConfigAndRestart = async () => {
    if (!config) return;
    try {
      await api.updateConfig(config);
      await api.restartService();
      setToast({ message: t('app.config_saved_restart_success'), type: 'success' });
      setTimeout(checkServerStatus, 3000);
    } catch (err) {
      setToast({ message: `${t('app.config_saved_restart_failed')}: ${(err as Error).message}`, type: 'error' });
    }
  };

  if (error) {
    return (
      <div className="h-screen bg-background font-sans flex items-center justify-center">
        <div className="text-destructive text-center">
          <p className="text-lg font-medium">Configuration Error</p>
          <p className="text-sm mt-1 text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="h-screen bg-background font-sans flex items-center justify-center">
        <div className="text-muted-foreground">{t('app.loading_config', 'Loading...')}</div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeView) {
      case 'providers':
        return (
          <div className="flex h-full gap-4">
            <div className="w-3/5 min-w-0 flex flex-col gap-4">
              <Providers />
            </div>
            <div className="flex w-2/5 flex-col gap-4 min-w-0">
              <div className="flex-[3] min-h-0">
                <Router />
              </div>
              <div className="flex-[2] min-h-0">
                <Transformers />
              </div>
            </div>
          </div>
        );
      case 'tools':
        return (
          <div className="flex h-full gap-4">
            <div className="w-1/2 min-w-0">
              <ModelMapping />
            </div>
            <div className="w-1/2 min-w-0">
              <ThinkingStrategy />
            </div>
          </div>
        );
      case 'dashboard':
        return <Dashboard />;
      case 'monitoring':
        return <ProviderMonitor />;
      case 'cache':
        return <CacheManager />;
      case 'budget':
        return <BudgetTracker />;
      default:
        return <Providers />;
    }
  };

  return (
    <div className="h-screen bg-background font-sans flex flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">CCR Proxy</h1>
          <span className={`inline-block h-2 w-2 rounded-full ${serverStatus === 'online' ? 'bg-green-500' : serverStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'}`} title={serverStatus} />
          <ViewTabs activeView={activeView} onViewChange={setActiveView} />
        </div>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Languages className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-28 p-1">
              <Button variant={i18n.language.startsWith('en') ? 'secondary' : 'ghost'} size="sm" className="w-full justify-start" onClick={() => i18n.changeLanguage('en')}>EN</Button>
              <Button variant={i18n.language.startsWith('zh') ? 'secondary' : 'ghost'} size="sm" className="w-full justify-start" onClick={() => i18n.changeLanguage('zh')}>中文</Button>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsSettingsOpen(true)}>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsJsonEditorOpen(true)}>
            <FileJson className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsLogViewerOpen(true)}>
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Button onClick={saveConfig} variant="outline" size="sm" className="h-7 text-xs">
              <Save className="mr-1 h-3 w-3" />{t('app.save')}
            </Button>
            <Button onClick={saveConfigAndRestart} size="sm" className="h-7 text-xs">
              <RefreshCw className="mr-1 h-3 w-3" />{t('app.save_and_restart')}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-hidden">
        {renderContent()}
      </main>

      <SettingsDialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      <JsonEditor open={isJsonEditorOpen} onOpenChange={setIsJsonEditorOpen} showToast={(message, type) => setToast({ message, type })} />
      <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} showToast={(message, type) => setToast({ message, type })} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default App;
