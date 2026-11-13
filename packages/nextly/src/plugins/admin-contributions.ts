import type { WhereFilter } from "../domains/collections/query/query-operators";

import type { AdminContributionKind, AdminPlaceId } from "./admin-places";
import type { PermissionSlug } from "./contributions";
import type { PluginRoutePermissionResolver } from "./routes/route-permission";
import type { PluginRouteMount, RouteMethod } from "./routes/route-types";
import type { RowPredicate } from "./row-predicate";

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
 * @experimental Where a plugin's own item goes:
 *
 * - `"bar"`, the top bar's right end, on every page (the default);
 * - `"rail-foot"`, the icon rail's foot, just above the Inbox;
 * - `"menu"`, the person's menu, under "Help and community".
 *
 * The bar and the rail's foot take a component and keep it mounted for as long
 * as the bar is, so it may draw nothing and only register what a page needs.
 * The menu takes a declared item instead, because a closed menu's contents are
 * not mounted.
 */
export type PluginItemPlace = "bar" | "rail-foot" | "menu";

interface PluginUserMenuItemBase {
  /** The item's text. */
  label: string;
  /** Lucide icon name from the admin's icon set, e.g. `"BookOpen"`. */
  icon: string;
}

/**
 * @experimental An item in the person's menu that goes somewhere: an admin
 * path (`"/admin/plugins/acme-support"`) opens in place, and an absolute URL
 * (`"https://example.com/help"`) opens in a new tab.
 */
export interface PluginUserMenuLink extends PluginUserMenuItemBase {
  to: string;
  action?: never;
}

/**
 * @experimental An item in the person's menu that does something: opens one of
 * the plugin's components in a dialog, or calls one of the plugin's routes
 * with no rows.
 */
export interface PluginUserMenuAction extends PluginUserMenuItemBase {
  action: AdminContributionAction;
  to?: never;
}

/**
 * @experimental A declared item in the person's menu: a label, an icon, and
 * either a link (`to`) or an action, never both.
 */
export type PluginUserMenuItem = PluginUserMenuLink | PluginUserMenuAction;

/** What every header contribution may carry, wherever its own item goes. */
interface PluginHeaderHideOptions {
  /** Hide all built-in header buttons (github, discord, docs, notifications). */
  hideDefaults?: boolean;
  /** Hide specific built-in header buttons. */
  hide?: HeaderButtonId[];
}

/**
 * @experimental A header contribution whose own item, if any, is a component
 * drawn at the bar's right end (the default) or at the rail's foot.
 */
export interface PluginHeaderSlotContributions extends PluginHeaderHideOptions {
  /** Component kept mounted at `place` for as long as the top bar is. */
  slot?: ComponentPath;
  /** Where `slot` is drawn; the bar's right end when absent. */
  place?: "bar" | "rail-foot";
  item?: never;
}

/**
 * @experimental A header contribution whose own item is a declared entry in
 * the person's menu. It takes no component: the menu's contents are mounted
 * only while it is open.
 */
export interface PluginHeaderUserMenuContributions
  extends PluginHeaderHideOptions {
  place: "menu";
  /** The entry drawn under "Help and community" while the menu is open. */
  item: PluginUserMenuItem;
  slot?: never;
}

/**
 * @public Header customization contributed by a plugin.
 *
 * `slot` adds a component to the header (supersedes the deprecated top-level
 * `headerSlot`), drawn where `place` says. With `place: "menu"` the plugin
 * declares an `item` for the person's menu instead of a component.
 * `hideDefaults` / `hide` remove built-in buttons, wherever the plugin's own
 * item goes; hiding is subtractive and **union-merged** across enabled plugins
 * (a button is hidden if ANY enabled plugin hides it).
 */
export type PluginHeaderContributions =
  | PluginHeaderSlotContributions
  | PluginHeaderUserMenuContributions;

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

/**
 * @experimental A heading in a standalone plugin's own panel, which the items
 * naming it as their `group` are listed under: see
 * `PluginAdminContributions.panel`.
 */
export interface PluginPanelGroup {
  /** What an item's `group` names it by; unique within the plugin. */
  id: string;
  /** The heading drawn above the group's items. */
  label: string;
}

/**
 * @experimental How a standalone plugin's own panel lists its menu items.
 */
export interface PluginAdminPanel {
  /**
   * The panel's headings, drawn in this order, each above the items naming it
   * as their `group`. Items naming no group are listed first, under no
   * heading, and a heading with no item the reader may see is not drawn.
   */
  groups: ReadonlyArray<PluginPanelGroup>;
}

/**
 * @experimental The number a panel item shows beside its label, read for the
 * person looking at the panel, in one of two forms:
 *
 * - `{ collection, where? }`: how many entries of one of this plugin's own
 *   collections, named by its declared slug (a host's rename is followed),
 *   the reader may read, narrowed by `where` when given.
 * - `{ attention }`: the count of one of this plugin's own dashboard
 *   attention items (`contributes.dashboard.attention`), by its id, as the
 *   reader's Needs your attention card counts it. An item with nothing
 *   waiting for the reader counts 0.
 *
 * A count naming a collection the plugin does not contribute, or an attention
 * item it does not declare, is left out, and a development start says so. A
 * count that cannot be read draws no number.
 */
export type PluginItemCount =
  | {
      /** The declared slug of one of this plugin's own collections. */
      collection: string;
      /** Narrows the entries counted, in the entry list's `where` grammar. */
      where?: WhereFilter;
      attention?: never;
    }
  | {
      /** The id of one of this plugin's own dashboard attention items. */
      attention: string;
      collection?: never;
      where?: never;
    };

/**
 * A menu item takes a quiet count or an attention badge, never both: one
 * number beside one label.
 */
type PluginMenuItemNumber =
  | {
      /**
       * @experimental A quiet number beside the item's label, shown at 0 too:
       * how many there are. Drawn in the plugin's own standalone panel, on a
       * top-level item.
       */
      count?: PluginItemCount;
      badge?: never;
    }
  | {
      /**
       * @experimental A pill beside the item's label, shown only while its
       * number is above 0: how many need doing. Drawn in the plugin's own
       * standalone panel, on a top-level item.
       */
      badge?: PluginItemCount;
      count?: never;
    };

/**
 * @public A sidebar navigation entry contributed by a plugin.
 *
 * Declarative and introspectable — delivered to the client via `/api/admin-meta`.
 * Exactly **one** level of `children` is supported. Visibility is controlled by
 * `requiredPermission` (client-gated via `useCan`); a `visible(ctx)` callback is
 * intentionally NOT supported because menus are serialized to the client.
 *
 * Its fields are `PluginMenuItemFields`, and it takes one `count` or one
 * `badge`, never both.
 */
export type PluginMenuItem = PluginMenuItemFields & PluginMenuItemNumber;

/** The fields of a `PluginMenuItem`, apart from its number. */
export interface PluginMenuItemFields {
  /** Display label. */
  label: string;
  /** Admin path to navigate to, e.g. `"/admin/collections/forms"`. */
  to: string;
  /**
   * The DECLARED slug of one of this plugin's own collections, when the item
   * points at that collection's list.
   *
   * An integrator may `.rename({ forms: "contact-forms" })`, and the schema
   * then registers only the renamed collection and seeds only its
   * permissions. An item that spelled the declared slug into `to` would send
   * every reader to a list that does not exist, and one that spelled it into
   * `requiredPermission` would be withheld from the readers who hold the
   * permission that WAS seeded. Naming the collection instead lets
   * `buildPluginAdminMeta` re-derive both from the slug the host actually
   * registered.
   *
   * `to` stays required, and stays the item's destination when nothing is
   * renamed. Both are written from one slug constant at the declaration site,
   * so they cannot say different things.
   *
   * Declaring this also gates the item on being able to READ that collection,
   * because an item pointing at a list is worth offering only to someone the
   * list will open for. An item that must carry no gate omits `collection`
   * and writes its own `to`.
   *
   * Resolved away during serialization: the admin receives `to` and
   * `requiredPermission` already carrying the resolved slug, and never sees
   * this field.
   */
  collection?: string;
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
  /**
   * @experimental The id of one of `panel.groups`, the heading the item is
   * listed under in the plugin's own standalone panel. An item naming none is
   * listed first, under no heading; one naming a group the plugin does not
   * declare is listed with those, and a development start says so.
   */
  group?: string;
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
  /**
   * @experimental The reads of this plugin's own routes the page makes as it
   * opens, each named as the page's `usePluginRoute` names it (`path`, and
   * `mount` where the route is mounted at the root). Where this page is the
   * first screen a tab opens, the admin asks for them inside its startup
   * request, so the page's data is on its way in the same round as the
   * session and the menu, and the page's own read takes that answer instead
   * of asking again.
   *
   * Each read keeps its route's own permission check, and one the reader may
   * not make is refused on its own: the page then reads it as it always
   * would. The startup answer waits for its slowest part, so name only the
   * quick reads a page needs first, never a count or a report. At most four
   * (`MAX_PAGE_STARTUP_READS`); boot refuses more, or a path the startup
   * request cannot carry.
   *
   * Plain paths rather than a function of the page's address: a plugin page
   * is matched by its exact address, and the prebuilt admin page carries
   * these when it is built, before any code of the plugin's runs.
   */
  startupReads?: readonly PluginPageStartupRead[];
}

/**
 * @experimental One read a plugin page makes as it opens: a route of the
 * plugin's own, named as `usePluginRoute` names it.
 */
export interface PluginPageStartupRead {
  /** The route's path within the plugin's namespace, starting with `/`. */
  path: string;
  /** Where the route answers: its plugin's namespace (the default) or the root. */
  mount?: PluginRouteMount;
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
  /**
   * @experimental Full-screen views of one document, each at its own address
   * under the document's: `/admin/collections/<slug>/<id>/<path>`, or
   * `/admin/singles/<slug>/<path>` for a Single.
   */
  documentViews?: PluginDocumentView[];
  /**
   * @experimental Hide or replace a built-in action in this collection's
   * document screen ("…" menu), for this collection only: see
   * `PluginDocumentActionOverride`. Two plugins overriding one action on one
   * collection are refused at boot.
   */
  documentActions?: PluginDocumentActionOverrides;
  /**
   * @experimental Sections added to this collection's document panel, after
   * Details, in the order given: see `PluginPanelSection`.
   */
  panelSections?: PluginPanelSection[];
}

/**
 * The built-in document actions a plugin may hide or replace, as the one list
 * the boot check, the admin and the type below all read. More may join here,
 * and only here: the union is derived from this list, so a plugin cannot
 * compile against an action the boot check would refuse.
 */
export const OVERRIDABLE_DOCUMENT_ACTIONS = ["delete", "unpublish"] as const;

/**
 * @experimental The built-in document actions a plugin may hide or replace.
 * More may join; a plugin naming one this version does not know is refused
 * at boot rather than silently ignored.
 */
export type OverridableDocumentAction =
  (typeof OVERRIDABLE_DOCUMENT_ACTIONS)[number];

/**
 * @experimental What a plugin does with one built-in document action.
 *
 * - `"hidden"`: the action is not offered on this collection's documents,
 *   from the menu or from `useDocumentActions().run`.
 * - `{ component }`: the action keeps its row — its place, the permission it
 *   needs, and every reason it can't run (a colleague's lock, a past version
 *   on screen) — and choosing it opens the plugin's component instead of the
 *   built-in write. The component receives `DocumentActionReplacementProps`.
 *   `label` renames the row ("Remove layout…").
 */
export type PluginDocumentActionOverride =
  | "hidden"
  | { component: ComponentPath; label?: string };

/** @experimental A plugin's overrides for one collection, by action. */
export type PluginDocumentActionOverrides = Partial<
  Record<OverridableDocumentAction, PluginDocumentActionOverride>
>;

/**
 * @experimental A section a plugin adds to a collection's document panel,
 * drawn after Details. The admin draws the heading and the section's frame,
 * as it does the built-in sections, so it reads as part of the panel in
 * light and dark; the component draws the body and receives
 * `DocumentPanelSectionProps`. Not drawn while a document is being created.
 */
export interface PluginPanelSection {
  /** The section's heading. */
  title: string;
  /** What the section shows under it. */
  component: ComponentPath;
}

/**
 * @experimental A full-screen view of one document, contributed by a plugin.
 *
 * The admin keeps the document's own machinery around it: it loads the
 * document, holds its soft lock, offers recovered unsaved work, asks before
 * leaving with unsaved changes, and saves through the same actions the edit
 * form uses. The view draws what it shows the author and nothing else, so a
 * plugin never re-implements any of those.
 *
 * Refused at boot when its path is malformed, names one the document already
 * uses (`versions`, `api`), or is claimed twice on one document.
 */
export interface PluginDocumentView {
  /**
   * The address segment after the document's own, in lowercase letters,
   * digits and single dashes: `builder` gives `/admin/collections/pages/<id>/builder`.
   */
  path: string;
  /** The view itself. */
  component: ComponentPath;
  /** What the admin calls the view where it offers a way in. */
  label?: string;
}

/**
 * @experimental A document view offered on every collection and Single that
 * has a field of one type, at the top level or inside named groups at any
 * depth, wherever that type is used — including
 * collections created in the Schema Builder after boot, which no list of slugs
 * could name.
 *
 * A plugin may scope a view only to a field type it contributes itself (boot
 * refuses any other), so no plugin can add a screen to every document that has,
 * say, a text field. A field inside a repeater does not count: a row is
 * addressed by its position, which names another row once the rows are
 * reordered.
 *
 * Which documents carry the field is not known at boot, so the path must be
 * unique among every document view any plugin declares.
 */
export interface PluginFieldTypeDocumentView extends PluginDocumentView {
  /** The field type, one of this plugin's own `contributes.fieldTypes`. */
  fieldType: string;
}

/**
 * @experimental One choice of a plugin's entry-list filter: what the admin
 * shows, the value the page's URL keeps, and the `where` it narrows the list
 * by when chosen.
 */
export interface PluginListFilterOption {
  /** Kept in the URL: lower-case letters, digits and single dashes. */
  value: string;
  label: string;
  /**
   * Added to the list's own `where`, so it can only narrow the rows the
   * caller may already list.
   */
  where: WhereFilter;
}

/**
 * @experimental A filter a plugin adds to the entry list's toolbar: see
 * `PluginAdminContributions.filters`.
 */
export interface PluginListFilterDeclaration {
  /** `<plugin-slug>.<name>`, e.g. `"acme-support.state"`. */
  name: string;
  label: string;
  /** The collections whose lists offer it, by slug; every collection's when absent. */
  collections?: string[];
  options: PluginListFilterOption[];
}

/**
 * @experimental One place a plugin declares on its own admin pages, under its
 * namespace: see `PluginAdminContributions.places`.
 */
export interface PluginAdminPlaceDeclaration {
  /** `<plugin-slug>.<name>`, e.g. `"acme-billing.invoice"`. */
  name: string;
  /** What the place is for, for the authors of plugins that add to it. */
  description?: string;
  /** The kinds of contribution the place takes; blocks alone when absent. */
  accepts?: AdminContributionKind[];
}

/**
 * @experimental What every contribution to an admin place says: its id, its
 * place, where it goes there, and who sees it.
 */
interface AdminContributionBase {
  /** `<plugin-slug>.<name>`, e.g. `"acme-support.sla"`; unique. */
  id: string;
  /** The place it is added to, which must take its kind. */
  place: AdminPlaceId;
  /** Lower first; 100 when absent, as the menu orders. */
  order?: number;
  /**
   * Before this contribution's id, or a built-in part's name: as close to it
   * as the other contributions' order allows, straight before it when nothing
   * competes.
   */
  before?: string;
  /**
   * After this contribution's id, or a built-in part's name: as close to it
   * as the other contributions' order allows, straight after it when nothing
   * competes.
   */
  after?: string;
  /** A built-in part of the same kind at this place, whose place it takes. */
  replaces?: string;
  /**
   * Who sees it. A reader without this permission is not sent it at all, so
   * its label and action never reach them. Not allowed on the login page,
   * where nobody has signed in.
   *
   * A fixed slug for a name that cannot move, or, for one of the plugin's own
   * collections or singles, a function of its names after the host's renames,
   * as a route's `requiredPermission` is:
   * `({ collection }) => collection("tickets", "update")`.
   */
  requiredPermission?: PermissionSlug | PluginRoutePermissionResolver;
  /**
   * On a collection entry's edit page, or an action on rows of a collection's
   * list, the entries it shows for; a Single's edit page and the entry form
   * take none yet.
   * Judged on each entry as the reader's read returned it: a field the reader
   * may not read is missing, and a rule that needs it does not match. A
   * contribution whose rule names a field the reader may not read is not sent
   * to them.
   */
  visibleWhen?: RowPredicate;
  /**
   * On a collection's list or edit page, the collections it is added to, by
   * slug; every collection's when absent.
   */
  collections?: string[];
  /**
   * On a Single's edit page, the Singles it is added to, by slug; every
   * Single's when absent.
   */
  singles?: string[];
  /**
   * @experimental On a collection's list or edit page or a Single's edit
   * page: offered only on the content types where this plugin's
   * `contributes.extend` added every one of these fields, as the latest start
   * resolved them (`typesExtendedBy`). For a plugin that extends every
   * content type, so its tab or panel follows its fields to Schema Builder
   * types and skips a type that kept a field of its own by that name.
   * Narrows `collections` and `singles` where they are also given.
   */
  extendedWith?: string[];
}

/**
 * @experimental What an action does: open one of the plugin's components with
 * the rows, or call one of the plugin's own routes with them.
 */
export type AdminContributionAction =
  | { open: ComponentPath }
  | {
      run: {
        /** A write's method: an action acts on rows. */
        method: Exclude<RouteMethod, "GET">;
        /** The route's `path`, as the plugin declares it. */
        path: string;
        /** The route's `mount`; the plugin's own, `"plugin"`, when absent. */
        mount?: PluginRouteMount;
      };
    };

/** @experimental A block the plugin draws, at any place that takes blocks. */
export interface AdminBlockContribution extends AdminContributionBase {
  kind: "block";
  component: ComponentPath;
}

/** @experimental A tab of the plugin's own on an edit or detail page. */
export interface AdminTabContribution extends AdminContributionBase {
  kind: "tab";
  label: string;
  component: ComponentPath;
  /**
   * @experimental On an edit page, the document's top-level fields this tab
   * edits. The page draws them in the tab instead of among its own content,
   * and draws the tab only on a document that has every one of them. Their
   * values stay in the document's form and are saved with it.
   */
  fields?: string[];
}

/**
 * @experimental A section of the edit page's side panel.
 *
 * On a collection entry's (`collection.edit`) and a Single's (`single.edit`)
 * edit pages the admin draws it where it is placed among the panel's own
 * sections (`status`, `publishing`, `language`, `details`), under `label` as
 * its heading, framed as they are; the component draws the body and receives
 * `SidebarSectionProps`: the place's `context` and `entry`, and on a
 * collection entry's page also every field of `DocumentPanelSectionProps`. A
 * component that draws nothing for an entry leaves no section, heading
 * included, so a section may apply to some entries and not others. Not drawn
 * while an entry is being created.
 */
export interface AdminSidebarSectionContribution extends AdminContributionBase {
  kind: "sidebarSection";
  label: string;
  component: ComponentPath;
  /**
   * @experimental Where the section is drawn when the editor is too narrow
   * to keep the panel beside the fields (a phone), and the panel opens only
   * when asked for. `"above-form"` draws it in the field column, under the
   * title and above the fields, and leaves it out of the panel there, so a
   * section an author should meet first stays on screen. Absent, it stays in
   * the panel at every width.
   */
  narrow?: "above-form";
}

/**
 * @experimental A column of a collection's entry list: a field's value, or a
 * cell the plugin draws.
 */
export type AdminColumnContribution = AdminContributionBase & {
  kind: "column";
  label: string;
} & (
    | { field: string; component?: never }
    | { component: ComponentPath; field?: never }
  );

/** @experimental An action on one row of a collection's entry list. */
export interface AdminRowActionContribution extends AdminContributionBase {
  kind: "rowAction";
  label: string;
  action: AdminContributionAction;
}

/** @experimental An action on the selected rows of a collection's entry list. */
export interface AdminBulkActionContribution extends AdminContributionBase {
  kind: "bulkAction";
  label: string;
  action: AdminContributionAction;
}

/** @experimental One declared contribution to an admin place. */
export type AdminContribution =
  | AdminBlockContribution
  | AdminTabContribution
  | AdminSidebarSectionContribution
  | AdminColumnContribution
  | AdminRowActionContribution
  | AdminBulkActionContribution;

/**
 * @public Declarative admin-UI contributions. Introspectable
 * by the host without running the plugin.
 *
 * Consumed: `menu`, `pages` + `settings`, `views`.
 *
 * Dashboard widgets are not declared here: a plugin declares each with
 * `defineWidget` under `contributes.dashboard`. Startup refuses a plugin that
 * still carries `admin.widgets`, so the older key cannot add a card silently.
 */
export interface PluginAdminContributions {
  /** Sidebar navigation entries. */
  menu?: PluginMenuItem[];
  /**
   * @experimental How a standalone plugin's own panel lists its menu items:
   * the headings they are grouped under. Without it the panel lists them as
   * it always has.
   */
  panel?: PluginAdminPanel;
  /**
   * @experimental Places of this plugin's own, on its pages, that plugins may
   * add to. Each name starts with this plugin's slug and a dot,
   * `"acme-billing.invoice"` for `@acme/billing`; the app refuses to start on
   * one outside it, under a segment core reserves, or declared by two
   * plugins. Type each by augmenting `AdminPlaces`.
   */
  places?: PluginAdminPlaceDeclaration[];
  /**
   * @experimental Filters for the entry list's toolbar. Choosing an option
   * adds its `where` to the list's request, so a filter narrows the list and
   * never widens it; the choice is kept in the page's URL. The app refuses to
   * start on one outside this plugin's namespace, declared twice, or with an
   * malformed option.
   */
  filters?: PluginListFilterDeclaration[];
  /**
   * @experimental Blocks, tabs, columns, row and bulk actions and side panel
   * sections, each added to an admin place and ordered there. Declared as
   * data, checked when the app starts, and sent to a signed-in admin only,
   * leaving out what the reader may not see.
   */
  contributions?: AdminContribution[];
  /** Custom admin pages, namespaced + RBAC-gated. */
  pages?: PluginAdminPage[];
  /** Plugin settings UI rendered at `/admin/plugins/<slug>`. */
  settings?: { component: ComponentPath };
  /** Per-collection view overrides + injection points, keyed by slug. */
  views?: Record<string, PluginCollectionView>;
  /**
   * @experimental Document views offered wherever one of this plugin's own
   * field types is used — see `PluginFieldTypeDocumentView`.
   */
  documentViews?: PluginFieldTypeDocumentView[];
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
   * @experimental Header customization: add this plugin's own item and/or
   * hide built-in buttons (`hideDefaults`/`hide`). The item is a component
   * (`slot`) at the bar's right end or, with `place: "rail-foot"`, at the
   * rail's foot above the Inbox; or, with `place: "menu"`, a declared `item`
   * in the person's menu. A slot self-gates on permission and renders inside
   * the plugin boundary.
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
