import type {
  FieldStoragePrimitive,
  FieldSurface,
  FieldTypeCategory,
} from "nextly/field-catalog";

export interface ResolvedBrandingColors {
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
}

/**
 * Where a plugin's admin surfaces appear in the sidebar, as delivered via
 * `/admin-meta`. Mirrors the server's `PluginNavSection`.
 */
export type PluginNavSectionMeta =
  | "dashboard"
  | "collections"
  | "singles"
  | "media"
  | "plugins"
  | "settings"
  | "standalone";

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
  /**
   * Which sidebar section lists this item, as declared by the plugin. Absent
   * defers to the plugin's own `placement` rather than meaning "Plugins".
   */
  section?: PluginNavSectionMeta;
  children?: PluginMenuItemMeta[];
}

/** A plugin custom admin page, delivered via `/admin-meta`. */
export interface PluginPageMeta {
  path: string;
  component: string;
  requiredPermission?: string;
  /**
   * Which sidebar section is selected while this page is open, as declared by
   * the plugin. Absent defers to the plugin's own `placement`.
   */
  section?: PluginNavSectionMeta;
}

/**
 * A plugin dashboard widget, delivered via `/admin-meta`.
 *
 * `buildPluginAdminMeta` assigns `contributes.admin.widgets` to the meta
 * verbatim, so this and the server's `PluginAdminWidget` are one shape --
 * declared twice, which is why they were free to drift. They had: the server
 * made `component` OPTIONAL while this kept it required, and nothing compared
 * the two, so a plugin adopting the server's shape reached `PluginSlot` with
 * `path === undefined` and rendered an empty grid cell silently.
 *
 * `component` is required on BOTH sides again, and `admin-contributions.test-d.ts`
 * pins it there -- so widening it in core is now a compile error at the
 * declaration rather than an empty cell at runtime. That is a DECLARED
 * dependency rather than a structural one: deriving this from
 * `PluginAdminWidget` would be better and is not reachable today, because this
 * package's tsconfig maps the bare `nextly` specifier to `../nextly/src` and so
 * shadows the package exports, pulling core's whole source tree in with
 * internal path aliases this project does not carry. Whoever changes either
 * declaration must change both.
 */
export interface PluginWidgetMeta {
  id: string;
  component: string;
  size?: "full" | "half";
  requiredPermission?: string;
}

/**
 * A plugin's public client configuration, served before a session exists.
 *
 * Separate from `plugins` because the two answer different questions:
 * this says a plugin DECLARED a public config, while `plugins` says which
 * plugins the project has installed. Merging them would let a plugin with
 * a public config read as installed before the gated request answers.
 */
export interface PluginClientConfigMeta {
  name: string;
  clientConfig?: Record<string, unknown>;
}

/** Plugin metadata returned by the `/admin-meta` API. */
export interface PluginMetadata {
  name: string;
  /**
   * The plugin's own configuration for its admin components, as declared in
   * `contributes.admin.clientConfig` and serialized through `/api/admin-meta`.
   *
   * Public: `/api/admin-meta` needs no authentication, so this reaches
   * anonymous callers and never holds secrets. Read it with
   * `usePluginClientConfig` rather than searching this array by hand.
   */
  clientConfig?: Record<string, unknown>;
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
  /** Slugs of contributed field groups, for the detail page's contributions view. */
  fieldGroups?: string[];
  /** Declared HTTP routes as method + path (enabled plugins only). */
  /**
   * Declared HTTP routes. `fullPath` is the namespace the dispatcher mounts
   * them at, serialized by the server rather than rebuilt here: it is derived
   * from the RAW package name, which is not the admin slug this UI addresses
   * plugins by. Prefix it with the host's mount point (`/api` by convention)
   * to get the URL.
   */
  routes?: Array<{ method: string; path: string; fullPath: string }>;
  /**
   * The routes a DISABLED plugin declares but does not currently serve.
   * Mirrors the server's `PluginAdminMeta.whenEnabled`.
   *
   * Routes only: a disabled plugin's permissions are seeded like any other's,
   * so they are not pending on being enabled. Never present alongside
   * `routes` — render one or the other.
   */
  whenEnabled?: { routes?: PluginMetadata["routes"] };
  /** Sidebar appearance customization from plugin config. */
  appearance?: {
    /** A lucide icon name. The common case; always theme-aware. */
    icon?: string;
    /**
     * A URL to an image the plugin ships, for a plugin that wants its own
     * branding rather than a generic glyph. Takes precedence over `icon` when
     * both are present. Resolve through `resolvePluginIcon` rather than
     * reading either field directly.
     */
    iconAsset?: string;
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
    /** The primitive this type persists as; decides binding compatibility. */
    storage: FieldStoragePrimitive;
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

  /**
   * INSTALLED plugin metadata, for sidebar rendering and plugin settings pages.
   *
   * Comes from the session-gated half alone, so its absence means the list has
   * not arrived rather than that the project has no plugins. Read
   * `useBrandingStatus()` before concluding anything from a plugin missing here.
   */
  plugins?: PluginMetadata[];

  /**
   * Public client configuration, readable before a session exists.
   *
   * Deliberately NOT merged into `plugins`: a plugin declaring a public config
   * is not a plugin the project has installed, and a reader that found it in
   * that list would have skipped the checks saying the installed list is still
   * unavailable. Only `usePluginClientConfig` reads this.
   */
  pluginClientConfigs?: PluginClientConfigMeta[];

  /** Custom sidebar groups created by the user for organizing collections/singles. */
  customGroups?: Array<{ slug: string; name: string; icon?: string }>;

  /** Content localization config (present only when the app enables i18n). */
  locales?: {
    defaultLocale: string;
    fallback: boolean;
    locales: Array<{
      code: string;
      label: string;
      rtl: boolean;
      fallbackLocale: string[];
    }>;
  };

  /**
   * Plugin placement overrides mapping plugin slugs to sidebar group names.
   * @deprecated Placement is now author-defined via `PluginMetadata.placement`.
   */
  pluginPlacements?: Record<string, string>;
}
