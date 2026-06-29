import type { PermissionSlug } from "./contributions";

/**
 * @public A reference to a plugin-provided admin React component (D19),
 * resolved client-side through the string-path component registry.
 *
 * Format: `"<package>/<path>#<ExportName>"`,
 * e.g. `"@nextlyhq/plugin-form-builder/admin#FormBuilderView"`.
 *
 * A plain `string` until typed-component codegen (D60, P6) narrows it.
 */
export type ComponentPath = string;

/**
 * @public Built-in admin header buttons that a plugin may hide.
 * The user/account dropdown is intentionally NOT controllable (logout must
 * stay reachable).
 */
export type HeaderButtonId = "github" | "discord" | "docs" | "notifications";

/**
 * @public Header customization contributed by a plugin.
 *
 * `slot` adds a component to the header (supersedes the deprecated top-level
 * `headerSlot`). `hideDefaults` / `hide` remove built-in buttons; hiding is
 * subtractive and **union-merged** across enabled plugins (a button is hidden
 * if ANY enabled plugin hides it).
 */
export interface PluginHeaderContributions {
  /** Component rendered in the header, before the notifications bell. */
  slot?: ComponentPath;
  /** Hide all built-in header buttons (github, discord, docs, notifications). */
  hideDefaults?: boolean;
  /** Hide specific built-in header buttons. */
  hide?: HeaderButtonId[];
}

/**
 * @public A sidebar navigation entry contributed by a plugin (D20).
 *
 * Declarative and introspectable — delivered to the client via `/api/admin-meta`.
 * Exactly **one** level of `children` is supported. Visibility is controlled by
 * `requiredPermission` (client-gated via `useCan`); a `visible(ctx)` callback is
 * intentionally NOT supported because menus are serialized to the client (OQ-1).
 */
export interface PluginMenuItem {
  /** Display label. */
  label: string;
  /** Admin path to navigate to, e.g. `"/admin/collections/forms"`. */
  to: string;
  /** Lucide icon name (resolved client-side). */
  icon?: string;
  /** Sort order within the plugin's items; lower = higher. Default 100. */
  order?: number;
  /** Hide the item unless the current user holds this permission (client-gated, D36). */
  requiredPermission?: PermissionSlug;
  /** One nested level of sub-items (D20). */
  children?: PluginMenuItem[];
}

/**
 * @public A plugin-contributed admin page (D21), mounted under the
 * plugin's namespace (`/admin/plugins/<slug>/<path>`) and RBAC-gated.
 */
export interface PluginAdminPage {
  /** Path relative to the plugin namespace (no leading slash), e.g. `"reports"`. */
  path: string;
  /** Component rendered for this page. */
  component: ComponentPath;
  /** Required permission to view the page (route-level RBAC, D36). */
  requiredPermission?: PermissionSlug;
}

/**
 * @experimental A plugin-contributed dashboard widget (D22).
 *
 * RESERVED in P5 — the contract is published for forward-compatibility, but
 * widget rendering / the dashboard grid is **deferred to M8 (D58)** and is NOT
 * built in P5. Declaring widgets has no effect yet.
 */
export interface PluginAdminWidget {
  id: string;
  component: ComponentPath;
  size?: "full" | "half";
  requiredPermission?: PermissionSlug;
}

/**
 * @public Per-collection admin view overrides + injection points (D23),
 * keyed by the (resolved) collection slug. Each maps to the collection-level
 * `admin.components` resolution the admin already performs.
 */
export interface PluginCollectionView {
  /** Replace the default List view. */
  list?: ComponentPath;
  /** Replace the default Edit view. */
  edit?: ComponentPath;
  /** Inject above the list table. */
  beforeList?: ComponentPath;
  /** Inject below the list table. */
  afterList?: ComponentPath;
  /** Inject above the edit form. */
  beforeEdit?: ComponentPath;
  /** Inject below the edit form. */
  afterEdit?: ComponentPath;
}

/**
 * @public Declarative admin-UI contributions (D19–D23). Introspectable
 * by the host without running the plugin.
 *
 * Consumed in P5: `menu` (D20), `pages` + `settings` (D21), `views` (D23).
 * `widgets` (D22) is RESERVED — deferred to M8 (D58); not rendered in P5.
 */
export interface PluginAdminContributions {
  /** Sidebar navigation entries (D20). */
  menu?: PluginMenuItem[];
  /** Custom admin pages, namespaced + RBAC-gated (D21). */
  pages?: PluginAdminPage[];
  /** Plugin settings UI rendered at `/admin/plugins/<slug>` (D21). */
  settings?: { component: ComponentPath };
  /**
   * @experimental Dashboard widgets (D22) — now rendered by `PluginWidgetGrid`
   * on the admin dashboard, permission-gated (C9). Graduates per D55.
   */
  widgets?: PluginAdminWidget[];
  /** Per-collection view overrides + injection points, keyed by slug (D23). */
  views?: Record<string, PluginCollectionView>;
  /**
   * @deprecated Use `header.slot`. A component rendered in the admin top bar /
   * header (C9). The component self-gates on permission. Rendered inside the
   * plugin boundary. Still honored (folded into `header.slot`) for back-compat.
   */
  headerSlot?: ComponentPath;
  /**
   * @experimental Header customization: add a component (`slot`)
   * and/or hide built-in buttons (`hideDefaults`/`hide`). The slot self-gates
   * on permission and renders inside the plugin boundary.
   */
  header?: PluginHeaderContributions;
}
