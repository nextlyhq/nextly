export interface ResolvedBrandingColors {
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
}

/**
 * A plugin sidebar menu item (D20), delivered via `/admin-meta`. Mirrors the
 * server `PluginMenuItem` contract; one level of `children`.
 */
export interface PluginMenuItemMeta {
  label: string;
  to: string;
  icon?: string;
  order?: number;
  requiredPermission?: string;
  children?: PluginMenuItemMeta[];
}

/** A plugin custom admin page (D21), delivered via `/admin-meta`. */
export interface PluginPageMeta {
  path: string;
  component: string;
  requiredPermission?: string;
}

/** Plugin metadata returned by the `/admin-meta` API. */
export interface PluginMetadata {
  name: string;
  version?: string;
  description?: string;
  /** @deprecated Use `placement` instead. */
  group?: string;
  /** Immutable sidebar placement from plugin config. */
  placement?: string;
  order?: number;
  /** Position anchor for standalone plugins (which built-in section to appear after). */
  after?: string;
  collections: string[];
  /** Sidebar appearance customization from plugin config. */
  appearance?: {
    icon?: string;
    label?: string;
    badge?: string;
    badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  };
  /** Declarative sidebar menu items contributed via `contributes.admin.menu` (D20). */
  menu?: PluginMenuItemMeta[];
  /** Custom admin pages contributed via `contributes.admin.pages` (D21). */
  pages?: PluginPageMeta[];
  /** Plugin settings UI contributed via `contributes.admin.settings` (D21). */
  settings?: { component: string };
}

export interface AdminBranding {
  /**
   * Highest-priority logo override (e.g. DB-configured custom logo).
   */
  logoUrl?: string;

  /**
   * Optional theme-specific logo URLs (used when `logoUrl` is not set).
   */
  logoUrlLight?: string;
  logoUrlDark?: string;

  logoText?: string;
  favicon?: string;
  colors?: ResolvedBrandingColors;
  /** Runtime toggle for builder-related navigation visibility. */
  showBuilder?: boolean;

  /** Installed plugin metadata for sidebar rendering and plugin settings pages. */
  plugins?: PluginMetadata[];

  /** Custom sidebar groups created by the user for organizing collections/singles. */
  customGroups?: Array<{ slug: string; name: string; icon?: string }>;

  /**
   * Plugin placement overrides mapping plugin slugs to sidebar group names.
   * @deprecated Placement is now author-defined via `PluginMetadata.placement`.
   */
  pluginPlacements?: Record<string, string>;
}
