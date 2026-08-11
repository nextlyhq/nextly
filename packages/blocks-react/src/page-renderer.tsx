import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  PAGE_ROOT_CLASS,
  isFetchableUrl,
  migrateDocument,
  walkNodes,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
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
  registeredBlocks,
  migrationSourceFor,
  type BlockResolver,
} from "./resolver";
import { dedupeNodeIds, sanitizeDocument } from "./sanitize";
import {
  UNIDENTIFIED_FETCH_POLICY,
  fetchPolicyLabel,
  isRecordedGatedEntry,
  readableGatedRules,
  resolvePageStyles,
  styleTextForInjection,
  type PageStyles,
} from "./styles";
import {
  drawsNothing,
  pruneDrawlessNodes,
  pruneHiddenNodes,
  pruneNodes,
} from "./visibility";

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
}

/**
 * Whether a node will render its own host markup, decided BEFORE rendering.
 *
 * Two passes need this answer early: address repair, which must not let a node
 * that emits no `id` reserve one away from a healthy sibling, and the stylesheet
 * decision, which must not publish rules compiled for markup that never ships.
 *
 * Only the placeholder outcomes that are knowable from the document and the
 * resolver are covered — an unregistered type, a failed migration, and a node
 * stored ahead of the definition that would render it. All three are pure
 * comparisons.
 *
 * A block DECLARING that its props draw nothing (`rendersNothing`) is a separate
 * question, answered by `pruneDrawlessNodes` rather than here, because the two
 * are not equally safe to act on. A node this pass rejects resolves to a visible
 * placeholder, which is already an exceptional state; a block that draws nothing
 * is an ordinary one — an image waiting for its picture — and dropping it costs
 * the page its stylesheet unless the stored sheet can account for it.
 *
 * It is consulted ELSEWHERE too, and the distinction is worth keeping straight:
 * the block boundary reads it to decide whether a node's `cssId` and attributes
 * may be refused, which is a question about one node's own output and costs
 * nothing when the answer is wrong in the safe direction.
 *
 * The rest are NOT knowable here, and deliberately so: whether a block throws,
 * returns something unrenderable, or renders a given slot at all is only
 * settled by calling it, which happens inside the boundary further down. A node
 * that ends in one of those placeholders can still reserve an address it never
 * uses. Closing that would mean deciding addresses after render, which is a
 * different design than compiling the document once up front.
 */
function rendersOwnMarkup(node: BlockNode, resolver: BlockResolver): boolean {
  if (node.migrationFailed === true) return false;
  const definition = resolver.get(node.type);
  if (definition === undefined) return false;
  return node.version <= definition.version;
}

/**
 * Whether the artifact holds the OWN rules of every node the prune removed.
 *
 * "A map is present" is not coverage. A stored artifact can be stale relative to the document it
 * is rendered with — compiled when one node was unconditional, so its rules are in `css`, while a
 * different node was already gated and has an entry. The map exists, but it does not cover the
 * node that was actually pruned, and serving the stored sheet publishes that node's rules and
 * asset URLs.
 *
 * The compiler writes an entry for EVERY node it holds back, including one with no styles of its
 * own, so an id missing from the map means the artifact was compiled when that node was still
 * being served. That makes presence-per-removed-id an exact test rather than a heuristic.
 *
 * The ENTRY has to be usable, not merely present. A key whose value the delivery refuses to read
 * certifies coverage that never reaches the sheet, which is the same divergence one value deeper.
 *
 * This is the NODE-LOCAL half on its own, because the two prunes that ask it need different
 * amounts. Written once so neither can drift from the other on the part they share.
 */
function gatedEntriesCoverRemovedNodes(
  before: BlockDocument,
  after: BlockDocument,
  gated: Readonly<Record<string, unknown>>
): boolean {
  const surviving = new Set<string>();
  walkNodes(after.nodes, node => surviving.add(node.id));
  let covered = true;
  walkNodes(before.nodes, node => {
    if (surviving.has(node.id)) return;
    if (!isRecordedGatedEntry(gated[node.id])) covered = false;
  });
  return covered;
}

/**
 * Whether the artifact's gated map accounts for every node the visibility prune removed.
 *
 * The node-local rules, plus one thing more. The map holds a node's OWN rules; a block type's
 * defaults are shared, emitted once per type into the main sheet, and stay there — so when pruning
 * removes the last instance of a type, the stored sheet still publishes that type's defaults, and
 * any `url(...)` in them, for a block nobody was served. Only a recompile can drop a type-level
 * rule, so the artifact cannot cover this case and must not claim to.
 *
 * Asked HERE and not of a draws-nothing node, and the difference is what the two prunes are for. A
 * condition withholds content from a reader, so the block a page was built from is itself part of
 * what is being withheld and a rule naming that type says something. A block that draws nothing is
 * an ordinary node the site uses and will draw again as soon as it is filled in; its type's
 * defaults come from the block package rather than from the document, and refusing coverage over
 * them would leave the drop unreachable for the page with one image and no second one.
 */
function gatedMapCoversPrunedNodes(
  before: BlockDocument,
  after: BlockDocument,
  gated: Readonly<Record<string, unknown>>
): boolean {
  const survivingTypes = new Set<string>();
  walkNodes(after.nodes, node => survivingTypes.add(node.type));
  const surviving = new Set<string>();
  walkNodes(after.nodes, node => surviving.add(node.id));
  let covered = gatedEntriesCoverRemovedNodes(before, after, gated);
  walkNodes(before.nodes, node => {
    if (surviving.has(node.id)) return;
    if (!survivingTypes.has(node.type)) covered = false;
  });
  return covered;
}

/**
 * Whether any id appears on more than one node.
 *
 * The compiler suppresses the node-local rules of every node sharing an id, so a stored sheet
 * compiled from such a document is missing them — and stays missing them after a prune removes the
 * duplicate that made the collision visible.
 */
function hasDuplicateNodeIds(document: BlockDocument): boolean {
  const seen = new Set<string>();
  let duplicate = false;
  walkNodes(document.nodes, node => {
    if (seen.has(node.id)) duplicate = true;
    seen.add(node.id);
  });
  return duplicate;
}

/**
 * The tree a stylesheet should be compiled from.
 *
 * A node that resolves to a placeholder emits only a hidden marker, so every
 * rule compiled for the markup it WOULD have rendered matches nothing and ships
 * anyway, carrying whatever those rules referenced. Dropping the node from the
 * style input is what stops that.
 *
 * It has to be a SEPARATE tree from the one that renders. The render still
 * needs the node, because drawing its placeholder is how the failure becomes
 * visible; only the stylesheet should pretend it was never there. Marking the
 * document "repaired" is not enough on its own, because recompiling from a tree
 * that still contains the node produces the same rules again.
 *
 * The subtree goes with it: a placeholder replaces the node entirely, so its
 * children never reach the page either.
 *
 * Returns the ORIGINAL document when every node renders, so the common case
 * allocates nothing and the caller can compare by identity.
 */
function pruneKnownPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  return pruneNodes(document, node => rendersOwnMarkup(node, resolver));
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

  const sanitized = sanitizeDocument(
    document,
    limits ?? styleContext?.limits ?? DEFAULT_LIMITS
  );
  const { doc } = migrateDocument(sanitized, migrationSourceFor(resolver));

  // The scope comes from whichever input supplied the stylesheet, never from a
  // separate prop. Two inputs would have to agree, and when they did not the
  // root would carry a class the selectors never mention, so every compiled
  // rule would match nothing while both inputs looked correct on their own.
  // Gated nodes leave the tree BEFORE styles are resolved, so the stylesheet
  // and the markup are compiled from the same document. Filtering only the
  // render would withhold a gated node's HTML while still publishing its
  // scoped CSS, and with it whatever that CSS referenced.
  const pruned = pruneHiddenNodes(doc);

  // Addresses are made unique LAST, over what will actually render. A gated node
  // never reaches the page, so letting it reserve a node id or a DOM id would
  // take that address from a visible node for nothing: the visible one would be
  // dropped or stripped of its anchor, and the node it collided with would then
  // be pruned anyway.
  //
  // The children of a node that is already known to placeholder are in the same
  // position. The node itself still renders its marker and still needs a key,
  // but a placeholder replaces the node entirely, so nothing below it reaches
  // the page and nothing below it should hold an address.
  const visible = dedupeNodeIds(pruned, node =>
    rendersOwnMarkup(node, resolver)
  );

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
  const drawlessDropped = pruneDrawlessNodes(visible, resolver);
  const drawlessCoveredByArtifact =
    drawlessDropped !== visible &&
    gatedRules !== undefined &&
    gatedEntriesCoverRemovedNodes(visible, drawlessDropped, gatedRules) &&
    !hasDuplicateNodeIds(doc);
  const drawlessInput = drawlessCoveredByArtifact ? drawlessDropped : visible;
  // Compiled from a tree with the knowable placeholders removed, while the
  // render keeps them so their placeholders still appear.
  const styleInput = pruneKnownPlaceholders(drawlessInput, resolver);

  // Each pass is compared against ITS OWN input rather than folding two removals
  // into one identity test. A single `styleInput !== visible` would let a covered
  // drawless drop excuse a placeholder removal that happened in the same step,
  // and that removal is one only a recompile can answer for.
  const repairedDocument =
    sanitized !== document ||
    (pruned !== doc && !gatingCoveredByArtifact) ||
    visible !== pruned ||
    (drawlessInput !== visible && !drawlessCoveredByArtifact) ||
    styleInput !== drawlessInput;

  // Recompiling after pruning must not lose what the stored artifact and the
  // renderer knew. `scope` lives on the artifact rather than in the compile
  // context, and the effective limits come from the prop — so passing the raw
  // context would rebuild a scoped page unscoped, letting its rules reach
  // another document rendered beside it, and would repair against default caps
  // a caller had deliberately raised.
  const effectiveLimits = limits ?? styleContext?.limits ?? DEFAULT_LIMITS;
  // A stylesheet fetches too. `background-image: url(...)` is a request the
  // browser makes on every page the rule applies to, so the host's list has to
  // reach the compile as well as the blocks — asked of the SAME list, through a
  // predicate the engine calls, so the two channels cannot drift apart.
  //
  // A caller's own `mayFetchUrl` wins. It is the more specific answer, and a
  // host that passed one deliberately should not have it replaced by one
  // derived here.
  const patterns = hostPolicy?.remotePatterns;
  // The label a compiled sheet is stamped with, and the one a stored sheet is
  // checked against. Derived from the patterns themselves so it changes exactly
  // when they do: an editor who adds a host gets every stored sheet recompiled
  // once, with nothing to remember to invalidate.
  //
  // A caller's OWN predicate is authoritative and opaque. It can encode rules no
  // pattern list describes, and nothing here can tell one such function from
  // another, so no label can describe it — and reusing a stored sheet across a
  // change to it would serve CSS whose URLs were admitted by rules that no
  // longer hold. A caller wanting its sheets cached states which policy its
  // predicate IS, through `fetchPolicyId` on the style context. One that does
  // not gets the safe answer rather than the fast one: an identity no artifact
  // can carry, so every stored sheet reads as compiled under another policy.
  const fetchPolicyId =
    styleContext?.mayFetchUrl === undefined
      ? fetchPolicyLabel(patterns)
      : (styleContext.fetchPolicyId ?? UNIDENTIFIED_FETCH_POLICY);
  const compileContext =
    styleContext === undefined
      ? undefined
      : {
          ...styleContext,
          limits: effectiveLimits,
          // The compiler is told which nodes draw nothing through the same rule
          // this render used to decide it, so a node's markup and its rules
          // cannot disagree about whether it is on the page. This is what makes
          // the drop above self-healing: a sheet compiled here holds each
          // drawless node's rules per node, so the NEXT render can drop them
          // from a stored artifact instead of needing a compile context.
          //
          // Passed even though the drawless nodes are already out of the tree
          // being compiled. The tree is only one input: `blockBases` still
          // reaches the compile, and a caller can hand `resolvePageStyles` a
          // document this pass never pruned.
          drawsNothing: (node: BlockNode) => drawsNothing(node, resolver),
          ...(patterns === undefined || styleContext.mayFetchUrl !== undefined
            ? {}
            : { mayFetchUrl: (url: string) => isFetchableUrl(url, patterns) }),
          // Only a STRING scope is carried over. The artifact is a database
          // record, so `scope` can be null or a number, and the compiler
          // dereferences it before any block boundary exists — a malformed one
          // would fail the whole page rather than render it unstyled.
          ...(styleContext.scope === undefined &&
          typeof styles?.scope === "string"
            ? { scope: styles.scope }
            : {}),
        };

  const { css, classes, scope } = resolvePageStyles(
    styleInput,
    styles,
    compileContext,
    resolver,
    repairedDocument,
    { fetchPolicyId }
  );
  const rootClassName = scope ? `${PAGE_ROOT_CLASS} ${scope}` : PAGE_ROOT_CLASS;

  return (
    <div className={rootClassName}>
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
      />
    </div>
  );
}
