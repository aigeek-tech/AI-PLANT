import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import type { PermissionCode } from '../lib/api';

interface PermissionGateProps {
  permission: PermissionCode;
  scopeId?: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGate({ permission, scopeId, children, fallback = null }: PermissionGateProps) {
  const { can } = useAuth();
  if (!can(permission, scopeId)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}

