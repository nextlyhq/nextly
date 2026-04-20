export interface ResolvedBrandingColors {
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
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
   * @deprecated Placement is now author-defined via `PluginMetadata.placement`. Will be removed in Phase 5.
   */
  pluginPlacements?: Record<string, string>;
}
