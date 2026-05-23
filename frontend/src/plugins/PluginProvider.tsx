/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ApiError,
  getEnabledPluginManifest,
  type EnabledPluginManifest,
  type PluginNavigationContribution,
  type PluginRouteContribution,
  type PluginSlotContribution,
} from '../lib/api';
import { useAuth } from '../auth/AuthProvider';

interface PluginContextValue {
  plugins: EnabledPluginManifest[];
  routes: Array<PluginRouteContribution & { pluginId: string; entry: string }>;
  navigation: PluginNavigationContribution[];
  slots: Array<PluginSlotContribution & { pluginId: string }>;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const PluginContext = createContext<PluginContextValue | undefined>(undefined);

export function PluginProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const [plugins, setPlugins] = useState<EnabledPluginManifest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth) {
      setPlugins([]);
      return;
    }
    setIsLoading(true);
    try {
      const result = await getEnabledPluginManifest();
      setPlugins(result.plugins);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        console.error('Failed to load enabled plugins', error);
      }
      setPlugins([]);
    } finally {
      setIsLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<PluginContextValue>(() => {
    const routes = plugins.flatMap((plugin) =>
      plugin.routes.map((route) => ({
        ...route,
        pluginId: plugin.id,
        entry: plugin.entry,
      })),
    );
    const navigation = plugins.flatMap((plugin) => plugin.navigation);
    const slots = plugins.flatMap((plugin) =>
      (plugin.slots ?? []).map((slot) => ({
        ...slot,
        pluginId: plugin.id,
      })),
    );
    return { plugins, routes, navigation, slots, isLoading, refresh };
  }, [isLoading, plugins, refresh]);

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
}

export function usePlugins() {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePlugins must be used within PluginProvider');
  }
  return context;
}
