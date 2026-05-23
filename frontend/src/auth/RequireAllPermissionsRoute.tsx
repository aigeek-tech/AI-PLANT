import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import type { PermissionCode } from '../lib/api';

export function RequireAllPermissionsRoute({ permissions }: { permissions: PermissionCode[] }) {
  const { can, hasAnyProjectPermission } = useAuth();
  if (!permissions.every((permission) => can(permission) || hasAnyProjectPermission(permission))) {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
