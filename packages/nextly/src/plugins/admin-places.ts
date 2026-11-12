/**
 * The places on admin pages a plugin may add to, and how a place is named.
 *
 * Its own module, with no imports, so the admin's browser bundle can read the
 * same catalogue the server checks plugins against, as `plugin-slug.ts` is for
 * the same reason. A place is a name in a contract between a page and the
 * plugins that extend it. The server refuses a plugin declaring one outside
 * its namespace; a contribution naming one that does not exist is refused
 * through `assertPlacesExist`, and the admin is to render a place's
 * contributions where the page puts it.
 *
 * @module nextly/plugins/admin-places
 * @experimental
 */

/**
 * @experimental The kinds of contribution a plugin may declare at an admin
 * place: a block of its own drawing, a tab, a list column, an action on one
 * row or on the selected rows, and a section of the edit page's side panel.
 */
export const ADMIN_CONTRIBUTION_KINDS = Object.freeze([
  "block",
  "tab",
  "column",
  "rowAction",
  "bulkAction",
  "sidebarSection",
] as const);

/** @experimental One kind of contribution; see {@link ADMIN_CONTRIBUTION_KINDS}. */
export type AdminContributionKind = (typeof ADMIN_CONTRIBUTION_KINDS)[number];

/**
 * The edit page's side panel, as both editors draw it: its built-in sections,
 * in order, which a contribution may be placed beside or replace.
 */
const EDIT_PANEL_SECTIONS = Object.freeze([
  "status",
  "publishing",
  "language",
  "details",
] as const);

/**
 * The edit page's own blocks, as both editors draw them: the document bar with
 * the banners under it, then the editor, which is the form's notices and the
 * row of the field column and the side panel.
 */
const EDIT_PAGE_BLOCKS = Object.freeze(["document-bar", "editor"] as const);

/**
 * @experimental Core's admin places, keyed by id: one for each page a plugin
 * may add to, and the entry form, which is part of a collection entry's and a
 * Single's edit pages.
 *
 * Where within its place a contribution appears is said by what it is (a
 * block, a tab, a column, an action) and its order, not by its place. Each
 * place says which kinds it `accepts`, and names its `builtIns`, by kind: the
 * parts the page draws itself that a contribution may be ordered beside or
 * replace. A built-in is named here only once the page draws it under that
 * name, so a replacement always has something to replace. A place may also
 * name, by kind, built-ins that are `notReplaceable`: a contribution may be
 * ordered beside them, never take their place.
 * Frozen, so no code can add a core place at run time that the type of
 * {@link AdminPlaceId} does not know.
 */
export const CORE_ADMIN_PLACES = Object.freeze({
  dashboard: Object.freeze({
    page: "dashboard",
    accepts: Object.freeze(["block"] as const),
    // The welcome header, then the grid of cards. A block placed by nothing
    // goes after the grid; one `before: "widgets"` goes between the two.
    builtIns: Object.freeze({
      block: Object.freeze(["welcome", "widgets"] as const),
    }),
    // The grid is each person's own arrangement of their cards, so a plugin
    // draws beside it, never in its place.
    notReplaceable: Object.freeze({
      block: Object.freeze(["widgets"] as const),
    }),
  }),
  "collection.list": Object.freeze({
    page: "a collection's entry list",
    accepts: Object.freeze([
      "block",
      "column",
      "rowAction",
      "bulkAction",
    ] as const),
    // The list page's own header, and the list itself.
    builtIns: Object.freeze({
      block: Object.freeze(["toolbar", "table"] as const),
    }),
  }),
  "collection.edit": Object.freeze({
    page: "a collection entry's edit page",
    accepts: Object.freeze(["block", "tab", "sidebarSection"] as const),
    builtIns: Object.freeze({
      block: EDIT_PAGE_BLOCKS,
      sidebarSection: EDIT_PANEL_SECTIONS,
    }),
  }),
  "single.edit": Object.freeze({
    page: "a Single's edit page",
    accepts: Object.freeze(["block", "tab", "sidebarSection"] as const),
    builtIns: Object.freeze({
      block: EDIT_PAGE_BLOCKS,
      sidebarSection: EDIT_PANEL_SECTIONS,
    }),
  }),
  "entry.form": Object.freeze({
    page: "the entry form, on a collection entry's or a Single's edit page",
    accepts: Object.freeze(["block"] as const),
    // The form's own fields, as both editors draw them.
    builtIns: Object.freeze({ block: Object.freeze(["fields"] as const) }),
  }),
  settings: Object.freeze({
    page: "settings",
    accepts: Object.freeze(["block", "tab"] as const),
    // The general settings page's own form.
    builtIns: Object.freeze({ block: Object.freeze(["content"] as const) }),
  }),
  "user.detail": Object.freeze({
    page: "a user's detail page",
    accepts: Object.freeze(["block", "tab"] as const),
    // The page's own card: the avatar and the user's details form.
    builtIns: Object.freeze({ block: Object.freeze(["content"] as const) }),
  }),
  account: Object.freeze({
    page: "the signed-in admin's account page",
    accepts: Object.freeze(["block", "tab"] as const),
    // The page's own card: the person's name, avatar and email.
    builtIns: Object.freeze({ block: Object.freeze(["profile"] as const) }),
  }),
  login: Object.freeze({
    page: "the login page",
    accepts: Object.freeze(["block"] as const),
    // The sign-in form itself.
    builtIns: Object.freeze({ block: Object.freeze(["form"] as const) }),
  }),
} as const);

/**
 * @experimental Whether `place` is one of core's admin places, and not one a
 * plugin declared. A plugin's place is in {@link AdminPlaceId} once the plugin
 * types it, so a lookup in {@link CORE_ADMIN_PLACES} asks this first rather
 * than indexing the core list with an id it may not hold.
 */
export function isCoreAdminPlace(place: string): place is CoreAdminPlaceId {
  return Object.prototype.hasOwnProperty.call(CORE_ADMIN_PLACES, place);
}

/**
 * @experimental The built-in parts of one kind at a core place, in the order
 * the page draws them, or none.
 */
export function coreAdminPlaceBuiltIns(
  place: string,
  kind: AdminContributionKind
): readonly string[] {
  if (!isCoreAdminPlace(place)) return [];
  const builtIns: Partial<Record<AdminContributionKind, readonly string[]>> =
    CORE_ADMIN_PLACES[place].builtIns;
  return builtIns[kind] ?? [];
}

/**
 * @experimental The built-in parts of one kind at a core place that a
 * contribution may be ordered beside but may not replace, or none.
 */
export function coreAdminPlaceNotReplaceable(
  place: string,
  kind: AdminContributionKind
): readonly string[] {
  if (!isCoreAdminPlace(place)) return [];
  const entry = CORE_ADMIN_PLACES[place];
  if (!("notReplaceable" in entry)) return [];
  const kept: Partial<Record<AdminContributionKind, readonly string[]>> =
    entry.notReplaceable;
  return kept[kind] ?? [];
}

/** @experimental The id of one of core's admin places. */
export type CoreAdminPlaceId = keyof typeof CORE_ADMIN_PLACES;

/**
 * @experimental Every admin place, by id, with the context its page hands what
 * is contributed there.
 *
 * Core's places are listed here. A plugin that declares places of its own in
 * `contributes.admin.places` types them by augmenting this interface from the
 * module it installs:
 *
 * ```ts
 * declare module "@nextlyhq/plugin-sdk" {
 *   interface AdminPlaces {
 *     "acme-billing.invoice": { context: { invoiceId: string } };
 *   }
 * }
 * ```
 *
 * A core context names ids only, the signed-in admin's among them, so the
 * same type holds on the server, which checks contributions, and in the
 * browser, which renders them.
 */
export interface AdminPlaces {
  dashboard: { context: { userId: string } };
  "collection.list": { context: { userId: string; collection: string } };
  /** `entryId` is null while a new entry is being created. */
  "collection.edit": {
    context: { userId: string; collection: string; entryId: string | null };
  };
  "single.edit": { context: { userId: string; single: string } };
  /** Which kind of document the form edits, and which document. */
  "entry.form": {
    context: {
      userId: string;
      kind: "collection" | "single";
      slug: string;
      entryId: string | null;
    };
  };
  settings: { context: { userId: string } };
  /** `shownUserId` is the user the page shows, `userId` the one viewing it. */
  "user.detail": { context: { userId: string; shownUserId: string } };
  account: { context: { userId: string } };
  /** Nobody has signed in yet. */
  login: { context: Record<string, never> };
}

/**
 * @experimental The id of an admin place: one of core's, or one a plugin
 * declared and typed by augmenting {@link AdminPlaces}.
 *
 * A closed set rather than any string, so a misspelled place does not
 * compile, instead of being refused when the app starts.
 */
export type AdminPlaceId = Extract<keyof AdminPlaces, string>;

/**
 * One segment of a place name: lower-case letters and digits, in runs joined
 * by single dashes. A plugin's slug is spelled the same way, so a plugin's
 * place begins with a valid segment.
 */
const SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PLACE_NAME = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);

/**
 * @experimental Whether `name` is spelled as a place name may be: segments of
 * lower-case letters, digits and single inner dashes, joined by dots.
 */
export function isWellFormedAdminPlaceName(name: string): boolean {
  return PLACE_NAME.test(name);
}

/**
 * @experimental The first segment of a place name: core's page, or the slug of
 * the plugin whose namespace the place is in.
 */
export function adminPlaceNamespaceOf(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

/**
 * The first segments core's places sit under, derived from the catalogue so a
 * place core adds reserves its segment the day it is added.
 */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(
  Object.keys(CORE_ADMIN_PLACES).map(adminPlaceNamespaceOf)
);

/**
 * @experimental The segment core reserves that a place name begins with, or
 * `undefined` when it begins with none.
 *
 * The whole first segment, so `collections.list` and `user-tools.panel` are
 * not core's though they begin like `collection` and `user`.
 */
export function reservedAdminPlaceSegmentOf(name: string): string | undefined {
  const segment = adminPlaceNamespaceOf(name);
  return RESERVED_SEGMENTS.has(segment) ? segment : undefined;
}
