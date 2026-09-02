import type {
  WidgetChrome,
  DataWidgetArchetype,
  WidgetAction,
  QuerylessWidgetArchetype,
  WidgetArchetype,
  WidgetQuery,
  WidgetSize,
} from "../domains/widgets";

import type { PermissionSlug } from "./contributions";

/**
 * @public A value that survives being sent to the browser as JSON.
 *
 * Spelled out rather than widened to `unknown` so the compiler refuses a
 * function or a `Date` at the point it is written, where the author can see
 * what they meant, instead of at the point it silently arrives as `null`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * @public A JSON object. Offered for plugin authors who want to state the
 * shape of their own config precisely.
 *
 * Deliberately NOT the type of `clientConfig` itself. An `interface` has no
 * implicit index signature in TypeScript, so an author's
 * `interface MyConfig { … }` would not satisfy this however plainly JSON it
 * is — the error would land on correct code and the fix would be "rewrite your
 * interface as a type alias", which teaches nothing about serialization. The
 * constraint is enforced where it can be enforced exactly, at the boundary the
 * value actually crosses.
 */
export type JsonObject = { readonly [key: string]: JsonValue };

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
/**
 * @experimental Where a plugin's admin surfaces appear in the sidebar.
 *
 * A closed vocabulary rather than a free string, so a typo is a compile error
 * instead of a page that quietly appears nowhere. `"standalone"` gives the
 * plugin its own top-level entry, drawn with the icon it declares in
 * `contributes.admin.appearance`.
 *
 * Omitting it is the common case and is not the same as choosing a default:
 * an absent value defers to the plugin's own `placement`, so a plugin that has
 * already said where it lives does not repeat itself per page.
 */
export type PluginNavSection =
  | "dashboard"
  | "collections"
  | "singles"
  | "media"
  | "plugins"
  | "settings"
  | "standalone";

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
  /**
   * @experimental Which sidebar section lists this item. Defers to the
   * plugin's own `placement` when omitted.
   */
  section?: PluginNavSection;
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
  /**
   * @experimental Which sidebar section is selected while this page is open.
   * Defers to the plugin's own `placement` when omitted.
   *
   * The page's URL is namespaced under the plugin, so without this the rail
   * could only ever say "Plugins" — a plugin that lives under Settings would
   * have its collections there and its pages elsewhere.
   */
  section?: PluginNavSection;
}

/**
 * The archetypes core draws ITSELF.
 *
 * `custom` is excluded by definition: it is the archetype that means "the
 * plugin draws its own body", so it is the one that cannot describe a
 * host-drawn card.
 *
 * DERIVED from the two vocabularies in `domains/widgets/definition` rather than
 * spelled as `Exclude<WidgetArchetype, "custom">`. That spelling looks
 * equivalent and is not: it flattens a distinction core makes and this contract
 * has to honour, since `text` and `actions` are drawn with NO query and the
 * registry validator REFUSES one on them. Restating the rule here got it
 * backwards and made those two undeclarable.
 */
export type DeclarativeWidgetArchetype =
  | DataWidgetArchetype
  | QuerylessWidgetArchetype;

/** Everything a contributed widget may carry whichever way it is drawn. */
interface PluginAdminWidgetBase {
  id: string;
  /** Column span the current grid honours: `half` spans 6 of 12, `full` spans 12. */
  size?: "full" | "half";
  requiredPermission?: PermissionSlug;
  title?: string;
  description?: string;
  icon?: string;
  category?: string;
  defaultSize?: WidgetSize;
  minSize?: WidgetSize;
  maxSize?: WidgetSize;
  link?: { label: string; href: string };
  /**
   * Where this widget sits by default, ascending; omitted means "after
   * everything that states one".
   *
   * On the BASE because position is not an archetype's business -- any widget
   * may state one, and a plugin that could not would sit wherever the
   * resolver's channel ordering happened to leave it.
   */
  defaultOrder?: number;
}

/**
 * @experimental A widget the PLUGIN draws, by shipping a component.
 *
 * The archetype is optional here and unconstrained: a widget may ship a
 * component AND name a data archetype, which is how it supplies a body for an
 * archetype this admin release cannot draw yet. `WidgetDefinition` forbids that
 * pairing on the registry side and this contract deliberately allows it -- a
 * registered definition is complete by construction, while a contribution
 * crosses a version boundary and may be describing a card for a core that has
 * not shipped the renderer.
 */
interface PluginAdminCustomWidgetBase extends PluginAdminWidgetBase {
  /** Component rendered for this widget. */
  component: ComponentPath;
  /** Still executed server-side, and handed to the component as its slot. */
  query?: WidgetQuery;
}

/**
 * @experimental A widget that ships its own component.
 *
 * `archetype` stays open because a component is also the FALLBACK body for an
 * archetype this admin release cannot draw -- `{ component, archetype: "metric" }`
 * with no query is a real declaration, and core reports that card as undrawable
 * so the component is what renders.
 *
 * `chrome` is the part that cannot stay open. It is split across two
 * alternatives so `"none"` is only WRITABLE where it is legal: a widget that
 * declines the frame must supply the surface itself, and for every archetype
 * core draws the card IS the surface the body is composed against -- it owns
 * the title, the footer and the busy state. Expressed as a constraint rather
 * than left to `validateChrome`, which still refuses the pair at boot: a type
 * that permits it makes the runtime refusal the FIRST time an author learns,
 * after the plugin ships.
 */
export type PluginAdminCustomWidget = PluginAdminCustomWidgetBase &
  (
    | { archetype?: "custom"; chrome?: WidgetChrome }
    | { archetype: Exclude<WidgetArchetype, "custom">; chrome?: never }
  );

/**
 * @experimental A widget the HOST draws from a query result.
 *
 * The pair is the unit: core fills a `metric`, `table` or `list` FROM that
 * result, so one declared without a query describes a card core can never fill
 * -- no request is made for it, no slot ever arrives, and the grid reads that
 * absence as still loading for the life of the page.
 */
export interface PluginAdminDataWidget extends PluginAdminWidgetBase {
  archetype: DataWidgetArchetype;
  /** The widget's data request, validated and executed server-side. */
  query: WidgetQuery;
  /**
   * Optional FALLBACK body, for an archetype this admin release cannot draw
   * yet. Omit it and the card says so by name.
   */
  component?: ComponentPath;
}

/**
 * @experimental A widget the HOST draws from its declared prose.
 *
 * No query -- the registry validator refuses one -- and no actions, which
 * belong to the archetype named for them.
 */
export interface PluginAdminTextWidget extends PluginAdminWidgetBase {
  archetype: "text";
  query?: never;
  actions?: never;
  /**
   * Optional FALLBACK body, for an archetype this admin release cannot draw
   * yet. Omit it and the card says so by name.
   */
  component?: ComponentPath;
}

/**
 * @experimental A widget the HOST draws as a card of shortcuts.
 *
 * `actions` is REQUIRED, because the widget is its list: one declaring none
 * describes an empty card. Split from `text` rather than left optional on a
 * shared queryless shape, so both mistakes fail where they are written --
 * `{ archetype: "actions" }` with no shortcuts, and `{ archetype: "text" }`
 * carrying some. Optional on one shape made the first a boot failure and let
 * the second pass boot and silently drop what it declared.
 */
export interface PluginAdminActionsWidget extends PluginAdminWidgetBase {
  archetype: "actions";
  query?: never;
  actions: WidgetAction[];
  /**
   * Optional FALLBACK body, for an archetype this admin release cannot draw
   * yet. Omit it and the card says so by name.
   */
  component?: ComponentPath;
}

/**
 * The queryless archetypes NO arm above covers -- `never` while all are armed.
 *
 * The arms ENUMERATE because each carries a different payload -- prose for one,
 * shortcuts for the other -- so they cannot be derived from the vocabulary the
 * way `DeclarativeWidgetArchetype` is. Adding a third queryless archetype to
 * core must therefore be a decision about what it carries, and this type is
 * what makes skipping that decision observable.
 *
 * Exported only so `__tests__/queryless-arms.test-d.ts` can ASSERT it is
 * `never`. This was previously stated here as
 * `type _Unused = <this> extends never ? true : never`, which enforced nothing:
 * a standalone alias resolving to `never` is a perfectly valid unused alias and
 * `tsc` reports no diagnostic for it, so the guard passed with an unarmed
 * archetype present. Only an assertion the checker EVALUATES separates the two.
 */
export type UnarmedQuerylessArchetype = Exclude<
  QuerylessWidgetArchetype,
  PluginAdminTextWidget["archetype"] | PluginAdminActionsWidget["archetype"]
>;

/** @experimental A widget the HOST draws without asking for data. */
export type PluginAdminQuerylessWidget =
  | PluginAdminTextWidget
  | PluginAdminActionsWidget;

/** @experimental Either shape of a widget the host draws. */
export type PluginAdminDeclarativeWidget =
  | PluginAdminDataWidget
  | PluginAdminQuerylessWidget;

/**
 * @experimental A plugin-contributed dashboard widget, drawn one of two ways.
 *
 * A union rather than one interface with everything optional, because "either a
 * component, or an archetype and a query" is the actual rule and an interface
 * cannot say it. Spelling it as optional fields would accept `{ id }` -- a
 * widget describing no body at all -- at the type level and leave the boot
 * check as the only thing that ever said so.
 *
 * `component` was REQUIRED on every widget until this release, and the reason
 * it was is worth recording because it stopped being true rather than being
 * wrong. `PluginWidgetGrid` was the only consumer, it rendered
 * `PluginSlot path={widget.component}` and nothing else, so a widget declaring
 * an archetype and no component drew an empty cell: accepted everywhere,
 * rendering nothing, reporting nothing. This contract said the requirement
 * would become conditional "when that grid exists and can draw a widget from
 * its archetype alone". `WidgetGrid` now does exactly that, draws `metric` from
 * a query, and names any archetype it cannot draw yet -- and the grid that
 * required a component has since been deleted. The consumer is behind the
 * change rather than ahead of it.
 *
 * Both arms allow `component`, so every existing `{ id, component, size }`
 * declaration keeps compiling untouched. What the union adds is the second
 * route, not a constraint on the first.
 *
 * `size` is the sizing the grid reads when a widget declares no `defaultSize`;
 * `defaultSize` is the enum and wins where both appear, because a plugin that
 * adopted the newer field meant it.
 *
 * `requiredPermission` decides whether the CARD renders. It does NOT constrain
 * the rows a widget's query returns -- the query executor enforces that, and
 * it is not optional there.
 */
export type PluginAdminWidget =
  | PluginAdminCustomWidget
  | PluginAdminDeclarativeWidget;

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
 * Consumed: `menu`, `pages` + `settings`, `views`, `widgets`.
 * `widgets` is consumed twice over: the admin grid draws the card and the
 * server validates and executes `query`. `component` is CONDITIONAL -- required
 * only for a widget the plugin draws itself -- because that archetype-driven
 * grid now exists (see `PluginAdminWidget`).
 */
export interface PluginAdminContributions {
  /** Sidebar navigation entries. */
  menu?: PluginMenuItem[];
  /** Custom admin pages, namespaced + RBAC-gated. */
  pages?: PluginAdminPage[];
  /** Plugin settings UI rendered at `/admin/plugins/<slug>`. */
  settings?: { component: ComponentPath };
  /**
   * @experimental Dashboard widgets — rendered by `WidgetGrid` on the admin
   * dashboard, permission-gated. Graduates per D55.
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
  /**
   * @experimental Configuration this plugin's own admin components need,
   * delivered to the browser through `/api/admin-meta`.
   *
   * A plugin's factory runs where the host builds its config — on the server,
   * at startup. Its admin components run in the browser, and nothing otherwise
   * connects the two: a module-level variable is set in the wrong process, and
   * the edit-view props are core's contract rather than the plugin's. Without
   * this a plugin can ship behaviour it cannot configure, which is how the page
   * builder's canvas came to enforce an empty allowlist while the rendered page
   * enforced the host's.
   *
   * ## This is PUBLIC
   *
   * `/api/admin-meta` requires no authentication — the login screen reads its
   * branding from it before anyone has signed in — so this is served to
   * ANONYMOUS callers, not merely to every admin. It is the wrong place for
   * API keys, tokens, internal hostnames, licence state, or anything whose
   * value depends on who is asking. Put those behind a route that can check
   * the caller.
   *
   * The test to apply: would you paste this into a public issue? If not, it
   * does not belong here.
   *
   * ## It must be JSON
   *
   * Functions, class instances, `Date`s and `Map`s do not survive the trip, and
   * a value that silently changes shape between the server and the client is
   * worse than one that is rejected — so the serializer refuses anything that
   * does not survive a round trip, naming the plugin, rather than emitting a
   * mangled copy. That is the same reason `PluginMenuItem` takes no
   * `visible(ctx)` callback.
   *
   * Typed as `object` on purpose, which is as loose as it can usefully be
   * while still refusing a primitive. TypeScript cannot say
   * "JSON-serializable" in a way an ordinary `interface` satisfies —
   * an interface has no implicit index signature, so even
   * `Record<string, unknown>` rejects one — and a type that rejects correct
   * config teaches the author about index signatures instead of about
   * serialization. The exact check belongs at the boundary the value crosses,
   * where it can be exact. {@link JsonObject} is exported for authors who want
   * to state their own shape precisely.
   */
  clientConfig?: object;
}
