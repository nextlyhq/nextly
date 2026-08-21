import {
  compileSiteSheet,
  DOCUMENT_FORMAT_VERSION,
  PAGE_ROOT_CLASS,
  resolveSiteTokens,
  type BlockDocument,
  type DocumentLimits,
  type SiteSheetInput,
  type StyleCompileContext,
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
 */
function pruneRenderedPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  return pruneNodes(document, node => rendersOwnMarkup(node, resolver));
}

/** Where a site-level input is reconciled, if it is reconciled at all. */
type SiteInputRole = "reconciled-here" | "reconciled-elsewhere" | "sheet-only";

/**
 * Which side of the render each site-level input belongs to.
 *
 * A `SiteSheetInput` field is read by both compiles or by the sheet alone. When
 * both read it, one render must resolve it once or the two disagree invisibly,
 * each internally consistent and neither reporting anything.
 *
 * `satisfies` rather than a type annotation, so the literal values survive:
 * `ReconciledHere` below reads them back, and an annotation would widen every
 * entry to the whole union and derive nothing. The mapped key set is what makes
 * a field added to `SiteSheetInput` a compile error here until it is
 * classified, and `ReconciledHere` is what makes classifying it "reconciled
 * here" an obligation on the resolver rather than a comment.
 */
// Only ever read as a type, by `ReconciledHere` below. It has to be a VALUE
// anyway: `satisfies` checks a value against a type, and it is what preserves
// the literal roles that a plain annotation would widen to the whole union —
// which is the difference between a table that derives an obligation and a
// table that documents an intention.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SITE_INPUT_ROLE = {
  // Decides which at-rules every tier is emitted under. Required on the compile
  // context, so a stored set that reached only the sheet would put the
  // block-default and class tiers under at-rules the page's own values never
  // use, and drop any value stored under an id the route's set does not define.
  breakpoints: "reconciled-here",
  // Reconciled onto the PAGE context only. The sheet always writes the site's
  // library, and the page compile attributes from the context's list when it
  // states one — a context stating its own defers ATTRIBUTION while the rules
  // stay in the sheet. Feeding the resolved list back to the sheet as well
  // drops the library whenever a context defers.
  classes: "reconciled-here",
  // The sheet emits the `.nx-bt-*` rules and the page compile decides which of
  // them a node inherits; the page sheet is appended after the shared one, so
  // two sets means one default silently overwriting the other.
  blockBases: "reconciled-here",
  // The sheet DECLARES the custom properties; the page compile REFERENCES
  // them. A prefix that reached only the sheet leaves every `{ $token }` on
  // every page pointing at a property nothing declared, and an unresolved
  // custom property invalidates the declaration rather than reporting.
  tokenPrefix: "reconciled-here",
  // Reconciled a level up, by `effectiveCompile`, which derives one predicate
  // and hands the same object to both. Classified rather than omitted so it is
  // not mistaken for an oversight — and it is the reason this table has three
  // roles instead of two, since calling it "shared" would promise a
  // reconciliation here that does not happen here.
  mayFetchUrl: "reconciled-elsewhere",
  // The sheet emits `@font-face` and the token blocks; the page compile emits
  // neither and reads neither.
  fonts: "sheet-only",
  tokens: "sheet-only",
} as const satisfies { [K in keyof Required<SiteSheetInput>]: SiteInputRole };

/** The inputs the resolver below must produce, taken from the table itself. */
type ReconciledHere = {
  [K in keyof typeof SITE_INPUT_ROLE]: (typeof SITE_INPUT_ROLE)[K] extends "reconciled-here"
    ? K
    : never;
}[keyof typeof SITE_INPUT_ROLE];

/** The name an input takes on the compile context, where it differs. */
type ContextKey<K> = K extends "classes" ? "namedClasses" : K;

/**
 * What `sharedStyleInputs` must return: every reconciled-here key, present.
 *
 * Required rather than optional on purpose. An optional key can be left out
 * silently, which is exactly the gap this table is supposed to close — a field
 * classified as reconciled here and then never reconciled.
 */
type ResolvedShared = {
  [K in ReconciledHere as ContextKey<K>]:
    | NonNullable<Required<SiteSheetInput>[K]>
    | undefined;
};

/** The same inputs as a context patch: unstated keys absent rather than undefined. */
type SharedStyleInputs = Partial<ResolvedShared>;

/**
 * Resolve every shared input once, so the two compiles cannot disagree.
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
function sharedStyleInputs(
  styleContext: StyleCompileContext | undefined,
  site: SiteSheetInput | undefined
): SharedStyleInputs {
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
function defined(value: ResolvedShared): SharedStyleInputs {
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
  const { sanitized, migrated: doc, gated: pruned, deduped: visible } = stages;

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
  const pageStyleContext =
    styleContext === undefined ? undefined : { ...styleContext, ...shared };

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
    { fetchPolicyId }
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
  const siteBreakpoints = siteStyles === false ? undefined : shared.breakpoints;
  // A sheet by DEFAULT. Without one a block cannot reference a token at all —
  // a default reading `color.surface` would resolve on a route and resolve to
  // nothing here — which is why `core/card` shipped with no background.
  // Withheld only when no breakpoints are known, because a sheet compiled
  // against breakpoints nobody chose would put the block-default tier under
  // at-rules the page sheet does not use.
  const siteSheet =
    siteBreakpoints === undefined
      ? undefined
      : compileSiteSheet({
          ...siteInput,
          // The RESOLVED values, the same objects the page context above was
          // given. Spreading `siteInput` alone would leave each consumer
          // computing its own answer, which is the defect this closes.
          breakpoints: siteBreakpoints,
          ...(shared.blockBases === undefined
            ? {}
            : { blockBases: shared.blockBases }),
          ...(shared.tokenPrefix === undefined
            ? {}
            : { tokenPrefix: shared.tokenPrefix }),
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
