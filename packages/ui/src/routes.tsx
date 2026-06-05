import { createMemoryRouter } from 'react-router-dom';
import App from './App';
import { DebugPage } from '@/components/DebugPage';
import { Presets } from '@/components/Presets';
import { Dashboard } from '@/components/Dashboard';
import { CacheManager } from '@/components/CacheManager';
import { BudgetTracker } from '@/components/BudgetTracker';
import { Pipeline } from '@/components/Pipeline';
import { ProviderMonitor } from '@/components/ProviderMonitor';

export const router = createMemoryRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/presets',
    element: <Presets />,
  },
  {
    path: '/debug',
    element: <DebugPage />,
  },
  {
    path: '/monitoring',
    element: <Dashboard />,
  },
  {
    path: '/cache',
    element: <CacheManager />,
  },
  {
    path: '/budget',
    element: <BudgetTracker />,
  },
  {
    path: '/pipeline',
    element: <Pipeline />,
  },
  {
    path: '/providers-monitor',
    element: <ProviderMonitor />,
  },
], {
  initialEntries: ['/']
});
