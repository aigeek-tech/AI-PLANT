import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { PermissionCode } from '../lib/api';

export function RequireAnyPermissionRoute({ permissions }: { permissions: PermissionCode[] }) {
  const { can, hasAnyProjectPermission } = useAuth();
  if (!permissions.some((permission) => can(permission) || hasAnyProjectPermission(permission))) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}

