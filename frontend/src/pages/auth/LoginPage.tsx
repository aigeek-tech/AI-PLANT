import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useBranding } from '../../branding/BrandingProvider';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '../../i18n/locales';
import { bootstrapAdmin, buildApiAssetUrl, getBootstrapStatus } from '../../lib/api';
import { useUiDisplaySettings } from '../../settings/uiDisplaySettings';

type LocationState = { from?: { pathname?: string } } | null;

export function LoginPage() {
  const { t } = useTranslation();
  const { auth, login } = useAuth();
  const { branding } = useBranding();
  const { settings, updateSettings } = useUiDisplaySettings();
  const navigate = useNavigate();
  const location = useLocation();
  const from = ((location.state as LocationState)?.from?.pathname) || '/projects';
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [isCheckingBootstrap, setIsCheckingBootstrap] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrapStatus() {
      try {
        const result = await getBootstrapStatus();
        if (!cancelled) setNeedsBootstrap(result.needs_bootstrap);
      } catch {
        if (!cancelled) setError(t('auth.bootstrapCheckFailed'));
      } finally {
        if (!cancelled) setIsCheckingBootstrap(false);
      }
    }

    void loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (auth) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError(t('auth.credentialsRequired'));
      return;
    }

    if (needsBootstrap && password.length < 8) {
      setError(t('auth.bootstrapPasswordTooShort'));
      return;
    }

    setIsSubmitting(true);

    try {
      if (needsBootstrap) {
        await bootstrapAdmin({
          username: normalizedUsername,
          password,
          display_name: normalizedUsername,
          email: null,
          status: 'active',
        });
      }
      await login(normalizedUsername, password);
      navigate(from, { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('auth.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const loginBackgroundImage = buildApiAssetUrl(branding.login_background_image_url);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#04152f] px-4 py-10 sm:px-6 lg:justify-end lg:px-[11vw]">
      {loginBackgroundImage ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${loginBackgroundImage}")` }}
        />
      ) : (
        <div className="absolute inset-0 bg-[#04152f]" />
      )}
      {loginBackgroundImage ? (
        <>
          <div className="absolute inset-0 bg-[#031225]/28" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,10,30,0.08)_0%,rgba(0,10,30,0.02)_48%,rgba(0,10,30,0.32)_100%)]" />
        </>
      ) : null}
      <label className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-xl border border-cyan-100/20 bg-[#061a36]/70 px-3 py-2 text-xs font-bold text-cyan-50 shadow-lg backdrop-blur-xl">
        <span>{t('common.language')}</span>
        <select
          value={settings.locale}
          onChange={(event) => updateSettings({ locale: event.target.value as SupportedLocale })}
          className="rounded-lg border border-cyan-100/20 bg-white/10 px-2 py-1 text-xs font-bold text-white outline-none focus:border-cyan-100/70"
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale} className="text-slate-900">
              {LOCALE_LABELS[locale]}
            </option>
          ))}
        </select>
      </label>

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-[470px] overflow-hidden rounded-[1.9rem] border border-cyan-300/55 bg-[#061a36]/60 p-7 text-white shadow-[0_0_34px_rgba(34,211,238,0.28),0_24px_80px_rgba(0,0,0,0.40)] backdrop-blur-xl sm:p-9"
      >
        <div className="pointer-events-none absolute inset-0 rounded-[1.9rem] ring-1 ring-inset ring-white/10" />
        <div className="pointer-events-none absolute left-8 right-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
        <div className="relative text-center">
          <h1 className="text-[2.05rem] font-black leading-tight text-white sm:text-[2.45rem]">
            {needsBootstrap ? t('auth.createAdmin') : branding.sidebar_title}
          </h1>
          <div className="mt-5 flex items-center gap-4 text-sm font-semibold text-cyan-100/90">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-cyan-300/70" />
            <span>{needsBootstrap ? t('auth.bootstrap') : t('auth.welcome')}</span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-cyan-300/70" />
          </div>
          <p className="mt-3 text-xs font-semibold text-cyan-100/65">{branding.system_name}</p>
        </div>

        {error && (
          <div className="relative mt-6 rounded-2xl border border-red-300/35 bg-red-500/15 px-4 py-3 text-sm font-medium text-red-50">
            {error}
          </div>
        )}

        <div className="relative mt-7 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-cyan-100/80">{t('auth.username')}</span>
            <div className="relative mt-2">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-100/70" />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-14 w-full rounded-xl border border-cyan-200/25 bg-white/[0.08] px-4 pl-12 text-base text-white outline-none transition placeholder:text-cyan-100/50 focus:border-cyan-200/80 focus:bg-white/[0.12] focus:ring-4 focus:ring-cyan-300/15"
                autoComplete="username"
                placeholder={t('auth.usernamePlaceholder')}
                required
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-cyan-100/80">{t('auth.password')}</span>
            <div className="relative mt-2">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-100/70" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-14 w-full rounded-xl border border-cyan-200/25 bg-white/[0.08] px-4 pl-12 pr-12 text-base text-white outline-none transition placeholder:text-cyan-100/50 focus:border-cyan-200/80 focus:bg-white/[0.12] focus:ring-4 focus:ring-cyan-300/15"
                type={showPassword ? 'text' : 'password'}
                autoComplete={needsBootstrap ? 'new-password' : 'current-password'}
                minLength={needsBootstrap ? 8 : undefined}
                placeholder={needsBootstrap ? t('auth.newPasswordPlaceholder') : t('auth.passwordPlaceholder')}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-cyan-100/70 transition hover:bg-white/10 hover:text-cyan-50"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || isCheckingBootstrap}
          className="relative mt-8 inline-flex h-[58px] w-full items-center justify-center overflow-hidden rounded-[7px] border border-[#25dfff]/90 bg-[#087bfa] px-5 text-[1.52rem] font-black leading-none text-white shadow-[0_0_18px_rgba(0,205,255,0.56),0_0_8px_rgba(0,92,255,0.36)] transition hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(0,211,255,0.66),0_0_12px_rgba(0,92,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            backgroundImage: [
              'linear-gradient(180deg, rgba(55,229,255,0.30) 0%, rgba(31,174,255,0.16) 26%, rgba(4,118,251,0.04) 70%, rgba(5,94,234,0.12) 100%)',
              'radial-gradient(92% 125% at 35% 48%, rgba(0,184,255,0.50) 0%, rgba(0,137,255,0.28) 43%, rgba(0,137,255,0) 74%)',
              'linear-gradient(90deg, #10bfff 0%, #0797ff 35%, #0677f8 68%, #0866f4 100%)',
            ].join(','),
          }}
        >
          <span className="pointer-events-none absolute inset-x-2 top-0 h-px bg-[#8ef8ff]/85" />
          <span className="pointer-events-none absolute inset-y-2 left-0 w-px bg-[#2de6ff]/80" />
          <span className="pointer-events-none absolute inset-y-2 right-0 w-px bg-[#30cfff]/55" />
          <span className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-[#0fd1ff]/55" />
          <span className="relative inline-flex items-center justify-center drop-shadow-[0_0_5px_rgba(202,248,255,0.85)]">
            {isSubmitting || isCheckingBootstrap ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {needsBootstrap ? t('auth.createAndLogin') : t('auth.login')}
          </span>
        </button>

        {isCheckingBootstrap ? (
          <p className="relative mt-4 text-center text-xs font-medium text-cyan-100/70">{t('auth.checkingBootstrap')}</p>
        ) : null}
      </form>

      <p className="absolute bottom-5 left-1/2 z-10 w-full -translate-x-1/2 px-4 text-center text-xs font-medium text-cyan-50/70">
        © 2026 深圳艾极科技有限公司. All rights reserved.
      </p>
    </div>
  );
}

