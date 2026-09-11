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
}
