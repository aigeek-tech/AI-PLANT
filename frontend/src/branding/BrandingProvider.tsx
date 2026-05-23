/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPublicBrandingSettings, type BrandingSettings } from '../lib/api';

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  system_name: 'AI PLANT',
  sidebar_title: '智能工厂',
  logo_data_url: null,
  login_background_image_url: null,
  login_background_image_meta: null,
  updated_at: null,
};

interface BrandingContextValue {
  branding: BrandingSettings;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setBranding: (value: BrandingSettings) => void;
}

const BrandingContext = createContext<BrandingContextValue | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBrandingState] = useState<BrandingSettings>(DEFAULT_BRANDING_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const nextBranding = await getPublicBrandingSettings();
      setBrandingState(nextBranding);
    } catch (error) {
      console.error('Failed to load branding settings', error);
      setBrandingState(DEFAULT_BRANDING_SETTINGS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.title = branding.system_name;
  }, [branding.system_name]);

  const setBranding = useCallback((value: BrandingSettings) => {
    setBrandingState(value);
  }, []);

  const value = useMemo<BrandingContextValue>(
    () => ({
      branding,
      isLoading,
      refresh,
      setBranding,
    }),
    [branding, isLoading, refresh, setBranding],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return context;
}
