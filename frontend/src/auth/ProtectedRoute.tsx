import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export function ProtectedRoute() {
  const { t } = useTranslation();
  const { auth, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl shadow-slate-200/60 backdrop-blur-xl">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-adnoc-blue" />
          <p className="mt-4 text-sm font-semibold text-slate-500">{t('auth.restoring')}</p>
        </div>
      </div>
    );
  }

  if (!auth) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

