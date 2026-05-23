import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { PermissionCode } from '../lib/api';

interface RequirePermissionRouteProps {
  permission: PermissionCode;
}

export function RequirePermissionRoute({ permission }: RequirePermissionRouteProps) {
  const { can, hasAnyProjectPermission } = useAuth();
  if (!can(permission) && !hasAnyProjectPermission(permission)) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}

