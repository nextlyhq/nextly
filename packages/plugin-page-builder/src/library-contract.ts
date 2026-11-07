/**
 * What the pattern library route answers, named where both ends can read it.
 *
 * FREE OF RUNTIME IMPORTS, deliberately, and that is the whole reason this file
 * is separate from the route that implements it. Types are the exception and
 * cost nothing — they are erased before a browser sees them — so the shapes
 * both ends must agree on can be named here without either end's runtime
 * arriving with them. The route reaches the collection through
 * `nextly/config`, which pulls the Direct API — server-only, and it says so at
 * load time. A browser module importing the route for one path constant brings
 * that with it: measured, importing it from the admin client took eleven test
 * files out at collection with "Direct API permissions module loaded in a
 * browser context".
 *
 * The same reason `nextly/config` shares `pluginAdminSlug` and
 * `pluginRouteFullPath`: a value both a server and a browser must agree on has
 * to live somewhere neither one's runtime is required to load.
 *
 * @module library-contract
 */
import type {
  BlockDocument,
  BreakpointSet,
  BuilderOp,
  ComponentDocument,
  ComponentExposure,
  PlanWarning,
  SpacingMode,
} from "@nextlyhq/blocks-engine";
import type { SavedComponent, SavedPattern } from "@nextlyhq/builder";
import type { HookWarning } from "nextly/config";

import type { RemovalDryRun } from "./breakpoint-removal/dry-run";

/**
 * The name this plugin registers under, which is also how its routes are
 * addressed.
 *
 * ONE literal, consumed by the plugin definition and by the editor that calls
 * its route. Two spellings of it is a package rename that leaves the server
 * mounted under the new name while every editor keeps asking for the old path —
 * and the failure is silent, because a request to a path nothing serves answers
 * with nothing and reads as a site that has saved no patterns.
 */
export const PAGE_BUILDER_PLUGIN_NAME = "@nextlyhq/plugin-page-builder";

/** Where the panel finds the pattern library, under this plugin's own namespace. */
export const LIBRARY_ROUTE_PATH = "/library";

/**
 * Where the editor finds the site's component definitions.
 *
 * A route of its own rather than a tier of the pattern route, for two reasons
 * that point the same way. A plugin route declares ONE permission, and the two
 * tiers are read under different grants: a role that may read components and
 * not patterns must still get its definitions, or every instance on its pages
 * draws as a placeholder. And each route answers the canonical list envelope,
 * `{ items, meta }`, which one route carrying two tiers could not without
 * inventing a shape of its own.
 *
 * The two reads are also made at different moments. The panel reads patterns
 * only while it is open; the canvas needs definitions on every editor mount,
 * and an instance renders as a placeholder without them. Reading the pattern
 * tier along with them would spend up to the whole byte ceiling to draw a
 * header.
 */
export const COMPONENT_LIBRARY_ROUTE_PATH: `${typeof LIBRARY_ROUTE_PATH}/components` = `${LIBRARY_ROUTE_PATH}/components`;

/**
 * The query parameter naming the language the component tier is read in.
 *
 * A component's document field can be localized, and the public renderer
 * reads definitions in the page's locale; the editor asks for the language
 * the surrounding document is being edited in, so the canvas draws what the
 * page will. ONE spelling, here, for the client that writes it and the route
 * that reads it — two spellings agree until one of them is renamed.
 */
export const COMPONENT_LIBRARY_LOCALE_PARAM = "locale";

/**
 * The component route's path for one language, as the client requests it.
 *
 * `null` or `undefined` is the app's default language, which the admin
 * addresses everywhere by an ABSENT `?locale=` — so the path carries no
 * parameter rather than an empty one, and the read hook's cache key, which
 * is the path, differs between languages and is shared within one.
 */
export function componentLibraryPath(
  locale: string | null | undefined
): string {
  if (locale === null || locale === undefined || locale === "") {
    return COMPONENT_LIBRARY_ROUTE_PATH;
  }
  const query = new URLSearchParams({
    [COMPONENT_LIBRARY_LOCALE_PARAM]: locale,
  });
  return `${COMPONENT_LIBRARY_ROUTE_PATH}?${query.toString()}`;
}

/**
 * Where the editor asks what the author may do with patterns.
 *
 * A route of its own rather than a field on the library response, and the
 * timing is the whole reason. The Save as pattern verb renders from the
 * toolbar's own action list before any panel exists, and the library is read
 * WHEN THE PANEL OPENS — so an answer carried on that response arrives after
 * the control it was meant to describe.
 */
export const CAPABILITY_ROUTE_PATH = "/capability";

/**
 * How much of a page one pattern covers.
 *
 * A closed set rather than free text, because it is a FACET: the browser
 * filters on it and a full-page pattern is offered as a way to start a page
 * rather than as something to insert into one. Free text would put the two
 * behaviours behind a string nobody spells the same way twice.
 *
 * Lives HERE rather than beside the collection because both ends need it and
 * only one of them may load the collection: the collection module reaches the
 * framework's field helpers, which a browser cannot import. The collection
 * reads its options from this list, so there is still one vocabulary.
 */
export const PATTERN_GRANULARITIES = [
  "element",
  "group",
  "section",
  "page",
] as const;

/** One of the granularities a pattern may declare. */
export type PatternGranularity = (typeof PATTERN_GRANULARITIES)[number];

/**
 * Whether a pattern of each granularity belongs in the INSERT list.
 *
 * A full-page pattern is a way to START a page, not something to place after
 * the block an author selected — offering one means placing a page inside the
 * page it is meant to be.
 *
 * A RECORD over the closed set rather than a comparison against the one
 * excluded value, and that is the point rather than a style choice. `!== "page"`
 * answers TRUE for everything it has never heard of: a granularity added to the
 * vocabulary becomes insertable with nobody deciding it should be, and a row
 * whose granularity is MISSING — an `afterRead` hook or a field-level read rule
 * can remove it, and the field is required so absent means removed — reads as
 * insertable too. This map has to gain an entry before the union will compile,
 * so a new granularity is a build failure until someone classifies it.
 */
const INSERTABLE_BY_GRANULARITY: Record<PatternGranularity, boolean> = {
  element: true,
  group: true,
  section: true,
  page: false,
};

/**
 * The insertable granularities as a SET, which is what a lookup may use.
 *
 * Derived from the map above rather than listed again. Indexing the record with
 * an arbitrary string would reach its PROTOTYPE — `"constructor"` answers with a
 * function, which is truthy — so the untrusted value is tested for membership
 * instead of used as a key.
 */
const INSERTABLE_GRANULARITIES: ReadonlySet<string> = new Set(
  PATTERN_GRANULARITIES.filter(value => INSERTABLE_BY_GRANULARITY[value])
);

/**
 * Whether a stored row's granularity says it may be inserted.
 *
 * Closed rather than open: anything this does not recognise — absent, a number,
 * a granularity from a newer release — is NOT insertable. The two directions
 * are not symmetric. Refusing wrongly leaves one pattern out of a list; allowing
 * wrongly puts a whole page inside the page an author is editing.
 */
export function isInsertableGranularity(value: unknown): boolean {
  return typeof value === "string" && INSERTABLE_GRANULARITIES.has(value);
}

/**
 * One pattern, as the panel needs it.
 *
 * DERIVED from `SavedPattern` — the shape the panel actually reads — rather
 * than described again here. The two were described separately once, and they
 * disagreed about one field name: the wire carried `content`, which is what the
 * collection stores it under, while `patternEntriesFrom` reads `document` and
 * SKIPS a pattern that has none. Every pattern on every site was dropped, in
 * silence, and the tier looked wired and empty. Extending the published type
 * makes that a compile error rather than a thing to notice.
 *
 * The DOCUMENT travels, which is what makes this bigger than an index. The
 * palette runs the planner's whole preflight over each pattern before offering
 * it — a stored row can be the wrong kind, hold no nodes, or nest in a way the
 * rules no longer allow — so a tile exists only for a pattern the planner would
 * actually place. A metadata-only index cannot answer that.
 */
export interface LibraryPattern extends SavedPattern {
  /**
   * How much of a page this covers.
   *
   * Known to the library and absent from `SavedPattern`, deliberately: a
   * full-page pattern is a way to START a page rather than something to insert
   * into one, so the insert list is not where it belongs. Carried here so the
   * surface that offers it can tell them apart.
   */
  readonly granularity?: string;
}

/**
 * One component definition the editor may place, with its document as the
 * editor should see it.
 *
 * DERIVED from `SavedComponent` — the shape the panel reads — for the reason
 * `LibraryPattern` derives from `SavedPattern`: described twice, the two
 * drift, and the drift compiles. Extending the published type is what makes a
 * field the panel gains and the wire never carries a compile error rather than
 * a tile missing something nobody notices.
 *
 * The document is the WORKING DRAFT where the caller may edit the component
 * and one exists, and the live row otherwise — the posture an editor wants,
 * since an author placing a component they are also editing should see what
 * they are editing. Read per id rather than from the listing, because the
 * draft overlay is reachable only through a by-id read: a listing answers with
 * live rows, and a definition built from those would render a stale component
 * beside the draft the author just saved.
 */
export interface LibraryComponent extends SavedComponent {
  /**
   * The definition, or `null` for a row saved without content.
   *
   * REQUIRED here where `SavedComponent` leaves it optional, and `null` rather
   * than omitted, so the shape says the read was made and found nothing —
   * which a missing key cannot say.
   */
  readonly document: ComponentDocument | null;
}

/**
 * What one list read from this plugin answers.
 *
 * The CANONICAL list envelope — `{ items, meta }`, the shape every list in
 * this codebase answers with — carrying one tier per route. A route inventing
 * a second vocabulary for "here is a page of rows, and whether it is all of
 * them" would be the one list a shared client could not read.
 */
export interface LibraryListResponse<TItem> {
  readonly items: readonly TItem[];
  readonly meta: {
    /** How many rows were returned. */
    readonly count: number;
    /** Whether the ceiling stopped the read before the collection ended. */
    readonly truncated: boolean;
  };
}

/** What the pattern library route answers. */
export type LibraryResponse = LibraryListResponse<LibraryPattern>;

/** What the component library route answers. */
export type ComponentLibraryResponse = LibraryListResponse<LibraryComponent>;

/**
 * Where the editor sends a selection to be stored as a pattern.
 *
 * Named for the VERB rather than for a resource, because the verbs that follow
 * it are not all creations. `Save as component` creates a definition, and
 * `Convert to component` and `Detach` also hand back ops that change the page
 * the author is editing — so a resource path would fit the first two and have
 * nothing to address for the others. One shape for the whole family is what
 * lets a reader of `contributes.routes` see them as one family.
 */
export const SAVE_PATTERN_ROUTE_PATH = "/save-as-pattern";

/**
 * The metadata a saved pattern carries, as the surface that saves it states
 * them.
 *
 * These are the `patterns` collection's own fields, and the route does not trust
 * this list at runtime: it takes the field names from the collection itself, so
 * a caller cannot reach a column the collection never declared. What this type
 * is for is the DIALOG — the surface filling the form needs to know what to ask
 * for, and it runs in a browser that cannot load the collection module.
 *
 * A type naming a source of truth it cannot track is how a contract goes quietly
 * stale, so {@link SAVE_PATTERN_FIELD_NAMES} carries these keys as a VALUE and
 * `save-pattern-contract.test.ts` compares that value against the collection's
 * declared fields.
 */
export interface SavePatternFields {
  readonly title: string;
  /**
   * The identifier the library keys this pattern by, when the caller has one.
   *
   * OPTIONAL, and the dialog does not ask for it. It is not a URL — nothing
   * resolves a pattern by slug — so it is an identity rather than an address,
   * and asking an author to type one is a second field that restates the name
   * they already gave. The route derives it from the title, which is also the
   * only place that could ever disambiguate one.
   */
  readonly slug?: string;
  readonly granularity: PatternGranularity;
  readonly description?: string;
  readonly category?: string;
  readonly keywords?: string;
}

/**
 * The keys of {@link SavePatternFields}, as a value something can compare.
 *
 * The `satisfies` is the whole point: it is checked by `tsc`, in a file the
 * package's type program actually reads, so a property added to or removed from
 * the interface fails the build here until this list moves with it. The obvious
 * place for a witness like this is the test that uses it, and in this package
 * that would not work — `tsconfig.tests.json` deliberately keeps `*.test.ts` out
 * of the program, so a `Record<keyof …>` written there is transpiled and never
 * evaluated, and the guard silently checks nothing.
 *
 * With both halves in place the drift is caught from either side: this fails to
 * compile when the interface moves, and the contract test fails when the
 * collection moves.
 */
export const SAVE_PATTERN_FIELD_NAMES = Object.keys({
  title: true,
  slug: true,
  granularity: true,
  description: true,
  category: true,
  keywords: true,
} satisfies Record<
  keyof SavePatternFields,
  true
>) as readonly (keyof SavePatternFields)[];

/**
 * What the editor sends to store a selection as a pattern.
 *
 * The DOCUMENT and the SELECTION, not a pattern the browser already built. The
 * planner decides what a saved pattern is — which nodes travel, what is
 * re-identified, which selections are refusable — and it decides it against the
 * block registry, which is not the same registry at both ends: the browser
 * registers the core blocks, while the server also holds every block another
 * plugin declared. A browser that planned the save would answer a nesting
 * question about blocks it has never heard of, and store a pattern nothing can
 * place.
 *
 * It is also the difference between a rule and a convention. A pattern posted
 * ready-made would be whatever its caller decided to send, and the guarantee the
 * insert panel leans on — that a stored pattern is one the planner would place —
 * would hold only for callers that chose to honour it.
 */
export interface SavePatternRequest {
  /** The document the selection was made in. */
  readonly document: BlockDocument;
  /** The nodes to lift out of it, in the editor's own vocabulary. */
  readonly selectedIds: readonly string[];
  readonly fields: SavePatternFields;
  /** Answer the pattern the save would store, and store nothing. */
  readonly dryRun?: boolean;
}

/**
 * What a completed save answers.
 *
 * The CANONICAL mutation envelope, which is what every other write in this
 * codebase answers with — `{ message, item }`, and `warnings` when a hook failed
 * after the row was already durable. A route inventing its own shape here would
 * make a plugin's write the one write a shared client cannot read, and the
 * warnings are the part that goes wrong quietly: a post-commit failure cannot be
 * undone, so a body that omits it reports a partial success as a whole one.
 *
 * Built by `respondMutation` rather than assembled, so it cannot drift from the
 * envelope and so the warnings come from the request's own scope rather than
 * from a second path to the same list.
 */
export interface SavePatternResponse {
  readonly message: string;
  /** The row that was created, as the collection stored it. */
  readonly item: { readonly id: string } & Record<string, unknown>;
  /** Side effects that failed after the row committed, when any did. */
  readonly warnings?: readonly HookWarning[];
}

/**
 * What a save asked as a dry run answers, inside the envelope's `item`: the
 * pattern it would store, and why the site would refuse it, empty when it
 * would not. Nothing was stored, so there is no id.
 *
 * @experimental Settles when the composition API ships.
 */
export interface SavePatternDryRun {
  readonly dryRun: true;
  readonly pattern: Readonly<Record<string, unknown>>;
  readonly refusals: readonly string[];
}

/** What a dry-run save answers: the envelope around {@link SavePatternDryRun}. */
export interface SavePatternDryRunResponse {
  readonly message: string;
  readonly item: SavePatternDryRun;
}

/**
 * What the editor may do with patterns, as the server sees this caller.
 *
 * ONE field, because one verb asks. A map of every capability the plugin might
 * ever gate would be a promise about surfaces that do not exist, and the reader
 * after this one cannot tell such a field from one that quietly stopped being
 * computed — the same reason `PatternLibraryRead` carries the patterns and
 * nothing else.
 *
 * NOT A SECURITY BOUNDARY. The write is authorized on its own, by the route
 * that performs it; a caller who lies to this one gains nothing. It exists so
 * an author is not invited to fill in a form whose save cannot succeed.
 */
export interface PatternCapabilityResponse {
  /**
   * Whether this caller may create a pattern in the resolved collection.
   *
   * `create` on the collection the host actually has, which is the grant the
   * save is judged by. Asking about the DECLARED name instead would refuse an
   * author on a site that renamed the collection — hiding a feature that works,
   * which is worse than the late failure this replaces.
   */
  readonly mayCreate: boolean;
  /**
   * Where this caller may open a component in its own view, or `null` when
   * they may not: `read` and `update` on the store the definitions live in, resolved on the server because a host may rename it. The editor
   * offers "Edit component" only with an answer here.
   *
   * @experimental Settles when the component editor ships.
   */
  readonly componentEditing?: {
    readonly collection: string;
    /** The blocks field the definition lives in, which the view opens. */
    readonly field: string;
  } | null;
  /**
   * Whether this caller may make a component from a selection: `create` and
   * `publish` on the store the definitions live in, since the new component
   * is created published. Absent from an older server, which offers no such
   * route.
   */
  readonly mayCreateComponent?: boolean;
  /**
   * Whether this caller may replace a pattern's content from a selection:
   * `update` and `publish` on the patterns collection, since the new content
   * is published. Absent from an older server.
   */
  readonly mayUpdatePattern?: boolean;
}

/**
 * Where a selection is made into a component: saved as one, or converted into
 * one so the page holds a placement where the selection stood.
 *
 * @experimental Settles when the composition API ships.
 */
export const COMPONENT_FROM_SELECTION_ROUTE_PATH = "/components/from-selection";

/**
 * The two verbs: `save-as` stores a copy and leaves the page alone; `convert`
 * also replaces the selection with a placement of the new component.
 *
 * @experimental Settles when the composition API ships.
 */
export type ComponentFromSelectionAction = "save-as" | "convert";

/**
 * Who applies the page's half of a convert.
 *
 * - `library`: the caller, an editor holding the page unsaved. The server
 *   creates the component and answers with the page ops, which the editor
 *   applies as one undoable step; nothing else of the page is saved.
 * - `stored`: the server, to the stored page, in the same transaction as the
 *   component's create, so a failure of either leaves neither.
 *
 * @experimental Settles when the composition API ships.
 */
export type ComponentApplyMode = "library" | "stored";

/**
 * A new component's own metadata. The slug is derived from the title when it
 * is not given.
 *
 * @experimental Settles when the composition API ships.
 */
export interface ComponentFromSelectionFields {
  readonly title: string;
  readonly slug?: string;
  readonly description?: string;
  readonly category?: string;
}

/**
 * The stored page a `stored` convert edits: its collection, its id, the
 * blocks field holding the selection (`content` when not given), and the
 * language when that field is translated.
 *
 * @experimental Settles when the composition API ships.
 */
export interface StoredPageAddress {
  readonly collection: string;
  readonly id: string;
  readonly field?: string;
  /**
   * The language to read and write, when the blocks field is translated.
   * Absent, the site's default language.
   */
  readonly locale?: string;
}

/**
 * What a caller sends to make a component from a selection.
 *
 * The DOCUMENT and the SELECTION, for the reason {@link SavePatternRequest}
 * gives: the server plans against the registry that knows every block. A
 * `stored` request names the page instead of carrying it, and the selection is
 * read against the page as stored.
 *
 * @experimental Settles when the composition API ships.
 */
export interface ComponentFromSelectionRequest {
  readonly action: ComponentFromSelectionAction;
  /** Defaults to `library`. */
  readonly apply?: ComponentApplyMode;
  /** Plan only: answer what would be created and changed, and write nothing. */
  readonly dryRun?: boolean;
  readonly fields: ComponentFromSelectionFields;
  /** The fields and slots placements may change, by node id in the page. */
  readonly exposure?: ComponentExposure;
  readonly selectedIds: readonly string[];
  /** The page the selection was made in, for `library`. */
  readonly document?: BlockDocument;
  /** The stored page, for `stored`. */
  readonly page?: StoredPageAddress;
}

/**
 * The id a dry run's page ops name in place of the component it did not
 * create.
 *
 * @experimental Settles when the composition API ships.
 */
export const DRY_RUN_COMPONENT_ID = "(new-component)";

/**
 * What the action did, or would do on a dry run.
 *
 * @experimental Settles when the composition API ships.
 */
export interface ComponentFromSelectionResult {
  readonly dryRun: boolean;
  readonly action: ComponentFromSelectionAction;
  readonly apply: ComponentApplyMode;
  /** The created component; on a dry run its id is {@link DRY_RUN_COMPONENT_ID}. */
  readonly component: { readonly id: string; readonly title: string };
  /** The definition that is, or would be, stored. */
  readonly definition: ComponentDocument;
  /**
   * The page ops, for the caller to apply in `library` mode; already applied
   * in `stored` mode. Empty for `save-as`.
   */
  readonly pageOps: readonly BuilderOp[];
  /** What the author should know, such as a link the convert leaves broken. */
  readonly warnings: readonly PlanWarning[];
  /** Who ran it: the signed-in user, or the API key and its owner. */
  readonly by: {
    readonly kind: "user" | "api-key";
    readonly userId: string;
    readonly apiKeyId?: string;
  };
}

/**
 * Where Settings writes the site's breakpoints: the one way they change.
 *
 * A route of its own rather than the `site-style` Single's update, because
 * redefining the site's devices is a site setting with a permission of its
 * own (`manage-page-builder-site`), not a style. The Single refuses every
 * other write that changes them, so the two cannot disagree about who may.
 */
export const SITE_BREAKPOINTS_ROUTE_PATH = "/site/breakpoints";

/**
 * What Settings sends to change the site's breakpoints, and what the route
 * answers it stored: the whole set, or `null` to clear the stored set so the
 * site's configured breakpoints apply again.
 */
export interface SiteBreakpointsRequest {
  readonly breakpoints: BreakpointSet | null;
  /**
   * Save nothing, and answer with what saving this set would drop: every
   * style and hide stored under each breakpoint it removes.
   *
   * @experimental
   */
  readonly dryRun?: boolean;
  /**
   * Strip every style and hide stored under each breakpoint this set removes,
   * across the site, as the person confirmed after seeing the dry run. Without
   * it a set removing breakpoints is stored and what they held stays, unused
   * by the stylesheet, as it would if the breakpoint were added again.
   *
   * @experimental
   */
  readonly confirmRemoval?: boolean;
  /**
   * With `confirmRemoval`: the `version` the dry run answered with. A
   * confirmed removal is refused when the site style has changed since, so
   * it removes exactly what the person was shown.
   *
   * @experimental
   */
  readonly version?: string;
}

/**
 * What a dry run of {@link SiteBreakpointsRequest} answers inside its mutation
 * envelope's `item`: every style and hide stored under each breakpoint the set
 * removes, with nothing saved.
 *
 * @experimental
 */
export interface SiteBreakpointsDryRun extends RemovalDryRun {
  readonly dryRun: true;
  readonly breakpoints: SiteBreakpointsRequest["breakpoints"];
  /**
   * The version of the site style this was counted from, which a confirmed
   * removal sends back; absent where the site issues no versions.
   */
  readonly version?: string;
}

/**
 * Where a breakpoint removal that did not finish within its save is carried
 * on: `POST` with the run's id ({@link SiteBreakpointRemovalRequest}), under
 * the same permission as the save.
 *
 * @experimental
 */
export const SITE_BREAKPOINT_REMOVAL_ROUTE_PATH = "/site/breakpoints/removal";

/** The query parameter naming the run a removal's status is read for. */
export const SITE_BREAKPOINT_REMOVAL_RUN_PARAM = "runId";

/**
 * Where removal `runId` stands is read: `GET` on the removal route.
 *
 * @experimental
 */
export function siteBreakpointRemovalStatusPath(runId: string): string {
  const params = new URLSearchParams({
    [SITE_BREAKPOINT_REMOVAL_RUN_PARAM]: runId,
  });
  return `${SITE_BREAKPOINT_REMOVAL_ROUTE_PATH}?${params.toString()}`;
}

/**
 * What reading one removal answers: its status while it holds what it
 * removed, or `null` once it holds nothing (done, leaving no document), or
 * where there is no such run.
 *
 * @experimental
 */
export interface SiteBreakpointRemovalRead {
  readonly removal: SiteBreakpointRemovalStatus | null;
}

/**
 * What continuing a removal sends: the run the save answered with.
 *
 * @experimental
 */
export interface SiteBreakpointRemovalRequest {
  readonly runId: string;
}

/**
 * Where a removal stands after a save or a call to carry it on: every value
 * under the removed breakpoints is stripped once `finished`; until then the
 * removal route is called again with `runId`. `left` counts the documents
 * this call had to leave as they are (a published page with a pending draft,
 * say), which keep their values until they can be stripped.
 *
 * @experimental
 */
export interface SiteBreakpointRemoval {
  readonly runId: string;
  readonly finished: boolean;
  readonly left: number;
  /** For a run undoing a removal: what it undoes, and what stayed out. */
  readonly undo?: SiteBreakpointUndo;
}

/**
 * Where an undo of a breakpoint removal is asked for: `POST` with the
 * removal's id ({@link SiteBreakpointRemovalRequest}), under the same
 * permission as the save. Only the newest removal can be undone, once, within
 * 30 days. The breakpoints it removed are defined again, and every value it
 * took out goes back where nothing has been set since; its walk is carried on
 * through {@link SITE_BREAKPOINT_REMOVAL_ROUTE_PATH} like a removal's.
 *
 * @experimental
 */
export const SITE_BREAKPOINT_UNDO_ROUTE_PATH = "/site/breakpoints/removal/undo";

/**
 * The code an undo is refused with (409) when its breakpoints no longer fit
 * the set: one is a breakpoint again, would end at another's width, or its
 * axis is full. Editing the breakpoints is the way on; any other refusal is
 * answered by reading Settings again.
 *
 * @experimental
 */
export const SITE_BREAKPOINT_UNDO_DOES_NOT_FIT = "BREAKPOINT_UNDO_DOES_NOT_FIT";

/**
 * Values an undo could not put back into one document, for one reason (a
 * document may be listed once per reason):
 * - `changed`: something else was set there after the removal;
 * - `block-deleted`: their block (or shared style) was deleted after it;
 * - `gone`: the document was deleted after it;
 * - `draft-gone`: the draft they were taken from was published or discarded;
 * - `unreadable`: the document cannot be read, so nothing is known of them.
 *
 * @experimental
 */
export interface SiteBreakpointUndoSkipped {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly id?: string;
  /**
   * What the person asking knows the document by; absent for one they may
   * not read, or one deleted since.
   */
  readonly name?: string;
  /**
   * Set on the site's shared styles, whatever slug their Single is
   * registered under, so the person is told of them as such.
   */
  readonly sharedStyles?: true;
  readonly values: number;
  readonly reason:
    | "changed"
    | "block-deleted"
    | "gone"
    | "draft-gone"
    | "unreadable";
}

/**
 * What an undo did: the removal it undoes and, once its walk is finished,
 * each document it could not put every value back into.
 *
 * @experimental
 */
export interface SiteBreakpointUndo {
  readonly undoes: string;
  readonly skipped?: readonly SiteBreakpointUndoSkipped[];
}

/**
 * What saving the site's breakpoints answers: the set stored, and, when it
 * removed breakpoints, where the removal of their values stands.
 */
export interface SiteBreakpointsSaved {
  readonly breakpoints: BreakpointSet | null;
  /** @experimental */
  readonly removal?: SiteBreakpointRemoval;
}

/**
 * Where the editor reads the stored site style: the one read the canvas, the
 * inspector and Design's studios draw from.
 *
 * A route rather than the `site-style` Single's own read, because drawing a
 * block needs the style and the Single's read needs Design's
 * `read-site-style`. An author who may edit a page but not the site's design
 * would otherwise open an editor whose canvas cannot draw. The route answers
 * to a caller holding `read-site-style` or able to update something the
 * builder edits; writes still go through the Single and its own permission.
 */
export const SITE_STYLE_ROUTE_PATH = "/site/style";

/**
 * The stored site style as the route answers it: the Single's four sections
 * exactly as stored, each `null` where nothing is stored, the version the
 * read gave, and nothing else.
 *
 * Raw rather than narrowed, so the editor narrows a stored record with the
 * same reader the published render does and can still say which stored font
 * rows it had to drop.
 */
export interface StoredSiteStyle {
  readonly tokens: unknown;
  readonly fonts: unknown;
  readonly classes: unknown;
  readonly breakpoints: unknown;
  /**
   * The site's recorded spacing model, `classic` or `gaps`, or `null` when
   * none is recorded and the engine's default applies. Kept in the plugin's own
   * table rather than the Single; optional so a record without it reads as
   * nothing recorded.
   */
  readonly spacingMode?: unknown;
  /**
   * The Single's version, as the same read gave it: what a save of a section
   * made from this read sends back, so a save made in between refuses it
   * rather than being overwritten. Absent where the server gives none.
   */
  readonly _rev?: string;
}

/**
 * Where the owner chooses the site's spacing model: `POST` with
 * `{ mode: "classic" | "gaps" }`, answered with `{ message, item: { spacingMode } }`.
 */
export const SPACING_MODE_ROUTE_PATH = "/site/style/spacing-mode";

/** What the spacing-model route answers inside its mutation envelope's `item`. */
export interface SpacingModeResult {
  readonly spacingMode: SpacingMode;
}

/** Where Settings' Site tab reads what it shows and what this caller may change. */
export const SITE_SETTINGS_ROUTE_PATH = "/site/settings";

/** A Layout the site's default may be, as the Site tab offers it. */
export interface SiteLayoutOption {
  readonly id: string;
  readonly title: string;
}

/**
 * What Settings' Site tab shows, and what this caller may change there, each
 * permission answer derived from the grants its write is judged by.
 *
 * Like the pattern answer, NOT A SECURITY BOUNDARY: each write is authorized on
 * its own. A caller who may not manage the site is told nothing about it.
 */
export interface SiteSettingsRead {
  /** Whether this caller may change the site's settings: the tab is offered. */
  readonly mayManageSite: boolean;
  /**
   * Whether this caller may choose the site's default Layout, which also
   * needs the rights to update and publish Layouts.
   */
  readonly mayChooseDefaultLayout: boolean;
  /** The site's default Layout, by id, or `null` when it has none. */
  readonly defaultLayout: string | null;
  /**
   * The site's breakpoints, as the canvas resolves them (the stored set over
   * the configured one). Read here, under the same permission as their one
   * write, so a role that may manage them can see them without Design's read.
   */
  readonly breakpoints: BreakpointSet | null;
  /**
   * The published Layouts: every one the caller may choose from, or only the
   * current default, to name it, for a caller who may not choose.
   */
  readonly layouts: readonly SiteLayoutOption[];
  /**
   * The breakpoint removals still holding what they removed: the open one
   * first, then the newest done ones that left documents keeping their
   * values. Absent where the site carries no removals out, or the runs could
   * not be read.
   *
   * @experimental
   */
  readonly removals?: readonly SiteBreakpointRemovalStatus[];
  /**
   * The removal Settings may still undo: the newest, within its 30 days, not
   * undone yet. `null` when there is none; absent where the site carries no
   * removals out.
   *
   * @experimental
   */
  readonly undoable?: SiteBreakpointUndoable | null;
}

/**
 * The removal that can still be undone, as the Site tab offers it.
 *
 * @experimental
 */
export interface SiteBreakpointUndoable {
  readonly runId: string;
  /** The breakpoints it removed, by id. */
  readonly ids: readonly string[];
  /** The same breakpoints, by the names the author knew them by. */
  readonly labels: readonly string[];
  /** When it was made, as an ISO date and time. */
  readonly removedAt: string;
  /** When its 30 days end, as an ISO date and time. */
  readonly until: string;
}

/**
 * What reading the removals alone answers (`GET` on the removal route with no
 * run named): what the Site tab's read reports of them, without the rest of
 * Settings, for an open Settings watching for a removal another tab started.
 *
 * @experimental
 */
export interface SiteBreakpointRemovalsRead {
  readonly removals: readonly SiteBreakpointRemovalStatus[];
  readonly undoable: SiteBreakpointUndoable | null;
}

/**
 * One breakpoint removal as the Site tab shows it.
 *
 * @experimental
 */
export interface SiteBreakpointRemovalStatus {
  readonly runId: string;
  /**
   * The breakpoints it removed, by the names the author knew them by; for an
   * undo, the ones it puts back.
   */
  readonly labels: readonly string[];
  /** For an undo: the removal it puts back. */
  readonly undoes?: string;
  /** Whether it is still walking the site. */
  readonly open: boolean;
  /**
   * The documents it left, which keep their values under the removed
   * breakpoints until they can be stripped; 0 while it is open.
   */
  readonly left: number;
  /**
   * Whether every document it left waits on a pending draft, which
   * publishing or discarding resolves.
   */
  readonly waitingOnDrafts: boolean;
}

/**
 * Where the component editor asks what it needs to know about the component it
 * edits that the component's own document does not hold.
 *
 * @experimental Settles when the component editor ships.
 */
export const COMPONENT_FACTS_ROUTE_PATH = "/component-facts";

/** The query parameter naming the component, by id. */
export const COMPONENT_FACTS_ID_PARAM = "id";

/** The query parameter carrying an asker's mount token, which the route ignores. */
const COMPONENT_FACTS_MOUNT_PARAM = "mount";

/**
 * The facts route's path for one component, in the language being edited, as
 * the client requests it. No language is the app default, as everywhere in
 * the admin.
 */
export function componentFactsPath(
  id: string,
  locale?: string | null,
  /**
   * A token the route ignores, which makes the path, and so the read's cache
   * key, one asker's own: an editor trusts no answer read before it mounted.
   */
  mount?: string
): string {
  const query = new URLSearchParams({ [COMPONENT_FACTS_ID_PARAM]: id });
  if (locale !== undefined && locale !== null && locale !== "") {
    query.set(COMPONENT_LIBRARY_LOCALE_PARAM, locale);
  }
  if (mount !== undefined) query.set(COMPONENT_FACTS_MOUNT_PARAM, mount);
  return `${COMPONENT_FACTS_ROUTE_PATH}?${query.toString()}`;
}

/**
 * What the component editor is told about the component it edits.
 *
 * NOT A SECURITY BOUNDARY: the save judges every write on its own. This keeps
 * a draft from minting an id the live definition still uses, and tells the
 * author how far a change reaches.
 *
 * @experimental Settles when the component editor ships.
 */
export interface ComponentFactsResponse {
  /**
   * The field and slot ids the component's LIVE definition holds. A draft
   * that dropped one still has placements holding values under it, so a new
   * field must never be minted under any of these.
   */
  readonly live: {
    readonly properties: readonly string[];
    readonly slots: readonly string[];
  };
  /**
   * The field and slot ids the component has retired: removed by a published
   * definition, and never to be minted again, since a host may still hold a
   * value under one until it is next written. `null` where retirements are not
   * recorded (a localized component store, or a host rendering components
   * from its own source), so a new field cannot be kept clear of them and the
   * editor adds none.
   */
  readonly retired: {
    readonly properties: readonly string[];
    readonly slots: readonly string[];
  } | null;
  /**
   * How many documents place the component directly, from the usage index;
   * `complete` false makes the number a floor. `null` when the index could not
   * answer, or the caller may not read the component.
   */
  readonly reach: { readonly count: number; readonly complete: boolean } | null;
  /**
   * How many distinct pages and Singles a change to the component reaches:
   * placed on them directly, through another component, or through a Layout
   * wrapping them (the site's default included). What the banner over the
   * component's own view says; `complete` false makes it a floor. `null` when
   * it could not be counted, or the caller may not read the component.
   */
  readonly pages: { readonly count: number; readonly complete: boolean } | null;
}

/**
 * Where the Design panel locks and unlocks a shared style: the one write that
 * may move a lock, gated on the permission to lock shared styles alone.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_LOCK_ROUTE_PATH = "/shared-styles/lock";

/** What the lock route is sent: which shared style, and whether to lock it. */
export interface SharedStyleLockRequest {
  readonly classId: string;
  readonly locked: boolean;
}

/**
 * Where the Design panel reads how widely its visible shared styles are used,
 * a page of rows at a time.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_USAGE_ROUTE_PATH = "/shared-styles/usage";

/** The query parameter naming one shared style, by id; repeated for several. */
export const SHARED_STYLE_ID_PARAM = "id";

/** The most shared styles one usage read answers for: one page of rows. */
export const SHARED_STYLE_USAGE_IDS_MAX = 50;

/**
 * The kinds of document a shared style is counted on. Every collection with a
 * page builder field other than the composition stores holds pages.
 */
export type SharedStyleUsageKind =
  | "pages"
  | "components"
  | "patterns"
  | "layouts";

/** How widely one shared style is used, from the class usage index. */
export interface SharedStyleUsage {
  /** How many documents apply it, gated and hidden content included. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /** False makes both numbers floors: "at least". */
  readonly complete: boolean;
}

/**
 * The code the remove route's issue carries when a stored document still uses
 * a style, so the editor can tell that refusal from one for a lock or a count
 * no longer whole. Carried only when every reason a removal is refused for is
 * a use: a refusal any of whose reasons is not (a lock, a style the site's
 * code defines, uses that could not all be counted) is a conflict naming
 * every reason, so the code never marks one that is not a use.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_IN_USE_CODE = "IN_USE";

/**
 * What the usage read answers: the index's health once for the screen, what
 * this caller may do, and the usage of each style asked about.
 *
 * NOT A SECURITY BOUNDARY: every write is judged on its own.
 */
export interface SharedStylesUsageResponse {
  /** Whether the usage index covers the whole site, so counts can be exact. */
  readonly whole: boolean;
  /**
   * Whether counts that are not whole may still become whole: the site is
   * still being counted. False when they are whole, and when something the
   * index cannot reach keeps them floors for good, so there is nothing to
   * read again for.
   */
  readonly counting: boolean;
  /** Whether this caller may lock and unlock shared styles. */
  readonly mayLock: boolean;
  /**
   * Whether this caller may ask for the pages to be counted now, through
   * {@link SHARED_STYLE_COUNT_ROUTE_PATH}: whoever may change Design, the
   * people a whole count lets remove a style.
   */
  readonly mayCount: boolean;
  /** Each style asked about, by id. */
  readonly styles: Readonly<Record<string, SharedStyleUsage>>;
}

/**
 * Where the Design panel lists the documents a shared style is used on, read
 * as the caller: documents the caller may not read are counted, not named.
 * The answer is the canonical list envelope, paged twenty at a time with
 * `?page=` from 1: `meta.total` and the pages count the documents the caller
 * may read, and `meta.hiddenCount` the ones it may not.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_WHERE_USED_ROUTE_PATH = "/shared-styles/where-used";

/** The most documents one where-used answer names. */
export const SHARED_STYLE_WHERE_USED_MAX = 20;

/** The query parameter naming which page of a where-used list, from 1. */
export const SHARED_STYLE_PAGE_PARAM = "page";

/**
 * The last page a where-used read may ask for: the most documents one usage
 * listing can name, twenty to a page.
 */
export const SHARED_STYLE_WHERE_USED_PAGES_MAX = 250;

/**
 * The usage route's path for some shared styles, each named by its own `id`
 * parameter, so the browser asks in the shape the route reads.
 */
export function sharedStyleUsagePath(ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append(SHARED_STYLE_ID_PARAM, id);
  return `${SHARED_STYLE_USAGE_ROUTE_PATH}?${params.toString()}`;
}

/** The where-used route's path for one shared style and one page, from 1. */
export function sharedStyleWhereUsedPath(id: string, page: number): string {
  const params = new URLSearchParams({
    [SHARED_STYLE_ID_PARAM]: id,
    [SHARED_STYLE_PAGE_PARAM]: String(page),
  });
  return `${SHARED_STYLE_WHERE_USED_ROUTE_PATH}?${params.toString()}`;
}

/** One document a shared style is used on, as the where-used list names it. */
export interface SharedStyleUseItem {
  readonly id: string;
  readonly title: string;
  readonly collection: string;
  readonly kind: SharedStyleUsageKind;
}

/**
 * Where the Design panel removes unused shared styles: the one write that may
 * remove one, made only after the server finds the usage index whole and
 * nothing using any of them.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_REMOVE_ROUTE_PATH = "/shared-styles/remove";

/**
 * Where the Design panel asks for the site's pages to be counted now, rather
 * than waiting for a scheduler to run the usage backfill: it runs that job
 * for a bounded time and answers how far the counting got.
 *
 * @experimental Settles when the Shared styles tab ships.
 */
export const SHARED_STYLE_COUNT_ROUTE_PATH = "/shared-styles/count";

/**
 * What the count route answers, as its mutation's `item`: whether it ran the
 * counting (false when something else was already running it), and the
 * index's health read after, in the usage read's terms.
 */
export interface SharedStylesCountResponse {
  readonly ran: boolean;
  readonly whole: boolean;
  readonly counting: boolean;
}

/** What the remove route is sent: the shared styles to remove, by id. */
export interface SharedStyleRemoveRequest {
  readonly ids: readonly string[];
}

/**
 * Where the Design panel's Variables reads how widely its variables are used,
 * a page of rows at a time, each variable named by its identity (`$token`:
 * the token's `id`, else its name) with its own `id` parameter.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_USAGE_ROUTE_PATH = "/variables/usage";

/** The query parameter naming one variable, by identity; repeated for several. */
export const VARIABLE_ID_PARAM = "id";

/** The query parameter naming which page of a where-used list, from 1. */
export const VARIABLE_PAGE_PARAM = "page";

/** The most variables one usage read or one removal answers for. */
export const VARIABLE_USAGE_IDS_MAX = 50;

/**
 * How widely one variable is used: the documents whose blocks or page
 * settings name it, from the variable usage index; the shared styles whose
 * own styles name it, from the site style; and the block types whose own
 * default styles name it, from the block registry. A shared style's reference
 * is a use whether or not any block applies the style, and a block type's
 * whether or not any page places the block. The places it is used are
 * `documents` plus `sharedStyles.length` plus `blockDefaults.length`.
 */
export interface VariableUsage {
  /** How many documents use it, gated and hidden content included. */
  readonly documents: number;
  /** The same documents, by kind. */
  readonly byKind: Readonly<Record<SharedStyleUsageKind, number>>;
  /** The ids of the shared styles whose styles name it, in id order. */
  readonly sharedStyles: readonly string[];
  /**
   * The registered block types (`core/button`) whose own default styles
   * (`baseStyles`) name it, in type order.
   */
  readonly blockDefaults: readonly string[];
  /** False makes `documents` and `byKind` floors: "at least". */
  readonly complete: boolean;
}

/**
 * What the variables usage read answers: the index's health once for the
 * screen, whether this caller may ask for a count now, and each variable.
 *
 * NOT A SECURITY BOUNDARY: every write is judged on its own.
 */
export interface VariablesUsageResponse {
  /** Whether the usage index covers the whole site, so counts can be exact. */
  readonly whole: boolean;
  /** Whether counts that are not whole may still become whole. */
  readonly counting: boolean;
  /**
   * Whether this caller may ask for the pages to be counted now, through
   * {@link SHARED_STYLE_COUNT_ROUTE_PATH}: one count fills every usage index.
   */
  readonly mayCount: boolean;
  /** Each variable asked about, by identity. */
  readonly variables: Readonly<Record<string, VariableUsage>>;
}

/**
 * Where the Variables panel lists the places a variable is used: first the
 * shared styles naming it, then the block types whose default styles name
 * it, then the documents, read as the caller (documents the caller may not
 * read are counted in `meta.hiddenCount`, not named). The canonical list
 * envelope, twenty to a page with `?page=` from 1, up to the page the longest
 * such list ends on: every document one usage listing can name, with every
 * shared style and block type the site has.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_WHERE_USED_ROUTE_PATH = "/variables/where-used";

/**
 * Which kind of place a variable is used in: a document's kind, a shared
 * style, or a block type's own default style.
 */
export type VariableUseKind =
  | SharedStyleUsageKind
  | "shared-style"
  | "block-default";

/**
 * One place a variable is used. A document is named by its collection and id,
 * as the shared-style where-used names one. A shared style is named by its
 * class id in `id`, with the site-style Single's slug as its `collection`, so
 * the panel can open it in Design > Shared styles. A block type's default
 * style is named by the type in `id` (`core/button`) and its label in
 * `title`, with an empty `collection`: it is the block's code, not a stored
 * document.
 */
export interface VariableUseItem {
  readonly id: string;
  readonly title: string;
  readonly collection: string;
  readonly kind: VariableUseKind;
  /**
   * For a shared style that is a block look, the block type it is bound to.
   * Two block types' own looks may share an id, so a look is named by the
   * pair: the panel opens the look `{ id, blockType }`. Absent for every
   * other place.
   *
   * @experimental Settles when the Variables panel shows usage.
   */
  readonly blockType?: string;
}

/**
 * Where the Variables panel removes variables the site added: the one write
 * that checks first, just before it writes, that nothing uses any of them. A
 * variable the site's code supplies cannot be removed, only reset.
 *
 * Refused in use with a validation error whose issues carry
 * {@link SHARED_STYLE_IN_USE_CODE}: one issue per variable the index, a
 * shared style or a block type's default style finds in use, its `path` that
 * variable's identity, or one issue with an empty `path` when the stored
 * documents themselves still use one. Refused with a conflict naming every
 * reason when the uses cannot be counted, even if another variable asked
 * about is in use: no issue carries the in-use code for a variable whose
 * uses are not known. A page saved while the removal writes, that uses one
 * of the variables, puts it back and refuses the removal as in use.
 *
 * @experimental Settles when the Variables panel shows usage.
 */
export const VARIABLE_REMOVE_ROUTE_PATH = "/variables/remove";

/** What the remove route is sent: the variables to remove, by identity. */
export interface VariableRemoveRequest {
  readonly ids: readonly string[];
}

/** The usage route's path for some variables, each named by its own `id`. */
export function variableUsagePath(ids: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of ids) params.append(VARIABLE_ID_PARAM, id);
  return `${VARIABLE_USAGE_ROUTE_PATH}?${params.toString()}`;
}

/** The where-used route's path for one variable and one page, from 1. */
export function variableWhereUsedPath(id: string, page: number): string {
  const params = new URLSearchParams({
    [VARIABLE_ID_PARAM]: id,
    [VARIABLE_PAGE_PARAM]: String(page),
  });
  return `${VARIABLE_WHERE_USED_ROUTE_PATH}?${params.toString()}`;
}
