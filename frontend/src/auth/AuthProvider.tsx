/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AUTH_REQUIRED_EVENT,
  ApiError,
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  type AuthMeResult,
  type PermissionCode,
} from '../lib/api';

interface AuthContextValue {
  auth: AuthMeResult | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: PermissionCode, scopeId?: string) => boolean;
  hasAnyProjectPermission: (permission: PermissionCode) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthMeResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      setAuth(current);
    } catch (error) {
      if (error instanceof ApiError && error.status !== 401) {
        console.error('Failed to load current user', error);
      }
      setAuth(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleAuthRequired = () => setAuth(null);
    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginRequest({ username, password });
    setAuth(result);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setAuth(null);
    }
  }, []);

  const can = useCallback((permission: PermissionCode, scopeId?: string) => {
    if (!auth) {
      return false;
    }
    if (auth.system_permissions.includes(permission)) {
      return true;
    }
    if (scopeId && auth.project_permissions[scopeId]?.includes(permission)) {
      return true;
    }
    if (scopeId && auth.standard_permissions[scopeId]?.includes(permission)) {
      return true;
    }
    return false;
  }, [auth]);

  const hasAnyProjectPermission = useCallback((permission: PermissionCode) => {
    if (!auth) {
      return false;
    }
    if (auth.system_permissions.includes(permission)) {
      return true;
    }
    return Object.values(auth.project_permissions).some((permissions) => permissions.includes(permission));
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => ({
    auth,
    isLoading,
    login,
    logout,
    refresh,
    can,
    hasAnyProjectPermission,
  }), [auth, can, hasAnyProjectPermission, isLoading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
