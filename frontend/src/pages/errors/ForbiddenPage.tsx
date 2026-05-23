import { LockKeyhole, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[calc(100vh-6rem)] items-center justify-center">
      <div className="max-w-md rounded-3xl border border-white/70 bg-white/80 p-8 text-center shadow-xl shadow-slate-200/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <LockKeyhole className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-slate-900">{t('forbidden.title')}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          {t('forbidden.description')}
        </p>
        <Link
          to="/projects"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-adnoc-blue px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/20"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('forbidden.backToProjects')}
        </Link>
      </div>
    </div>
  );
}

