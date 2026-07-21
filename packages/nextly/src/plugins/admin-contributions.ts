import type { PermissionSlug } from "./contributions";

/**
 * @public A reference to a plugin-provided admin React component,
 * resolved client-side through the string-path component registry.
 *
 * Format: `"<package>/<path>#<ExportName>"`,
 * e.g. `"@nextlyhq/plugin-form-builder/admin#FormBuilderView"`.
 *
 * A plain `string` until typed-component codegen narrows it.
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
 * @public A sidebar navigation entry contributed by a plugin.
 *
 * Declarative and introspectable — delivered to the client via `/api/admin-meta`.
 * Exactly **one** level of `children` is supported. Visibility is controlled by
 * `requiredPermission` (client-gated via `useCan`); a `visible(ctx)` callback is
 * intentionally NOT supported because menus are serialized to the client.
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
  /** One nested level of sub-items. */
  children?: PluginMenuItem[];
}

/**
 * @public A plugin-contributed admin page, mounted under the
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
 * @experimental A plugin-contributed dashboard widget.
 *
 * RESERVED — the contract is published for forward-compatibility, but
 * widget rendering / the dashboard grid is **deferred** and is NOT
 * built. Declaring widgets has no effect yet.
 */
export interface PluginAdminWidget {
  id: string;
  component: ComponentPath;
  size?: "full" | "half";
  requiredPermission?: PermissionSlug;
}

/**
 * @public Per-collection admin view overrides + injection points,
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
 * @public Declarative admin-UI contributions. Introspectable
 * by the host without running the plugin.
 *
 * Consumed: `menu`, `pages` + `settings`, `views`.
 * `widgets` is RESERVED — deferred; not rendered.
 */
export interface PluginAdminContributions {
  /** Sidebar navigation entries. */
  menu?: PluginMenuItem[];
  /** Custom admin pages, namespaced + RBAC-gated. */
  pages?: PluginAdminPage[];
  /** Plugin settings UI rendered at `/admin/plugins/<slug>`. */
  settings?: { component: ComponentPath };
  /**
   * @experimental Dashboard widgets — now rendered by `PluginWidgetGrid`
   * on the admin dashboard, permission-gated. Graduates per D55.
   */
  widgets?: PluginAdminWidget[];
  /** Per-collection view overrides + injection points, keyed by slug. */
  views?: Record<string, PluginCollectionView>;
  /**
   * Precompiled, `.nextly-admin`-scoped, token-driven CSS this plugin ships for
   * admin components whose utilities are not in the built-in safelist. A
   * package-relative reference (or several), e.g. "@acme/plugin/dist/admin.css".
   *
   * Declaring this does NOT load anything. The plugin's admin entry must
   * side-effect-import the file (`import "./dist/admin.css"`), which is what
   * makes the consumer's bundler load and dedupe it; this field is the
   * machine-readable statement of that fact, for tooling and for anyone reading
   * the manifest. The two can therefore disagree — declaring a file the entry
   * never imports renders unstyled with no error — so keep them in step.
   *
   * Omit when the plugin styles itself from SDK components plus safelisted
   * utilities.
   */
  styles?: string | string[];
  /**
   * @deprecated Use `header.slot`. A component rendered in the admin top bar /
   * header. The component self-gates on permission. Rendered inside the
   * plugin boundary. Still honored (folded into `header.slot`) for back-compat.
   */
  headerSlot?: ComponentPath;
  /**
   * @experimental Header customization: add a component (`slot`)
   * and/or hide built-in buttons (`hideDefaults`/`hide`). The slot self-gates
   * on permission and renders inside the plugin boundary.
   */
  header?: PluginHeaderContributions;
  /**
   * @experimental A component rendered in the schema-builder pages (collection +
   * single builders), above the field list. Receives `{ fields, setFields,
   * disabled, context: "collection" | "single" }` so it can add builder-time
   * controls (e.g. an editor-choice toggle) that mutate the field list — without
   * core knowing the plugin. Rendered inside the plugin boundary.
   */
  schemaBuilderSlot?: ComponentPath;
  /**
   * @experimental A component rendered in the entry/single form header toolbar.
   * Receives `{ context: "collection" | "single"; controllerField?: string }` and
   * reads/writes form state via react-hook-form context (it renders inside the
   * form's provider). Lets a plugin add a form-level control (e.g. a Default /
   * Page Builder mode toggle) without core knowing the plugin. Rendered inside
   * the plugin boundary.
   */
  entryFormToolbarSlot?: ComponentPath;
}
