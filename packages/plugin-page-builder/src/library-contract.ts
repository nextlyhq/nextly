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
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { SavedPattern } from "@nextlyhq/builder";
import type { HookWarning } from "nextly/config";

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

/** Where the panel finds the library, under this plugin's own namespace. */
export const LIBRARY_ROUTE_PATH = "/library";

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

/** What one library read answers. */
export interface LibraryResponse {
  readonly items: readonly LibraryPattern[];
  readonly meta: {
    /** How many were returned. */
    readonly count: number;
    /** Whether the ceiling stopped the read before the collection ended. */
    readonly truncated: boolean;
  };
}

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
 * These are the `patterns` collection's own fields, and the route does not
 * trust this list at runtime: it takes the field names from the collection
 * itself, so a caller cannot reach a column the collection never declared.
 * What this type is for is the DIALOG — the surface filling the form needs to
 * know what to ask for, and it runs in a browser that cannot load the
 * collection module.
 *
 * A type naming a source of truth it cannot track is how a contract goes quietly
 * stale, so `save-pattern-contract.test.ts` compares these keys against the
 * collection's declared fields and fails when they part company.
 */
export interface SavePatternFields {
  readonly title: string;
  readonly slug: string;
  readonly granularity: PatternGranularity;
  readonly description?: string;
  readonly category?: string;
  readonly keywords?: string;
}

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
}

/**
 * What a completed save answers.
 *
 * The id, because the surface that saved has nothing else to address the new
 * pattern by, and the warnings, because a post-commit hook can fail after the
 * row is durable. Dropping those would report a save as wholly successful when
 * part of it was not — and the row cannot be un-saved, so the only remedy is to
 * say so.
 */
export interface SavePatternResponse {
  readonly id: string;
  /** Side effects that failed after the row committed, when any did. */
  readonly warnings?: readonly HookWarning[];
}
