import {
  compileSiteSheet,
  compileSiteTokenSheet,
  DOCUMENT_FORMAT_VERSION,
  PAGE_ROOT_CLASS,
  resolveSiteTokens,
  type BlockDocument,
  type DefinitionsById,
  type DocumentLimits,
  type SiteSheetInput,
  type StyleCompileContext,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import type { ReactElement, ReactNode } from "react";

import { BlockList } from "./block-boundary";
import {
  createStandaloneContext,
  type BlockHostPolicy,
  type PageContext,
} from "./context";
import { BlockPlaceholder } from "./placeholder";
import {
  prepareDocumentReadStages,
  rendersOwnMarkup,
} from "./prepare-document";
import { registeredBlocks, type BlockResolver } from "./resolver";
import {
  drawlessTestFor,
  effectiveCompile,
  gatedEntriesCoverRemovedNodes,
  gatedMapCoversPrunedNodes,
  hasDuplicateNodeIds,
  migrationChangedWhatDraws,
  readableGatedRules,
  resolvePageStyles,
  styleTextForInjection,
  type PageStyles,
} from "./styles";
import { pruneNodes } from "./visibility";

export interface PageRendererProps {
  /** The stored document to render. */
  document: BlockDocument;
  /**
   * What every block render receives. Defaults to a context wired to nothing,
   * which is what makes a document renderable with no CMS present.
   */
  context?: PageContext;
  /** Where block definitions come from. Defaults to the process registry. */
  blocks?: BlockResolver;
  /**
   * The component definitions this page may inline, at the posture the caller
   * chose — drafts for the editor, published for a served page.
   *
   * Passed through to the shared pipeline rather than resolved here, so this
   * renderer and every other reader of the same document compose it the same
   * way. Absent, an instance renders the marker that says its component could
   * not be loaded, which is the honest answer for a reader that did not fetch
   * one.
   */
  definitions?: DefinitionsById;
  /**
   * The stylesheet compiled when the document was saved, with the class each
   * node was assigned. Supplying it is the normal path.
   */
  styles?: PageStyles;
  /**
   * Compile the stylesheet during this render instead, for a consumer with no
   * write path. Ignored when `styles` is supplied.
   */
  styleContext?: StyleCompileContext;
  /**
   * The site's design tokens, fonts and named classes, compiled into the sheet
   * every page shares and emitted BEFORE the page's own.
   *
   * **Order is the cascade and is not negotiable.** `compileSiteSheet` emits
   * font faces, then tokens, then block-type defaults, then named classes; the
   * page sheet is appended after, which is what lets a node's own value beat a
   * class and a class beat a block default. Emitting these in the other order
   * would invert every one of those.
   *
   * **Its tokens LAYER over the defaults rather than replacing them**, through
   * `resolveSiteTokens`. A site that supplied one brand colour and thereby lost
   * `content.width` and `space.4` would break every block reading those, and
   * break it silently: an unresolved custom property invalidates the
   * declaration rather than reporting anything.
   *
   * **Omitting it still emits the DEFAULT token set.** This was opt-in when the
   * prop was introduced, on the argument that a standalone consumer owns its own
   * `<head>`. That argument does not survive contact with what the asymmetry
   * cost: a block could not reference a token at all, because a default reading
   * `color.surface` would resolve on a Nextly route and silently resolve to
   * nothing here. So `core/card` shipped with no background and no border, and
   * `badge` was unbuildable — and the pressure that produced six blocks reaching
   * for the admin `--nx-*` namespace stayed exactly where it was.
   *
   * What a host receives unasked is a block of `--site-*` custom-property
   * DEFINITIONS. They are additive and namespaced, and the engine reserves that
   * prefix — `safeTokenPrefix` refuses `--nx-` and `--tw-` precisely so a site
   * cannot restyle surfaces it does not own — so they cannot collide with a
   * host's own variables. A host that wants its own set supplies one; a host
   * that wants NONE passes `siteStyles={false}` — an explicit refusal rather
   * than an empty token list, because `resolveSiteTokens` LAYERS, so an empty
   * override means "no overrides" and still yields every default. A test found
   * that: the opt-out did not exist until it was given its own value.
   *
   * A sheet needs a breakpoint set to compile the block-default tier under, and
   * it is taken from the RECONCILED compile context rather than from
   * `styleContext` alone — a consumer rendering a stored artifact supplies no
   * context of its own and would otherwise get no sheet, which is the ordinary
   * production path.
   */
  siteStyles?: SiteSheetInput | false;
  /** Shown in place of an asynchronous block until its output arrives. */
  blockFallback?: ReactNode;
  /**
   * The caps this site holds its documents to, used while repairing the stored
   * shape. A site that raised `maxNodes` for long pages validates and compiles
   * against that number, so repairing against the default would truncate
   * content that is legitimately there. Falls back to the compile context's
   * limits, then to the engine defaults.
   */
  limits?: DocumentLimits;
  /**
   * Site-operator decisions the blocks enforce. See {@link BlockHostPolicy}.
   *
   * THE ONLY place a policy is configured. It is not read from `context`, which
   * carries no such field: the policy is the renderer's and reaches each block
   * as a render argument, so the host's context object is passed through
   * untouched rather than copied to carry it.
   *
   * Omitted means the host configured nothing. What that GRANTS differs per
   * field and is documented on each: `trustedFrameOrigins` defaults closed and
   * grants nothing, while `remotePatterns` defaults open and asks nothing, so
   * omitting this does not deny remote fetches.
   */
  hostPolicy?: BlockHostPolicy;
  /**
   * Emit `data-nx-node="<node id>"` on each block's root element.
   *
   * OFF by default: a published page should not carry editor concerns. An editor
   * turns it on to get a stable address per node — and it is the ONLY per-node
   * hook that reaches the DOM independently of styling, because a node with no
   * compiled styles receives only the block-TYPE class.
   */
  nodeAttribute?: boolean;
}

/**
 * Drop the subtrees the renderer replaces with a placeholder, over the slots the
 * BOUNDARY renders.
 *
 * Deliberately NOT `prepare-document`'s pass of the same name, which walks only
 * the slots a definition declares. That is right for the document a reader is
 * handed: an undeclared slot is not on the page, and compiling its descendants'
 * rules would publish markup nobody receives. It is wrong here, because
 * `renderSlot(name: string)` lets a block render a stored slot its definition
 * never declared — and those children DO reach the page, so a style input that
 * dropped them would withhold rules for markup that is rendered.
 *
 * Two questions, two passes. `pruneNodes` is the shared walk, so their identity
 * behaviour cannot diverge even though what they keep does.
 *
 * Exported to the package rather than kept local because it is half the answer
 * to "which tree does this page's sheet describe", and the editor's cascade read
 * has to ask that same question. Rebuilding it there from `rendersOwnMarkup`
 * would be a second implementation of one pass, which is the drift this file
 * already argues against. Not on the public entry: it is an internal derivation,
 * not a surface a host composes with.
 */
export function pruneRenderedPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  return pruneNodes(document, node => rendersOwnMarkup(node, resolver));
}

/**
 * Which side of the render each site-level input belongs to.
 *
 * A `SiteSheetInput` field is read by both compiles or by the sheet alone. When
 * both read it, one render must resolve it once or the two disagree invisibly,
 * each internally consistent and neither reporting anything.
 *
 * - `breakpoints` decides which at-rules every tier is emitted under, and is
 *   required on the compile context. A set that reached only the sheet puts the
 *   block-default and class tiers under at-rules the page's own values never
 *   use, and drops any value stored under an id the other set omits.
 * - `classes` is reconciled onto the PAGE context only. The sheet always writes
 *   the site's library; the page compile attributes from the context's list
 *   when it states one, because a context stating its own defers ATTRIBUTION
 *   while the rules stay in the sheet. Resolving it back onto the sheet drops
 *   the library whenever a context defers.
 * - `blockBases` is the same shape one level along: the sheet emits the
 *   `.nx-bt-*` rules and the page compile decides which of them a node
 *   inherits, and the page sheet is appended after the shared one.
 * - `tokenPrefix` separates declaration from reference. The sheet DECLARES the
 *   custom properties and the page compile REFERENCES them, so a prefix that
 *   reaches only one leaves every reference pointing at a property nothing
 *   declared — and an unresolved custom property invalidates the declaration
 *   rather than reporting.
 * - `mayFetchUrl` is reconciled a level up, in `effectiveCompile`, which derives
 *   one predicate and hands the same object to both. It has its own role rather
 *   than sharing one, so nothing here promises a reconciliation that happens
 *   elsewhere — but the context handed to that reconciler has to CARRY the
 *   site's predicate, or the reconciliation is over a value it never saw.
 * - `fonts` and `tokens` are the sheet's alone: it emits `@font-face` and the
 *   token blocks, and the page compile emits neither and reads neither.
 */
interface SiteInputRoles {
  breakpoints: "reconciled-here";
  classes: "reconciled-here";
  blockBases: "reconciled-here";
  tokenPrefix: "reconciled-here";
  previewContainer: "reconciled-here";
  previewStates: "reconciled-here";
  mayFetchUrl: "reconciled-elsewhere";
  fonts: "sheet-only";
  tokens: "sheet-only";
}

/**
 * The inputs the resolver below must produce, taken from the table itself.
 *
 * Indexed by every `SiteSheetInput` key rather than by the table's own keys,
 * which is what makes the table exhaustive: a field added there and not
 * classified here cannot index `SiteInputRoles` and the type fails to compile.
 * Purely a type, so nothing exists at runtime to be unused.
 */
type ReconciledHere = {
  [K in keyof Required<SiteSheetInput>]: SiteInputRoles[K] extends "reconciled-here"
    ? K
    : never;
}[keyof Required<SiteSheetInput>];

/** The name an input takes on the compile context, where it differs. */
type ContextKey<K> = K extends "classes" ? "namedClasses" : K;

/**
 * What `sharedStyleInputs` must return: every reconciled-here key, present.
 *
 * Required rather than optional on purpose. An optional key can be left out
 * silently, which is exactly the gap this table is meant to close — a field
 * classified as reconciled here and then never reconciled.
 */
type ResolvedShared = {
  [K in ReconciledHere as ContextKey<K>]:
    | NonNullable<Required<SiteSheetInput>[K]>
    | undefined;
};

/**
 * What {@link sharedStyleInputs} RETURNS: the same inputs as a context patch,
 * with unstated keys absent rather than present and undefined.
 *
 * Each value may be `null`, and that is not a nicety. `firstStated` skips only
 * `undefined`, so a stored `null` is KEPT and means something: a site stating a
 * null breakpoint set defines no viewport tiers, and that answer outranks a
 * route context which has some — `canvas.test.tsx` pins it, because reading it
 * as absent turns preview on for a canvas left on the unconditional tier.
 * Published without the null, a consumer is told to check only for `undefined`
 * and dereferences a value the renderer explicitly supports.
 *
 * Stated separately from {@link ResolvedShared} rather than by widening it,
 * because the two answer different questions. This one describes what the
 * reconciler RETURNS, nulls included; that one describes what may be spread
 * into a compile context, whose slots are declared as values. Everything
 * between them is {@link withoutStatedNulls}, which is where a stated null
 * stops being a value and becomes an absence.
 *
 * Named distinctly from the cache stamp's input projection in
 * `shared-style-inputs.ts`, which is a different type for a different job and
 * requires `breakpoints`. Under one name a caller writing
 * `const value: Inputs = sharedStyleInputs(undefined, undefined)` does not
 * compile, because the reconciler may legally resolve nothing — a published
 * type unusable with the function published beside it.
 */
export type ReconciledStyleInputs = Partial<{
  [K in keyof ResolvedShared]: ResolvedShared[K] | null;
}>;

/**
 * The reconciled inputs with every stated NULL dropped.
 *
 * `firstStated` keeps a stored `null` because it OUTRANKS a lower tier — a site
 * stating null for a field is saying it has none, and that has to beat a route
 * context which has some. That is a fact about the reconciliation, and it is
 * settled by the time these reach a compile: what the compiler needs is the
 * value, and "the site has none" is the absent key.
 *
 * A compile context declares these slots as values rather than nullable ones,
 * so a null spread into one was a lie no type was catching. Dropping the key
 * states the same thing in the shape the compiler declares.
 *
 * `breakpoints` is excluded and handled by {@link statedBreakpoints}, because
 * absent means something different for it: a missing set falls through to
 * whatever the route context carries, which is exactly what a stated null
 * exists to override. Its "none" is an empty set rather than an absence.
 */
/**
 * The reconciled inputs as a compile patch: every stated NULL turned into an
 * absence, and every key present.
 *
 * `firstStated` keeps a stored `null` because it OUTRANKS a lower tier — a site
 * stating null for a field is saying it has none, and that has to beat a route
 * context which has some. That contest is over by the time these reach a
 * compile; what is left is a value, and "the site has none" is `undefined`.
 *
 * EVERY key is returned, set to `undefined` where nothing was stated. That is
 * what makes the override work: this is spread OVER a route context, and an
 * absent key would leave the route's own value standing — so a site's null
 * would silently fail to override the very value it was stated to beat.
 *
 * And it is what makes the exhaustiveness real. The return type is not
 * `Partial`, so omitting a key does not compile: a field added to the
 * reconciliation and forgotten here fails the build rather than disappearing
 * from every compile. A `Partial` return accepts any subset, which is a promise
 * this function cannot keep.
 *
 * `breakpoints` is excluded and handled by {@link statedBreakpoints}, because
 * absent means something different for it: a compile context declares it as a
 * set rather than an optional, so `undefined` is not a legal value there. Its
 * "none" is an empty set.
 */
export function withoutStatedNulls(
  shared: ReconciledStyleInputs
): Omit<ResolvedShared, "breakpoints"> {
  return {
    namedClasses: shared.namedClasses ?? undefined,
    blockBases: shared.blockBases ?? undefined,
    tokenPrefix: shared.tokenPrefix ?? undefined,
    previewContainer: shared.previewContainer ?? undefined,
    previewStates: shared.previewStates ?? undefined,
  };
}

/**
 * A stated set, or the empty one a stated NULL means.
 *
 * `firstStated` keeps a stored `null`, and it is an answer rather than an
 * absence: the site defines no viewport tiers, and that outranks a route
 * context which has some. A compile context declares `breakpoints` as a set,
 * so the null cannot be handed on as it stands — an empty set is the same
 * statement in the shape the compiler declares, and yields the same contexts.
 *
 * Normalised at the COMPILE boundary rather than inside the reconciler, which
 * has to go on reporting what was stated: a surface asking which breakpoints a
 * page compiles against needs to tell "the site said none" from "nobody said
 * anything", and an empty set collapses those into one.
 */
export function statedBreakpoints(
  set: BreakpointSet | null | undefined
): BreakpointSet | undefined {
  if (set === undefined) return undefined;
  return set ?? { viewport: [], container: [] };
}

/**
 * Resolve every shared input once, so the compiles cannot disagree.
 *
 * PUBLISHED from the package entry, and it was not always. The reason it was
 * withheld is the reason it is now out: a third compile exists — the editor
 * asks for the cascade behind the page so its inspector can say where a value
 * came from — and a context assembled independently there carries no named
 * classes, so a value from `.card` reports as coming from nowhere. Withholding
 * this left that assembly as the only option; publishing it makes asking the
 * cheaper one.
 *
 * The defect this exists to prevent is not a wrong precedence — it is two
 * computations of one question. Each field therefore keeps the precedence it
 * already had, and only the number of places that decide changes:
 *
 * - `breakpoints` and `blockBases` take the site's when it has one. The site
 *   tier is the stored one, and stored overrides code, which is the layering
 *   every global-styles system uses.
 * - `namedClasses` lets a context that states its own outrank the site's, the
 *   rule this render already applied. This one is applied to the PAGE context
 *   only: the sheet keeps emitting the site's library, because deferring means
 *   deferring attribution, not losing the rules.
 * - `tokenPrefix` follows the sheet, which reads `tokenPrefix` then the token
 *   set's own `prefix`; the context's is the last fallback rather than the
 *   first, because the declaration site is what a reference has to match.
 *
 * Only defined values are returned, so spreading this over a context adds no
 * key the caller did not have.
 */
export function sharedStyleInputs(
  styleContext: StyleCompileContext | undefined,
  site: SiteSheetInput | undefined
): ReconciledStyleInputs {
  // Both tiers normalised once. Every field below would otherwise repeat the
  // same two absence checks, and the resolution is easier to read as a list of
  // precedences than as a list of optional chains.
  const route: Partial<StyleCompileContext> = styleContext ?? {};
  const stored: Partial<SiteSheetInput> = site ?? {};
  return defined({
    breakpoints: firstStated(stored.breakpoints, route.breakpoints),
    namedClasses: firstStated(route.namedClasses, stored.classes),
    blockBases: firstStated(stored.blockBases, route.blockBases),
    tokenPrefix: firstStated(
      stored.tokenPrefix,
      stored.tokens?.prefix,
      route.tokenPrefix
    ),
    // Reconciled from BOTH tiers, like every other shared field. Read from the
    // route alone, a caller stating it on `siteStyles` would have it reach the
    // site sheet through `...siteInput` while the page context compiled node
    // rules published — one render carrying two answers to one breakpoint.
    //
    // The route wins where both state it: which surface is doing the previewing
    // is a fact about this render, while the stored tier describes the site.
    previewContainer: firstStated(
      route.previewContainer,
      stored.previewContainer
    ),
    // The same precedence, for the same reason: whether this surface is
    // previewing an interaction state is a fact about THIS render, while a
    // stored tier describes the site. A site record has no business turning
    // forceable states on for a published page.
    previewStates: firstStated(route.previewStates, stored.previewStates),
  });
}

/** The first tier that stated this input, in the precedence its field has. */
function firstStated<T>(...tiers: readonly (T | undefined)[]): T | undefined {
  return tiers.find(tier => tier !== undefined);
}

/**
 * The same object without its unstated keys.
 *
 * Spreading a key whose value is `undefined` is not the same as omitting it:
 * the context would then carry the key, and a reader asking whether it was
 * stated gets the wrong answer.
 */
function defined(value: ResolvedShared): ReconciledStyleInputs {
  return Object.fromEntries(
    Object.entries(value).filter(([, stated]) => stated !== undefined)
  );
}

/**
 * Renders a block document as React.
 *
 * A Server Component, and synchronous: nothing at this level needs to wait, so
 * the page's own shell is not held behind a promise. Individual blocks that ARE
 * asynchronous suspend on their own, and stream in independently.
 *
 * Three things happen here that cannot happen inside a block:
 *
 * 1. **Migration.** Stored nodes carry the schema version they were written
 *    against, and the forgiving pass brings each one up to its block's current
 *    version. Nodes that cannot be upgraded are flagged rather than dropped, so
 *    a document that outran a block's migrations still renders everything else.
 * 2. **Styles.** The stylesheet and the node-to-class map are resolved once for
 *    the whole document, because the class a node gets depends on every other
 *    node's id — two ids can hash alike, and only a pass over all of them sees
 *    it.
 * 3. **The page root.** The compiler anchors every selector at the page root
 *    class, so the element carrying it has to exist or no rule matches
 *    anything.
 */
export function PageRenderer({
  document,
  context,
  blocks,
  definitions,
  styles,
  styleContext,
  siteStyles,
  nodeAttribute,
  blockFallback,
  limits,
  hostPolicy,
}: PageRendererProps): ReactElement {
  const resolver = blocks ?? registeredBlocks();
  // Passed through untouched. The policy travels beside the context rather than
  // on it, so a host's own object is never copied — and no copy of it is
  // faithful, since a class-based context loses prototype methods to a spread
  // and native private fields to any clone at all.
  const pageContext = context ?? createStandaloneContext();

  // Migrated against the SAME resolver that will render, so the versions nodes
  // are upgraded to are the versions the definitions doing the rendering
  // expect. Reading migrations from the global registry while rendering from a
  // fixture set would produce props no one asked for and no error to explain
  // them.
  // The shape is made sound before anything walks it. The engine's migrator,
  // tree helpers and style compiler all assume a well-formed forest, and this
  // renderer is handed whatever the database returned — a slot holding an
  // object instead of a list would otherwise throw here, in the page component
  // itself, where no per-block boundary can contain it.
  // A document written by a newer formatter is refused rather than read. The
  // envelope itself may mean something different, so migrating and rendering
  // whatever sits under `nodes` shows content that was never authored this way
  // — worse than showing nothing, because nothing announces itself.
  // The ENVELOPE is database input too, and it is read before any of the
  // repair passes that make its contents safe. A corrupt JSON column holding
  // `null` throws on the first property access below, in the page component
  // itself, where no block boundary exists to contain it. (A primitive does
  // not throw — it just reads `undefined` — but it is no more renderable, so
  // both are refused the same way.)
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return (
      <div className={PAGE_ROOT_CLASS}>
        <BlockPlaceholder reason="unsupported-format" type="document" />
      </div>
    );
  }

  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) {
    return (
      <div className={PAGE_ROOT_CLASS}>
        <BlockPlaceholder
          reason="unsupported-format"
          type={`formatVersion ${String(document.formatVersion)}`}
        />
      </div>
    );
  }

  // The shared pipeline, reporting every state it passed through. The passes and
  // their order live in one place now; what stays here is the artifact question
  // this file alone can answer — whether a stored stylesheet still describes the
  // tree that renders — which reads those states rather than recomputing them.
  const stages = prepareDocumentReadStages(document, {
    resolver,
    limits,
    styleContext,
    definitions,
  });
  // `null` here means only an unreadable ENVELOPE, which the two guards above
  // already answered. Kept because unreachability is a property of the current
  // call graph rather than of the code, and this guard costs a comparison over a
  // value already in hand.
  if (stages === null) {
    return (
      <div className={PAGE_ROOT_CLASS}>
        <BlockPlaceholder reason="unsupported-format" type="document" />
      </div>
    );
  }
  const {
    sanitized,
    resolved,
    migrated: doc,
    gated: pruned,
    deduped: visible,
  } = stages;

  // The scope comes from whichever input supplied the stylesheet, never from a
  // separate prop. Two inputs would have to agree, and when they did not the
  // root would carry a class the selectors never mention, so every compiled rule
  // would match nothing while both inputs looked correct on their own. Gating
  // runs before styles are resolved, so the stylesheet and the markup are
  // compiled from the same document.

  // Whether the tree that renders is the tree the stored stylesheet was
  // compiled from. Each pass returns its input unchanged when it had nothing to
  // do, so identity is the signal — and gating is only one of three ways the
  // answer can be no. Shape repair drops nodes whose identity fields are
  // unreadable, and address repair drops a repeat and strips a duplicated
  // `cssId`; in every case the stored sheet still carries rules for something
  // that is no longer on the page, and with duplicate node ids those rules
  // target the class the SURVIVING node now wears. So the sheet is recompiled
  // where it can be and withheld where it cannot, for any of the three.
  //
  // A knowable placeholder counts as a fourth. Such a node emits only a hidden
  // marker, so a stored sheet compiled for the markup it WOULD have rendered
  // ships rules for content that is not on the page, including whatever those
  // rules reference. Identity alone misses it: the node is skipped by the
  // predicate above, so when nothing else collided the tree comes back
  // unchanged and the stale sheet would be trusted. Skipping the reservation
  // and then trusting the sheet is worse than either on its own, because the
  // colliding case previously repaired the tree and therefore recompiled.
  // Gating is the one repair cause a stored artifact can answer on its own: an
  // artifact carrying `gated` holds each conditioned node's rules separately, so
  // the reader appends the survivors instead of recompiling the whole sheet or
  // withholding it. A MISSING map is not the same as an empty one — it means the
  // sheet was compiled before the split existed and knows nothing about gating —
  // so only a READABLE map licenses skipping the recompile. Read through the same
  // helper the delivery uses: a malformed map counting as coverage here while the
  // delivery refuses to read it is how the stale sheet shipped.
  //
  // Duplicate ids in the STORED document disqualify it, even when pruning makes
  // them disappear. The compiler writes no node-local rules at all for an id more
  // than one node carries, since they cannot be styled apart; if one of the pair
  // was the gated one, pruning removes it and the collision is gone from the tree
  // that renders — `visible === pruned`, nothing to repair — while the stored
  // sheet is still missing the SURVIVOR's rules. The pre-prune document is the
  // only place that evidence still exists.
  const gatedRules = readableGatedRules(styles);
  const gatingCoveredByArtifact =
    pruned !== doc &&
    gatedRules !== undefined &&
    gatedMapCoversPrunedNodes(doc, pruned, gatedRules) &&
    !hasDuplicateNodeIds(doc);

  // A node whose block declares it draws nothing is dropped from the style input
  // for the same reason a gated one is: every rule compiled for the markup it
  // would have drawn matches nothing and ships anyway, publishing whatever those
  // rules named. It is dropped only where doing so does not cost the page its
  // stylesheet, which is the whole difference between this and the passes above.
  //
  // It costs nothing exactly when the artifact already holds those rules per
  // node, as it does for a gated one: the compiler is told which nodes draw
  // nothing through the same rule used here, so a sheet compiled since carries an
  // entry for each of them and the reader appends only survivors.
  //
  // Nothing is dropped on a render that COMPILES, and nothing needs to be. The
  // compiler holds a drawless node's rules back at the source, into `gated`
  // rather than into `css`, so a sheet built on this render never contained them
  // — pruning the tree first would change which rules exist, not which ship, and
  // would cost an identity comparison the repair decision reads.
  //
  // What is left is the ordinary published page with a sheet stored before any of
  // this existed, and there the node STAYS: its unused rules ship, as they always
  // have. That is the deliberate direction. An image waiting for its picture is
  // an authoring state, not a failure, and blanking every rule on the page over
  // it would be a far larger regression than the bytes it saves. Republishing the
  // page compiles the entries and the drop starts working, with nothing to
  // invalidate by hand.
  // Asked through the SAME derivation `resolvePageStyles` will use, so what is
  // pruned here and what the compiler gated cannot describe different nodes.
  // Only walked when a gated map could cover the drop. Without one the answer is
  // fixed — the node stays — so asking every block would run each plugin's
  // `rendersNothing` over the whole tree to reach a conclusion already known.
  // That is the standalone compile path, where the compiler holds those rules
  // back at the source and nothing here needs to.
  const drawsNothing = drawlessTestFor(resolver);
  const drawlessDropped =
    gatedRules === undefined
      ? visible
      : pruneNodes(visible, node => !drawsNothing(node));
  const drawlessCoveredByArtifact =
    drawlessDropped !== visible &&
    gatedRules !== undefined &&
    gatedEntriesCoverRemovedNodes(visible, drawlessDropped, gatedRules) &&
    !hasDuplicateNodeIds(doc);
  const drawlessInput = drawlessCoveredByArtifact ? drawlessDropped : visible;
  // Compiled from a tree with the knowable placeholders removed, while the
  // render keeps them so their placeholders still appear.
  const styleInput = pruneRenderedPlaceholders(drawlessInput, resolver);

  // Whether a knowable placeholder was removed AT ALL, asked of `visible` rather
  // than of what the drawless drop left. The two passes can reject the SAME node
  // — a migration-failed node whose last stored props also make its block declare
  // it draws nothing — and then the drawless drop takes it first, the placeholder
  // pass finds nothing to do, and comparing that pass against its own input reads
  // as "no placeholder was removed". The artifact covers the node's own rules, so
  // the drop is honest; what it cannot cover is the rest of what a placeholder
  // means for the sheet, and that answer must not depend on which pass reached
  // the node first.
  const placeholderDropped = pruneRenderedPlaceholders(visible, resolver);

  // Each pass contributes against the SAME base for the same reason. Folding
  // them into one `styleInput !== visible` would let a covered drawless drop
  // excuse a placeholder removal in the same step, and only a recompile can
  // answer for that one.
  const repairedDocument =
    sanitized !== document ||
    // Composition is a sixth, and the only one that ADDS nodes rather than
    // removing them: a stored sheet names the page's own ids, and an inlined
    // component's are not among them.
    //
    // Redundant today with the artifact's own unaccounted-node check, for the
    // reason recorded beside the same clause in `read-page.ts` — every node
    // gets a class, so a replaced instance always trips that one first. Kept
    // because the redundancy is a property of class assignment rather than of
    // composition, and inheriting a guarantee from something that never
    // promised it is how one lapses without a failing test.
    resolved !== sanitized ||
    (pruned !== doc && !gatingCoveredByArtifact) ||
    visible !== pruned ||
    (drawlessInput !== visible && !drawlessCoveredByArtifact) ||
    placeholderDropped !== visible ||
    // Asked through the SAME function the exported read path uses. A migration
    // can turn a node that drew into one that draws nothing, and no comparison
    // above can see it: every pass returns what it was given, because nothing
    // was removed. Answering it here as well is the point — the two paths
    // agreeing is what stops a page rendered through this component keeping
    // rules the exported reader withholds for the same document.
    migrationChangedWhatDraws(stages, resolver, styles);

  // Reconciled through the SAME derivation every entry point that resolves a
  // stored page uses. What a caller supplies is not what a page compiles with:
  // the scope lives on the artifact, the caps come from this prop, and a
  // caller's own fetch predicate needs an identity before a stored sheet can be
  // judged against it.
  const siteInput = siteStyles === false ? undefined : siteStyles;
  // Every site-level input BOTH compiles read, resolved once. See
  // `sharedStyleInputs` for why one resolution rather than one per consumer.
  const shared = sharedStyleInputs(styleContext, siteInput);
  const pageShared = shared;
  // Present whenever the render knows this site's breakpoints, whether they came
  // from a compile context or from `siteStyles`. Taking only the context leaves
  // the documented normal path — a route that supplies a stored artifact and the
  // site's styles, and compiles nothing itself — with no identity to compare a
  // stamp against and no inputs to recompile from, so a stored sheet is reused
  // however far the site's classes, prefix or breakpoints have moved since.
  //
  // Breakpoints are the condition because they are the one field a compile
  // cannot proceed without, and because it is already the condition this render
  // uses to decide whether a site sheet can be built at all. A render that knows
  // them can compile both sheets; one that does not can compile neither, and
  // there the stored artifact is all there is.
  const pageBreakpoints = statedBreakpoints(pageShared.breakpoints);
  const pageStyleContext: StyleCompileContext | undefined =
    styleContext !== undefined
      ? {
          ...styleContext,
          ...withoutStatedNulls(pageShared),
          // Resolved rather than spread, so the normalised set replaces the
          // null the reconciler may legitimately have stated.
          breakpoints: pageBreakpoints ?? styleContext.breakpoints,
        }
      : pageBreakpoints === undefined
        ? undefined
        : {
            ...withoutStatedNulls(pageShared),
            breakpoints: pageBreakpoints,
            // The site's own fetch predicate, handed to the reconciler rather
            // than reconciled here. `effectiveCompile` derives ONE predicate and
            // gives it to both compiles — but only from what the context it is
            // passed carries, and a synthesized context that omitted this would
            // leave the site sheet judging a `url(...)` by the site's rules
            // while the page sheet beside it judged the same value by the host's
            // alone. The site sheet is emitted FIRST, so a page sheet cannot
            // retract what it published.
            //
            // It carries no identity — `SiteSheetInput` has no `fetchPolicyId`,
            // because the site artifact is addressed by the hash of its own
            // bytes and needs none. So a page compiled under it is compiled
            // under an ANONYMOUS predicate, and `effectiveCompile` already
            // states what that means: no stored sheet can be judged against a
            // predicate nothing can name, so every one of them is recompiled.
            // That cost is the site opting into its own predicate, and it is the
            // same answer a caller gets for passing one on the style context.
            ...(siteInput?.mayFetchUrl === undefined
              ? {}
              : { mayFetchUrl: siteInput.mayFetchUrl }),
          };

  const {
    context: compileContext,
    fetchPolicyId,
    mayFetchUrl,
  } = effectiveCompile({
    styleContext: pageStyleContext,
    styles,
    limits,
    remotePatterns: hostPolicy?.remotePatterns,
  });

  const { css, classes, scope } = resolvePageStyles(
    styleInput,
    styles,
    compileContext,
    resolver,
    repairedDocument,
    {
      fetchPolicyId,
      // The tree the stored artifact describes. This render prunes before it
      // resolves — a gated drop and a drawless drop are both covered by the
      // artifact and licensed to keep it — and both can remove the last node of
      // a type, so anything derived from `styleInput` for the identity would
      // drop that type's defaults and refuse the artifact those passes exist to
      // preserve. This is the only place that still holds the wider tree.
      storedDocument: doc,
    }
  );
  const rootClassName = scope ? `${PAGE_ROOT_CLASS} ${scope}` : PAGE_ROOT_CLASS;

  // Tokens LAYERED over the defaults, never replacing them: a site supplying
  // one brand colour must not thereby lose `content.width` and `space.4`, and
  // losing them is silent because an unresolved custom property invalidates the
  // declaration rather than reporting anything. `resolveSiteTokens` is the one
  // answer to "what tokens does this site have" — asked here and by anything
  // that edits them, so the two cannot drift.
  //
  // Resolved even when the host names no tokens of its own, which is what makes
  // the default set reach a page at all. Until this existed nothing called
  // `compileSiteSheet`, so `defaultSiteTokens()` was a default nobody applied
  // and every `{ $token }` compiled to a `var()` with nothing behind it.
  // Derived ONCE, and from the RECONCILED context rather than from the caller's
  // `styleContext`: a consumer rendering a stored artifact supplies no context
  // of its own, and taking the raw prop would leave the ordinary production path
  // with no sheet. Two answers to "what are this site's breakpoints" is also how
  // the shared sheet and the page sheet come to disagree about which at-rules a
  // tier is emitted under, invisibly, since each sheet is consistent on its own.
  const siteBreakpoints =
    siteStyles === false ? undefined : statedBreakpoints(shared.breakpoints);
  // The input both compilers below are given, assembled ONCE. Breakpoints are
  // the only member either of them disagrees about, so stating the rest twice
  // is how the two paths would come to answer differently about a prefix or a
  // fetch predicate while each stayed self-consistent.
  const siteSheetInput = {
    ...siteInput,
    // The RESOLVED values, the same objects the page context above was
    // given. Spreading `siteInput` alone would leave each consumer
    // computing its own answer, which is the defect this closes.
    ...(shared.blockBases == null ? {} : { blockBases: shared.blockBases }),
    ...(shared.tokenPrefix == null ? {} : { tokenPrefix: shared.tokenPrefix }),
    tokens: resolveSiteTokens(siteInput?.tokens),
    // The SAME predicate the page sheet is compiled with, taken from the
    // one place it is derived rather than derived again here. The class
    // and block-default tiers are emitted verbatim into every page, so
    // without this a stored class could name a host the node styles
    // beside it are refused for — and this sheet is emitted first, where
    // a later omission cannot retract it. A caller who put a predicate on
    // `siteStyles` keeps it, matching how `effectiveCompile` treats one
    // on the style context.
    ...(mayFetchUrl === undefined || siteInput?.mayFetchUrl !== undefined
      ? {}
      : { mayFetchUrl }),
    // The RESOLVED preview option, from the same reconciliation the page
    // context above was given. A shared tier compiled for the published
    // page beneath node styles compiled for a preview surface puts two
    // answers to one breakpoint in one document.
    // Carried into the SITE sheet as well as the page compile. A named
    // class and a block-type default are emitted here, so an editor that
    // asked only the page compile for forceable states gets a selected
    // block whose hover appearance comes from a class showing nothing.
    // ALWAYS written, rather than only when it is true. `siteInput` is
    // spread above and can carry a preview flag of its own, so a
    // conditional override is silently one-directional: a route turning
    // the option OFF resolves correctly here and then loses to the value
    // already in the spread, leaving the page sheet on published
    // selectors while the class and block-default tiers use preview ones.
    // Route-wins precedence has to be able to win downwards too.
    previewStates: shared.previewStates === true,
    ...(shared.previewContainer == null
      ? {}
      : { previewContainer: shared.previewContainer }),
  };

  // A sheet by DEFAULT. Without one a block cannot reference a token at all —
  // a default reading `color.surface` would resolve on a route and resolve to
  // nothing here — which is why `core/card` shipped with no background.
  //
  // THREE outcomes, not two, because `siteBreakpoints` is undefined for two
  // unrelated reasons and they want opposite answers. `siteStyles === false` is
  // a caller declining the sheet, and a token tier emitted anyway would override
  // the declining host's own custom properties. Breakpoints merely not stated is
  // a caller who said nothing, and there the token tier is the half that must
  // still arrive: a stored artifact carries `var(--site-*)` references whose
  // declarations live nowhere else, and a custom property nothing declares makes
  // its whole declaration invalid at computed-value time — so the property falls
  // to its initial value, which for `border-color` is `currentColor` rather than
  // nothing. Only the block-default and named-class tiers are withheld there,
  // being the two the site's breakpoints decide the at-rules for.
  //
  // Paired with the page CSS rather than emitted beside every render: the token
  // tier exists to resolve `var(--site-*)` in that CSS, so with no page sheet
  // nothing references it, and declaring the custom properties anyway would push
  // `--site-*` onto a host that asked this renderer for markup alone. It is also
  // what stops a stylesheet withheld as untrustworthy from acquiring a companion
  // sheet that the withholding was meant to suppress.
  const siteSheet =
    siteStyles === false
      ? undefined
      : siteBreakpoints === undefined
        ? css === ""
          ? undefined
          : compileSiteTokenSheet(siteSheetInput)
        : compileSiteSheet({
            ...siteSheetInput,
            breakpoints: siteBreakpoints,
          });

  return (
    <div className={rootClassName}>
      {siteSheet?.css ? (
        // FIRST, because order is the cascade: the site sheet carries font
        // faces, tokens and block-type defaults, and the page's own sheet is
        // appended after so a node's value beats a class and a class beats a
        // block default. Emitted with its content hash, which is what lets a
        // host recognise the same bytes across pages and serve them once.
        <style
          data-nx-site-sheet={siteSheet.contentHash}
          dangerouslySetInnerHTML={{
            __html: styleTextForInjection(siteSheet.css),
          }}
        />
      ) : null}
      {css ? (
        // Injected as raw text rather than as a child, because React escapes a
        // text child and a stylesheet cannot survive that: `&` and `>` are
        // ordinary in selectors and would arrive as entities. What that costs
        // is neutralised in `styleTextForInjection`.
        <style
          dangerouslySetInnerHTML={{ __html: styleTextForInjection(css) }}
        />
      ) : null}
      <BlockList
        nodes={visible.nodes}
        context={pageContext}
        blocks={resolver}
        classes={classes}
        fallback={blockFallback}
        {...(hostPolicy === undefined ? {} : { hostPolicy })}
        {...(nodeAttribute === undefined ? {} : { nodeAttribute })}
      />
    </div>
  );
}
