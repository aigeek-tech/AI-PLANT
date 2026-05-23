import {
  Book,
  ClipboardCheck,
  Folder,
  PanelTop,
  Plug,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionCode } from '../../lib/api';

export interface SidebarNavigationItem {
  icon: LucideIcon;
  labelKey: string;
  to: string;
  end?: boolean;
  permissions?: PermissionCode[];
  requireAny?: boolean;
}

export interface SidebarNavigationSection {
  labelKey: string;
  items: SidebarNavigationItem[];
}

export const SIDEBAR_NAVIGATION: SidebarNavigationSection[] = [
  {
    labelKey: 'navigation.engineering',
    items: [{ icon: Folder, labelKey: 'navigation.projects', to: '/projects' }],
  },
  {
    labelKey: 'navigation.quality',
    items: [{ icon: ClipboardCheck, labelKey: 'navigation.dataQuality', to: '/data-quality' }],
  },
  {
    labelKey: 'navigation.standards',
    items: [{ icon: Book, labelKey: 'navigation.standardsLibrary', to: '/standards' }],
  },
  {
    labelKey: 'navigation.settings',
    items: [
      {
        icon: SlidersHorizontal,
        labelKey: 'navigation.displaySettings',
        to: '/settings/display',
      },
      {
        icon: PanelTop,
        labelKey: 'navigation.brandingSettings',
        to: '/settings/branding',
        permissions: ['system.settings.branding.read'],
      },
      {
        icon: ShieldCheck,
        labelKey: 'navigation.accessManagement',
        to: '/settings/access',
        permissions: ['system.user.manage', 'system.role.manage'],
        requireAny: true,
      },
      {
        icon: Settings,
        labelKey: 'navigation.aiSettings',
        to: '/settings/ai',
        permissions: ['system.settings.ai.read'],
      },
      {
        icon: Plug,
        labelKey: 'navigation.pluginCenter',
        to: '/settings/plugins',
        permissions: ['system.plugin.manage'],
      },
    ],
  },
];
