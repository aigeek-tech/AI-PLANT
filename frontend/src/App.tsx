import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { BrandingProvider } from './branding/BrandingProvider';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { RequirePermissionRoute } from './auth/RequirePermissionRoute';
import { RequireAnyPermissionRoute } from './auth/RequireAnyPermissionRoute';
import { RequireAllPermissionsRoute } from './auth/RequireAllPermissionsRoute';
import { ToastProvider } from './components/ui/Toast';
import { DialogProvider } from './components/ui/Dialog';
import { UiDisplaySettingsProvider } from './settings/UiDisplaySettingsProvider';
import { PluginProvider } from './plugins/PluginProvider';
import { usePlugins } from './plugins/PluginProvider';
import { PluginPageOutlet } from './plugins/PluginPageOutlet';

const AiSettingsPage = lazy(() => import('./pages/settings/AiSettingsPage').then((module) => ({ default: module.AiSettingsPage })));
const AccessManagementPage = lazy(() => import('./pages/settings/AccessManagementPage').then((module) => ({ default: module.AccessManagementPage })));
const BrandingSettingsPage = lazy(() => import('./pages/settings/BrandingSettingsPage').then((module) => ({ default: module.BrandingSettingsPage })));
const UiDisplaySettingsPage = lazy(() => import('./pages/settings/UiDisplaySettingsPage').then((module) => ({ default: module.UiDisplaySettingsPage })));
const PluginCenterPage = lazy(() => import('./pages/settings/PluginCenterPage').then((module) => ({ default: module.PluginCenterPage })));
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const ForbiddenPage = lazy(() => import('./pages/errors/ForbiddenPage').then((module) => ({ default: module.ForbiddenPage })));
const StandardDetailPage = lazy(() => import('./pages/standards/StandardDetailPage').then((module) => ({ default: module.StandardDetailPage })));
const StandardsPage = lazy(() => import('./pages/standards/StandardsPage').then((module) => ({ default: module.StandardsPage })));
const ProjectsPage = lazy(() => import('./pages/projects/ProjectsPage').then((module) => ({ default: module.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage').then((module) => ({ default: module.ProjectDetailPage })));
const ProjectDataQualityPage = lazy(() => import('./pages/projects/ProjectDataQualityPage').then((module) => ({ default: module.ProjectDataQualityPage })));
const TagDetailPage = lazy(() => import('./pages/projects/TagDetailPage').then((module) => ({ default: module.TagDetailPage })));
const DocumentPreviewPage = lazy(() => import('./pages/documents/DocumentPreviewPage').then((module) => ({ default: module.DocumentPreviewPage })));

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500">
      {t('common.loading')}
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <DialogProvider>
        <BrowserRouter>
          <AuthProvider>
            <PluginProvider>
              <BrandingProvider>
                <UiDisplaySettingsProvider>
                  <Suspense fallback={<RouteFallback />}>
                    <AppRoutes />
                  </Suspense>
                </UiDisplaySettingsProvider>
              </BrandingProvider>
            </PluginProvider>
          </AuthProvider>
        </BrowserRouter>
      </DialogProvider>
    </ToastProvider>
  );
}

export default App;

function AppRoutes() {
  const { isLoading, routes } = usePlugins();
  const loading = <div className="p-6 text-sm font-semibold text-slate-500">正在加载插件...</div>;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="data-quality" element={<ProjectDataQualityPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="projects/:projectId/data-quality" element={<ProjectDataQualityPage />} />
          <Route path="projects/:projectId/tags/:tagId" element={<TagDetailPage />} />
          <Route path="projects/:projectId/documents/:documentId/revisions/:revisionId/files/:fileId/preview" element={<DocumentPreviewPage />} />
          <Route path="standards" element={<StandardsPage />} />
          <Route path="standards/:standardId" element={<StandardDetailPage />} />
          <Route path="settings/display" element={<UiDisplaySettingsPage />} />
          <Route element={<RequirePermissionRoute permission="system.settings.branding.read" />}>
            <Route path="settings/branding" element={<BrandingSettingsPage />} />
          </Route>
          <Route element={<RequirePermissionRoute permission="system.settings.ai.read" />}>
            <Route path="settings/ai" element={<AiSettingsPage />} />
          </Route>
          <Route element={<RequireAnyPermissionRoute permissions={['system.user.manage', 'system.role.manage']} />}>
            <Route path="settings/access" element={<AccessManagementPage />} />
          </Route>
          <Route element={<RequirePermissionRoute permission="system.plugin.manage" />}>
            <Route path="settings/plugins" element={<PluginCenterPage />} />
          </Route>
          {routes.map((route) => {
            const element = <PluginPageOutlet pluginId={route.pluginId} entry={route.entry} element={route.element} />;
            const path = route.path.replace(/^\//, '');
            const permissions = route.permissions ?? [];
            if (permissions.length === 0) {
              return <Route key={`${route.pluginId}:${route.path}`} path={path} element={element} />;
            }
            if (route.requireAny) {
              return (
                <Route key={`${route.pluginId}:${route.path}`} element={<RequireAnyPermissionRoute permissions={permissions} />}>
                  <Route path={path} element={element} />
                </Route>
              );
            }
            if (permissions.length === 1) {
              return (
                <Route key={`${route.pluginId}:${route.path}`} element={<RequirePermissionRoute permission={permissions[0]} />}>
                  <Route path={path} element={element} />
                </Route>
              );
            }
            return (
              <Route key={`${route.pluginId}:${route.path}`} element={<RequireAllPermissionsRoute permissions={permissions} />}>
                <Route path={path} element={element} />
              </Route>
            );
          })}
          <Route path="*" element={isLoading ? loading : <Navigate to="/projects" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
