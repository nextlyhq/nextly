import type { FieldSurface, FieldTypeCategory } from "nextly/field-catalog";

export interface ResolvedBrandingColors {
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
}

/**
 * A plugin sidebar menu item, delivered via `/admin-meta`. Mirrors the
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

/** A plugin custom admin page, delivered via `/admin-meta`. */
export interface PluginPageMeta {
  path: string;
  component: string;
  requiredPermission?: string;
}

/** A plugin dashboard widget, delivered via `/admin-meta`. */
export interface PluginWidgetMeta {
  id: string;
  component: string;
  size?: "full" | "half";
  requiredPermission?: string;
}

/** Plugin metadata returned by the `/admin-meta` API. */
export interface PluginMetadata {
  name: string;
  version?: string;
  description?: string;
  /** Author shown in the plugins list; mirrors package.json by convention. */
  author?: string;
  /** Homepage URL linked from the plugin detail page. */
  homepage?: string;
  /** Source repository URL linked from the plugin detail page. */
  repository?: string;
  /** Documentation URL when distinct from the homepage. */
  docsUrl?: string;
  /** SPDX license identifier shown on the plugin detail page. */
  license?: string;
  /** Category the plugins list filters by (controlled vocabulary). */
  category?: string;
  /** Free-form descriptive tags shown on the plugin detail page. */
  tags?: string[];
  /** Whether the plugin's behavior is active. Absent on older servers. */
  enabled?: boolean;
  /** Required plugin dependencies → version range, for the detail page. */
  dependsOn?: Record<string, string>;
  /** @deprecated Use `placement` instead. */
  group?: string;
  /** Immutable sidebar placement from plugin config. */
  placement?: string;
  order?: number;
  /** Position anchor for standalone plugins (which built-in section to appear after). */
  after?: string;
  collections: string[];
  /** Slugs of contributed singles, for the detail page's contributions view. */
  singles?: string[];
  /** Slugs of contributed components, for the detail page's contributions view. */
  components?: string[];
  /** Declared custom permissions (identity + display fields only; enabled plugins). */
  permissions?: Array<{
    action: string;
    resource: string;
    label?: string;
    description?: string;
    danger?: boolean;
  }>;
  /** Declared HTTP routes as method + path (enabled plugins only). */
  routes?: Array<{ method: string; path: string }>;
  /** Sidebar appearance customization from plugin config. */
  appearance?: {
    icon?: string;
    label?: string;
    badge?: string;
    badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  };
  /** Declarative sidebar menu items contributed via `contributes.admin.menu`. */
  menu?: PluginMenuItemMeta[];
  /** Custom admin pages contributed via `contributes.admin.pages`. */
  pages?: PluginPageMeta[];
  /** Plugin settings UI contributed via `contributes.admin.settings`. */
  settings?: { component: string };
  /** Admin header-slot component contributed via `contributes.admin.headerSlot`. */
  headerSlot?: string;
  /** Header customization contributed via `contributes.admin.header`. */
  header?: {
    slot?: string;
    hideDefaults?: boolean;
    hide?: Array<"github" | "discord" | "docs" | "notifications">;
  };
  /** Dashboard widgets contributed via `contributes.admin.widgets`. */
  widgets?: PluginWidgetMeta[];
  /**
   * Component rendered in the schema-builder pages (above the field list),
   * contributed via `contributes.admin.schemaBuilderSlot`. Receives `{ fields,
   * setFields, disabled, context }`.
   */
  schemaBuilderSlot?: string;
  /**
   * Component rendered in the entry/single form header toolbar, contributed via
   * `contributes.admin.entryFormToolbarSlot`. Receives `{ context,
   * controllerField }` and reads/writes form state via react-hook-form context.
   */
  entryFormToolbarSlot?: string;
  /**
   * Custom field types — `type` → admin editor component path. `layout:
   * "takeover"` marks a type whose visible field collapses the entry-form body
   * to just that field + its condition controller (see takeoverLayout). The
   * picker presentation (label/description/icon/category) and the `surfaces`
   * the type opted into let each surface offer only the types meant for it
   * (see pluginFieldTypeCatalogEntries).
   */
  fieldTypes?: Array<{
    type: string;
    component: string;
    layout?: "takeover";
    label?: string;
    description?: string;
    icon?: string;
    category?: FieldTypeCategory;
    surfaces?: readonly FieldSurface[];
  }>;
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
