/**
 * What a page's compile reads from the blocks it uses: each used type's base
 * styles, parts and child gaps, the compile context built from them, which
 * nodes draw nothing, and the islands a page hydrates.
 *
 * @module styles-block-inputs
 */
import {
  blockDefaultsOf,
  overlaidStyles,
  declaresNoMarkup,
  hasItemBindings,
  walkNodes,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockIsland,
  type BlockNode,
  type BlockPart,
  type NamedClass,
  type NodeStyles,
  type SiteTextMap,
  type StyleCompileContext,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { withTypographyDefaults } from "./blocks/typography-defaults";
import { prepareDocumentForRead } from "./prepare-document";
import type { PrepareDocumentArgs } from "./prepare-document";
import type { BlockResolver } from "./resolver";
import { withSiteTextBases, withSiteTextParts } from "./site-text-blocks";

/**
 * The shared default styles for every block type the document uses.
 *
 * The compiler emits one rule per block TYPE rather than copying a type's
 * defaults into every node, and it takes those defaults from the compile
 * context. A caller compiling at render time already handed this renderer the
 * resolver holding the definitions, so requiring them to mirror `baseStyles`
 * into the context as well is a coupling that is easy to miss and silent when
 * missed: the renderer still writes the block-type class and the sheet simply
 * has no rule for it, so every block loses its defaults and nothing says why.
 *
 * A context that already carries `blockBases` is left alone — an explicit
 * choice by the caller outranks what can be derived here.
 *
 * `stated` narrows a supplied record to this tree instead of deriving from the
 * resolver, and it is the same walk because it is the same question: which
 * types does this document draw defaults from. `compilePageCss` reads a base
 * only for a type the document uses, so a site library carrying every block it
 * has installed emits nothing for the rest — and anything keyed on what the
 * sheet contains must not move when a default changes for a type this page does
 * not hold.
 */
export function blockBasesFor(
  document: BlockDocument,
  blocks: BlockResolver,
  stated?: Readonly<Record<string, NodeStyles>>,
  /**
   * The site's edits to its block types' own looks, laid over each base, so
   * the order is: the definition's base, then the site's edit of it, then a
   * look, a shared style and the block's own values.
   */
  siteDefaults?: Readonly<Record<string, NodeStyles>>,
  /**
   * The site's text, whose Buttons row is laid over each base drawing a
   * button, between the definition's base and the site's edit of it.
   */
  siteText?: SiteTextMap,
  /** The site's classes, for a row that follows a text style. */
  classes?: readonly NamedClass[]
): Record<string, NodeStyles> {
  // A derived default is the definition's own, a host's replacement included;
  // a stated record is the caller's own choice and is narrowed as it is.
  const bases = withSiteTextBases(
    perUsedType(document, blocks, definition => definition.baseStyles, stated),
    siteText,
    classes
  );
  if (siteDefaults === undefined) return bases;
  const edited = perUsedType(document, blocks, () => undefined, siteDefaults);
  for (const [type, edit] of Object.entries(edited)) {
    bases[type] = overlaidStyles(bases[type], edit);
  }
  return bases;
}

/**
 * The parts of each block type this document draws, keyed by type.
 *
 * The same question as {@link blockBasesFor} asked of a different field, and it
 * goes through the same walk for that reason: two walkers agreeing today drift
 * apart later, and the drift would be silent — one tier of a block's styles
 * would keep reaching the sheet while the other stopped, which reads as the
 * block having declared nothing.
 */
export function blockPartsFor(
  document: BlockDocument,
  blocks: BlockResolver,
  stated?: Readonly<Record<string, Readonly<Record<string, BlockPart>>>>,
  /** The site's text, whose Buttons and Captions rows reach the parts drawing one. */
  siteText?: SiteTextMap,
  /** The site's classes, for a row that follows a text style. */
  classes?: readonly NamedClass[]
): Record<string, Readonly<Record<string, BlockPart>>> {
  return withSiteTextParts(
    perUsedType(document, blocks, definition => definition.parts, stated),
    siteText,
    classes
  );
}

/**
 * The space each container type this document draws puts between its
 * children, keyed by type.
 *
 * Read through the same walk as {@link blockBasesFor}, so the gap of a
 * container reaches the sheet exactly when its defaults do.
 */
function childGapsFor(
  document: BlockDocument,
  blocks: BlockResolver,
  stated?: Readonly<Record<string, StyleValue>>
): Record<string, StyleValue> {
  return perUsedType(
    document,
    blocks,
    definition => definition.childGap,
    stated
  );
}

/**
 * The islands a document contains, keyed by block type.
 *
 * The question `"use client"` cannot answer. A directive is a fact about a
 * MODULE and is visible to a bundler; a stored page is JSON naming block types,
 * and this package must answer from the document without importing every block
 * in the library or inspecting how one was compiled.
 *
 * EMPTY means the page needs no JavaScript OF ITS OWN. It does not mean the
 * page ships no script at all: a host framework has a floor of its own that no
 * block library can remove, and conflating the two makes the statement
 * unmeasurable rather than merely optimistic.
 *
 * Walks the tree ITSELF rather than through the style tiers' shared reading,
 * and the divergence is deliberate. Those ask which types COULD appear, because
 * a rule missing for a row a loop did draw leaves it unstyled. This asks which
 * will CERTAINLY appear, because naming one that never renders claims a static
 * page is interactive. The same tree answers the two questions differently, so
 * collapsing them would have to break one of them.
 */
export function islandsFor(
  document: BlockDocument,
  blocks: BlockResolver,
  // The SAME caps the renderer honours. Defaulted, this reads `DEFAULT_LIMITS`
  // while a site that raised `maxDepth` renders deeper than this walk sees — so
  // an island the page draws is truncated away here and the caller is told the
  // page needs less JavaScript than it does. A reader that answers about a page
  // has to be given the page's own bounds.
  options: Omit<PrepareDocumentArgs, "resolver"> = {}
): Record<string, BlockIsland> {
  // The RENDER-EQUIVALENT tree, not the stored one. A node can be condition
  // gated, resolve to a placeholder, or belong to a block whose props draw
  // nothing — in each case the renderer emits no markup for it, and naming its
  // island tells a caller the page needs JavaScript that never arrives.
  //
  // Reused rather than re-derived: this is the sequence the renderer itself
  // runs, so the two cannot answer differently. Three passes decided separately
  // is how a gated node's assets stayed on a page whose markup was withheld.
  const prepared = prepareDocumentForRead(document, {
    ...options,
    resolver: blocks,
  });
  if (prepared === null) return {};
  // The preparation deliberately does NOT decide this one: a block declaring
  // that its props draw nothing is a separate question from a node resolving to
  // a placeholder, and `prepare-document` says so where it draws the line. So
  // the drawless test is asked here, through the same helper the style tiers
  // use — an image still waiting for its picture emits no markup, and an island
  // among them would otherwise make a static page ask for JavaScript.
  const drawsNothing = drawlessTestFor(blocks);

  const found: Record<string, BlockIsland> = {};
  // ITERATIVE, and the depth this walks is the PREPARED tree's rather than the
  // stored one's. Preparation caps document depth, so a chain of any length —
  // and a node that contains itself — arrives here already finite. The stack is
  // what keeps that a property of this function rather than a fact borrowed
  // from another module: a recursive descent threw `RangeError` on a deep
  // document before returning any answer, and a reader asking whether a page
  // needs JavaScript should not be the thing that fails.
  //
  // No visited set. With the tree already bounded there is nothing for one to
  // catch, and a guard whose rejection branch cannot run is memory spent to
  // look careful.
  const stack: BlockNode[] = [...prepared.nodes];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;

    // Its SUBTREE with it, which is what `pruneNodes` does for the same
    // question: a block that draws nothing never calls `renderSlot`, so nothing
    // stored beneath it reaches the page either.
    if (drawsNothing(node)) continue;

    const definition = blocks.get(node.type);
    const island = definition?.island;
    if (island !== undefined && found[node.type] === undefined) {
      found[node.type] = island;
    }
    stack.push(...drawnSlots(node, definition));
  }
  return found;
}

/**
 * The children this node will CERTAINLY draw.
 *
 * A slot the block may decline to render cannot say the page needs JavaScript.
 * Reading a stored document cannot tell whether the block drew it — that is
 * settled by rendering — so a slot the definition declares conditional is
 * skipped, which is what `conditionalSlots` requires of anything deriving a
 * page-level fact without rendering.
 *
 * Skipped rather than guessed, and this is the CAUTIOUS direction: a
 * conditional slot that WAS drawn under-reports one island, while the reverse
 * tells a caller a page is interactive when nothing on it ever runs.
 */
function drawnSlots(
  node: BlockNode,
  definition: AnyBlockDefinition | undefined
): BlockNode[] {
  const slots = node.slots;
  if (slots === undefined) return [];
  const conditional = new Set(definition?.conditionalSlots ?? []);
  return Object.keys(definition?.slots ?? {})
    .filter(name => !conditional.has(name))
    .flatMap(name => slots[name] ?? []);
}

/**
 * One reading of "which block types does this tree use", answered for whichever
 * field the caller names.
 *
 * `stated` narrows a supplied record to this tree instead of reading the
 * resolver, and it is the same walk because it is the same question.
 */
function perUsedType<T>(
  document: BlockDocument,
  blocks: BlockResolver,
  read: (definition: AnyBlockDefinition) => T | undefined,
  stated?: Readonly<Record<string, T>>
): Record<string, T> {
  const found: Record<string, T> = {};
  walkNodes(document.nodes, node => {
    if (found[node.type] !== undefined) return;
    const definition = blocks.get(node.type);
    const value =
      stated === undefined
        ? definition === undefined
          ? undefined
          : read(definition)
        : // OWN properties only, because that is the boundary `compilePageCss`
          // draws: it emits a base for a used type only when
          // `Object.hasOwn(bases, type)` succeeds. A record reached through
          // `Object.create` or a polluted prototype answers this lookup with an
          // inherited value, and copying it here would make it an own property
          // of the narrowed record — turning data the compiler deliberately
          // ignores into a rule it emits, against a selector built from the node
          // type.
          Object.hasOwn(stated, node.type)
          ? stated[node.type]
          : undefined;
    if (value !== undefined) found[node.type] = value;
  });
  return found;
}

/**
 * The context a render will ACTUALLY compile with.
 *
 * Not the one the caller handed over: `blockBases` is derived from the resolver
 * when the caller did not state them, and `drawsNothing` is this layer's own
 * answer rather than something it accepts. A reader judging the caller's
 * context instead describes a compile that never happens — and a block package
 * changing its `baseStyles` would leave a stamp unmoved while the sheet it
 * produces changes.
 *
 * `drawsNothing` is set LAST, so it replaces anything the caller put there. The
 * renderer asks each block's declaration what to draw, so a supplied answer
 * could only make the rules disagree with the markup.
 *
 * Built here rather than by a caller because this function is exported and a
 * write path uses it directly to produce the artifact it stores: a value
 * supplied only by `PageRenderer` would leave every sheet written through the
 * other door describing something else. It is also not something a consumer
 * could supply — neither `effectiveCompile` nor `sharedStyleInputsId` is part
 * of this package's entry.
 */
export function compileContextFor(
  styleContext: StyleCompileContext | undefined,
  document: BlockDocument,
  blocks: BlockResolver,
  drawsNothing: (node: BlockNode) => boolean,
  storedDocument: BlockDocument | undefined
): StyleCompileContext | undefined {
  if (styleContext === undefined) return undefined;
  return withTypographyDefaults({
    ...styleContext,
    // Derived when the caller stated none, NARROWED when it stated a record —
    // one call, because it is one question. `compilePageCss` reads a base only
    // for a type the document uses, so a site library carrying every installed
    // block emits nothing for the rest, and carrying those into the identity
    // rejects a byte-identical sheet whenever a default moves for a block this
    // page does not hold.
    //
    // Over the tree the ARTIFACT describes, which is not always the one being
    // compiled: a caller that pruned first still holds a sheet compiled from the
    // wider tree, and narrowing to what survived would drop a type whose last
    // node a covered prune removed — refusing the artifact that prune existed to
    // keep.
    blockBases: blockBasesFor(
      storedDocument ?? document,
      blocks,
      styleContext.blockBases,
      // The site's edits to its blocks' own looks, which its class library
      // holds as default looks: read here, so every page compiled from that
      // library, canvas or published, lays them over the same bases.
      blockDefaultsOf(styleContext.namedClasses),
      styleContext.siteText,
      styleContext.namedClasses
    ),
    blockParts: blockPartsFor(
      storedDocument ?? document,
      blocks,
      styleContext.blockParts,
      styleContext.siteText,
      styleContext.namedClasses
    ),
    // Every container writes its gap, so the identity carries each one.
    childGaps: childGapsFor(
      storedDocument ?? document,
      blocks,
      styleContext.childGaps
    ),
    drawsNothing,
  });
}

/**
 * Which nodes draw nothing, for ONE resolution: the caller's own answer when it
 * gave one, otherwise the blocks' own declarations.
 *
 * Derived once and used by both branches, because the two must agree about the
 * same artifact. A sheet compiled under a caller's predicate holds exactly the
 * nodes THAT predicate gated; a read path recomputing from the registry alone
 * would append back every node the caller gated and the registry does not — and
 * the stored-artifact branch never looks at the compile context, so a caller
 * could not correct it by supplying the same one again.
 *
 * The block's own declaration is the only source. A caller cannot answer this
 * question on a block's behalf, because the answer decides which rules ship
 * while `BlockBoundary` asks the declaration for what actually renders: a
 * supplied predicate that disagreed would ship rules for markup that never
 * appears, or withhold them from markup that does. One derivation, consulted by
 * both, is the only arrangement in which those cannot disagree.
 *
 * The declaration is contained rather than called directly — a throwing call, a
 * throwing `then` getter, a deferred rejection — by `declaresNoMarkup`, which is
 * the one containment the engine and this layer share.
 */
export function drawlessTestFor(
  blocks: BlockResolver
): (node: BlockNode) => boolean {
  // A node bound to its list item draws, as far as the page can tell: its
  // props are filled only when the list draws each item, so before then the
  // tree holds its own values and its declaration would be judged on those.
  // Its rules ship, which is the safe direction for a node that may draw.
  return node =>
    !hasItemBindings(node) && declaresNoMarkup(node, type => blocks.get(type));
}
