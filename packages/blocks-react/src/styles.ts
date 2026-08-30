import {
  compilePageCss,
  declaresNoMarkup,
  isFetchableUrl,
  nodeAtPointer,
  nodeClassNames,
  walkNodes,
  DEFAULT_LIMITS,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockIsland,
  type BlockNode,
  type BlockPart,
  type CompiledPageCss,
  type DocumentLimits,
  type MayFetchUrl,
  type RemotePatternInput,
  type NodeStyles,
  type StyleCompileContext,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

import { withTypographyDefaults } from "./blocks/typography-defaults";
import { prepareDocumentForRead } from "./prepare-document";
import type { DocumentReadStages } from "./prepare-document";
import type { BlockResolver } from "./resolver";
import {
  UNIDENTIFIED_SHARED_INPUTS,
  sharedStyleInputsId,
} from "./shared-style-inputs";
import { pruneNodes } from "./visibility";

/**
 * A page's compiled stylesheet and the class each node was assigned.
 *
 * Both halves travel together because neither is usable alone: the CSS is
 * written against exactly these classes, and a renderer that kept the sheet but
 * recomputed the classes could hand a node a class no rule targets.
 *
 * `classes` is a plain object rather than the compiler's `Map` on purpose. This
 * artifact is stored next to the document and handed across the server/client
 * boundary as a prop, and a `Map` survives neither: `JSON.stringify` turns it
 * into `{}`, silently, so a page would come back styled by an empty sheet.
 */
export interface PageStyles {
  css: string;
  /**
   * Which host-fetch policy this CSS was compiled under, when one was in force.
   *
   * A stored stylesheet is a CACHE of a compile, and a cache is only sound when
   * it is keyed on every input the compile used. The host's fetch list is such
   * an input: the same document compiled under two different lists produces two
   * different sheets, one of which may name a host the other refuses. Without
   * this field a reader cannot tell them apart, so a sheet written before a
   * policy existed keeps publishing `url(https://unlisted…)` on a site that has
   * since forbidden it, and the block markup beside it is bounded while the
   * stylesheet is not.
   *
   * An OPAQUE label rather than the list itself. The reader only ever asks
   * "same policy as now?", which is an equality test, and storing the answer
   * rather than the rules keeps the stored artifact from having to be re-read
   * whenever the shape of a pattern changes.
   *
   * Absent means compiled under NO policy, which is exactly what every artifact
   * written before this field existed was.
   */
  fetchPolicyId?: string;
  /**
   * Which SHARED style inputs this CSS was compiled against, when they were
   * knowable.
   *
   * The same argument as `fetchPolicyId`, for the three inputs it does not
   * cover: the site's breakpoints, its token prefix and its named-class
   * library. All three are site-level, every page compiles against them, and
   * each renders directly into the stored sheet — breakpoints as the at-rules,
   * the prefix inside every `var()`, and a class's slug as the selector itself.
   * Move one and this artifact references at-rules, properties and selectors
   * the newly compiled site sheet no longer declares, which CSS reports by
   * silently dropping the declaration.
   *
   * A digest rather than the inputs, because a class library reaches thousands
   * of entries and this is stored on every page.
   *
   * Absent means UNTRUSTED, not "compiled against none" — the two are
   * indistinguishable from the artifact alone, and the reading that trusts it
   * is the one that serves a stale sheet forever.
   */
  sharedInputsId?: string;
  /**
   * The container this sheet's breakpoints were aimed at, when it is a PREVIEW
   * artifact — and absent for every publishable one.
   *
   * A preview sheet is not publishable and the difference is invisible in the
   * CSS: its viewport tiers are `@container` rules naming a box only the
   * previewing surface declares, so on a published page they match nothing and
   * every breakpoint above the base one silently disappears. The page still
   * renders, still looks styled at desktop width, and stops being responsive.
   *
   * Recorded on the ARTIFACT because `resolvePageStyles` is exported and
   * returns this shape, so a preview result can be persisted and later handed
   * back with no compile context — and a context-free read has nothing else to
   * judge it by. Every other staleness field here is compared against inputs a
   * context supplies; this one has to be refusable without one.
   */
  previewContainer?: string;
  /** Node id to generated class name. */
  classes: Record<string, string>;
  /**
   * The scope class the selectors were anchored under, when there was one.
   *
   * Recorded here rather than asked of the caller separately, because a scope
   * that lives in two places is a scope that can disagree with itself: the
   * stylesheet's selectors already encode it, so a renderer told a different
   * one puts a class on the root that no rule mentions and the whole sheet
   * silently matches nothing. Travelling with the CSS makes that unstateable.
   */
  scope?: string;
  /**
   * The node-local rules of every condition-gated node, keyed by node id, held
   * OUT of `css` so a reader appends only the ones whose nodes survived.
   *
   * The sheet is compiled when the document is SAVED and a condition is decided
   * when the page is READ, so one pre-compiled string otherwise carries rules
   * for nodes the reader removes — publishing the colours, fonts and `url(...)`
   * of a block whose markup is withheld.
   *
   * An ABSENT field means "compiled before this split existed", NOT "nothing was
   * gated". The two are indistinguishable from the artifact alone, and reading
   * absence as "nothing gated" would trust a sheet that predates gating
   * entirely. So gating must still force a recompile when this is missing; only
   * a present map licenses skipping it.
   */
  gated?: Readonly<Record<string, string>>;
}

/** The compiler's output in the storable shape. */
export function toPageStyles(
  compiled: CompiledPageCss,
  scope?: string,
  /** The policy the compile ran under, recorded so a later read can check it. */
  fetchPolicyId?: string,
  /** The shared inputs the compile ran against, recorded for the same reason. */
  sharedInputsId?: string
): PageStyles {
  const styles: PageStyles = {
    css: compiled.css,
    classes: Object.fromEntries(compiled.classes),
    ...(fetchPolicyId === undefined ? {} : { fetchPolicyId }),
    ...(sharedInputsId === undefined ? {} : { sharedInputsId }),
  };
  // Carried through because THIS is the shape that gets stored: a compiler that
  // splits the sheet and a writer that drops half of it leave the gated rules
  // nowhere, and the page renders those nodes unstyled with nothing to say why.
  const withGated =
    compiled.gated === undefined
      ? styles
      : { ...styles, gated: compiled.gated };
  // The scope the compiler WROTE, not the one the caller asked for. A scope the
  // compiler cannot write is dropped and the sheet compiled global, so recording
  // the request stores an artifact claiming an isolation its own selectors do
  // not carry — and the renderer attaches that class, which is how one
  // document's rules reach another rendered beside it.
  //
  // The parameter is no longer read for this: a caller cannot know whether the
  // compiler accepted its scope, and only the compiler does.
  const withScope =
    compiled.scope === undefined
      ? withGated
      : { ...withGated, scope: compiled.scope };
  // The container the compiler actually AIMED AT, for the same reason the scope
  // above is the written one rather than the requested one: a refused name
  // compiles published, and stamping that artifact as a preview would withhold
  // a perfectly publishable sheet on every later context-free read.
  return compiled.previewContainer === undefined
    ? withScope
    : { ...withScope, previewContainer: compiled.previewContainer };
}

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
  stated?: Readonly<Record<string, NodeStyles>>
): Record<string, NodeStyles> {
  return perUsedType(
    document,
    blocks,
    definition => definition.baseStyles,
    stated
  );
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
  stated?: Readonly<Record<string, Readonly<Record<string, BlockPart>>>>
): Record<string, Readonly<Record<string, BlockPart>>> {
  return perUsedType(document, blocks, definition => definition.parts, stated);
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
  blocks: BlockResolver
): Record<string, BlockIsland> {
  // The RENDER-EQUIVALENT tree, not the stored one. A node can be condition
  // gated, resolve to a placeholder, or belong to a block whose props draw
  // nothing — in each case the renderer emits no markup for it, and naming its
  // island tells a caller the page needs JavaScript that never arrives.
  //
  // Reused rather than re-derived: this is the sequence the renderer itself
  // runs, so the two cannot answer differently. Three passes decided separately
  // is how a gated node's assets stayed on a page whose markup was withheld.
  const prepared = prepareDocumentForRead(document, { resolver: blocks });
  if (prepared === null) return {};

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
function compileContextFor(
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
      styleContext.blockBases
    ),
    blockParts: blockPartsFor(
      storedDocument ?? document,
      blocks,
      styleContext.blockParts
    ),
    drawsNothing,
  });
}

/** Every node id in a document, in document order. */
function documentNodeIds(document: BlockDocument): string[] {
  const ids: string[] = [];
  walkNodes(document.nodes, node => {
    ids.push(node.id);
  });
  return ids;
}

/**
 * The styles a render should use, from whichever of the three inputs it has.
 *
 * Ordered by how much each can be trusted:
 *
 * 1. A stored artifact. Compilation happens at write time, so what ships is
 *    what was compiled against the document as saved. Recompiling per request
 *    is the missing-CSS bug class page builders are known for, and it costs the
 *    compile on every render of an unchanged page.
 * 2. A compile context, for a consumer with no write path — the standalone
 *    case. The compiler is deterministic and needs no runtime, so this produces
 *    the same bytes the CMS would have stored.
 * 3. Neither, which still has to work. A document renders without styles, but
 *    it cannot render without CLASSES: every block is handed one and puts it on
 *    its root element. They come from the same helper the compiler uses, so the
 *    collision handling that makes two ids hashing alike distinguishable is the
 *    same in all three paths rather than reinvented in the cheapest one.
 */
/**
 * A stored artifact made safe to render against.
 *
 * The artifact is a database record, so it can predate the current shape or
 * have been written by an older version, and neither half can be taken on
 * trust. A missing `classes` map is the dangerous one: the class lookup happens
 * while assembling a block's arguments, BEFORE the try/catch around its render,
 * so one bad stylesheet row would throw in the page component where no block
 * boundary can contain it.
 *
 * Repairs rather than refuses. Classes are recomputed from the document by the
 * same helper the compiler uses, so a document with a broken artifact renders
 * unstyled instead of not at all — and the CSS is dropped with them, since a
 * stylesheet written against classes nobody now carries would match nothing.
 */
interface NormalizedStyles {
  styles: PageStyles;
  /**
   * Whether the artifact's own classes were unusable and had to be rebuilt.
   *
   * Carried explicitly rather than inferred from an empty `css`, because the two
   * are different states that happen to look alike. A page whose only styled
   * node is condition-gated compiles to a legitimately EMPTY main sheet with all
   * its rules in `gated` — reading that emptiness as a refusal would discard the
   * one thing that page's styling consists of.
   */
  refused: boolean;
}

/**
 * Whether the artifact describes nodes this document does not hold AND cannot account for them.
 *
 * `normalizeStoredStyles` checks the other direction — every node needs a class. This catches the
 * artifact describing MORE than it was handed, which is the signature of a tree since pruned.
 *
 * An absent node is only a problem when the artifact does NOT carry its rules separately. When it
 * does, the split has already done its job: those rules were never in `css`, so serving `css` and
 * appending only the survivors is correct and this must not fire. The rule is therefore the same
 * one the renderer applies — every missing node needs a usable gated entry — rather than a second,
 * blunter one that would withhold the sheet on exactly the pages the split exists for.
 */
function artifactDescribesUnaccountedNodes(
  styles: PageStyles,
  document: BlockDocument
): boolean {
  const map: unknown = styles.classes;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    return false;
  }
  const gated = readableGatedRules(styles);
  const present = new Set(documentNodeIds(document));
  return Object.keys(map).some(
    id => !present.has(id) && !isRecordedGatedEntry(gated?.[id])
  );
}

function normalizeStoredStyles(
  styles: PageStyles,
  document: BlockDocument
): NormalizedStyles {
  // Usable means more than "is an object". A stylesheet whose map is empty,
  // missing a node, or holding a non-string value leaves that node with only
  // its block-type class while the stale CSS still ships — every node-specific
  // selector matching nothing, and no error to say why. `{}` is the exact
  // result of `JSON.stringify` on a `Map`, so it is the shape most likely to
  // arrive.
  const map: unknown = styles.classes;
  const classesUsable =
    typeof map === "object" &&
    map !== null &&
    !Array.isArray(map) &&
    documentNodeIds(document).every(id => {
      const value = (map as Record<string, unknown>)[id];
      return typeof value === "string" && value.length > 0;
    });
  if (classesUsable) {
    return {
      styles: typeof styles.css === "string" ? styles : { ...styles, css: "" },
      refused: false,
    };
  }
  return {
    styles: {
      css: "",
      classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
      ...(styles.scope === undefined ? {} : { scope: styles.scope }),
    },
    refused: true,
  };
}

/**
 * A stored sheet with the gated rules of the nodes that SURVIVED appended.
 *
 * The stored `css` is always incomplete when `gated` is present, so this is
 * delivery rather than repair: the survivors are appended whether or not
 * anything about the document was repaired. Making it conditional on repair
 * would work only for as long as every conditioned node is pruned — the moment
 * one survives, nothing is repaired, the incomplete sheet ships unchanged and
 * that node renders unstyled.
 *
 * The set is taken from the document being RENDERED, never from re-reading
 * `visibility.conditions`. Walking the surviving nodes means the rules appended
 * are definitionally the rules of the nodes that rendered; a second derivation
 * of the pruning rule is exactly how a sheet and its markup come apart.
 *
 * Appending AFTER the main sheet is safe. Each node's local rules are written
 * against its own hashed class, so two nodes' entries can never target the same
 * element; only tier order matters, and each entry preserves its own tiers
 * internally.
 */
/**
 * The gated rules a stored artifact carries, or `undefined` when it carries none it can be read.
 *
 * ONE definition, because two places ask this question: the renderer, deciding whether the artifact
 * covers gating well enough to skip the repair, and the delivery below, deciding whether to append.
 * When they disagreed the artifact counted as coverage while its map went unread, so the repair was
 * skipped and the stale sheet shipped with the hidden node's rules still in it — the leak, arrived
 * at through two readings of one fact.
 *
 * The artifact is a database record, so `gated` can be null, an array, or a string. Anything not a
 * plain record is treated as ABSENT, which is the safe direction: absent means the sheet predates
 * the split, and gating then forces the recompile-or-withhold path.
 */
/**
 * Whether the compiler RECORDED this node — the coverage question.
 *
 * An empty string is a legitimate record, not a missing one. A gated node with no node-local or
 * device rules of its own compiles to `serializeRules([])`, which is `""`, and a gated ancestor's
 * unstyled child does the same. Rejecting it would classify a perfectly fresh artifact as
 * uncovered, forcing the repair — and on the ordinary stored-artifact path with no compile context
 * that clears the WHOLE sheet, so every visible sibling loses its styling because one hidden node
 * happened to carry no rules.
 *
 * Deliberately different from {@link isUsableGatedEntry}, which answers a different question. The
 * two were briefly one function and that is what produced this defect: coverage asks whether the
 * node was accounted for, delivery asks whether there is anything to append, and `""` answers yes
 * to the first and no to the second.
 */
export function isRecordedGatedEntry(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Whether a gated entry carries rules worth appending — the DELIVERY question.
 *
 * Non-empty, because appending `""` would add a blank line to the sheet for every gated node that
 * styles nothing and make an otherwise byte-identical page differ.
 */
export function isUsableGatedEntry(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function readableGatedRules(
  styles: PageStyles | undefined
): Readonly<Record<string, unknown>> | undefined {
  const gated: unknown = styles?.gated;
  if (typeof gated !== "object" || gated === null || Array.isArray(gated)) {
    return undefined;
  }
  return gated as Readonly<Record<string, unknown>>;
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
  return node => declaresNoMarkup(node, type => blocks.get(type));
}

/**
 * Whether migration turned a node that DREW into one that draws nothing.
 *
 * The stored sheet was compiled while the node still drew, so its rules sit in
 * the main `css` with no gated entry, and every later pass agrees the node is
 * present and registered. Nothing else in this function can see it: the
 * drawless predicate decides which per-node entries to APPEND and cannot
 * withdraw a rule already embedded in the sheet, and the stage comparisons all
 * read equal because no pass REMOVED anything. Only a recompile drops it.
 *
 * Asked ONLY of the nodes the engine reported rewriting. The predicate runs a
 * block's own declaration, so asking it of every node on every read would put
 * plugin code in the path of the ordinary case, where nothing migrated and the
 * answer cannot have changed. That list is empty for any page whose nodes are
 * already current, which is nearly all of them, and this returns before walking
 * anything.
 *
 * The reverse flip needs no handling: a node that starts drawless and begins to
 * draw has no rules in the stored sheet to be stale, and the recompile that
 * gives it some is triggered by the sheet not describing it.
 */
export function migrationChangedWhatDraws(
  stages: DocumentReadStages,
  resolver: BlockResolver,
  styles: PageStyles | undefined
): boolean {
  if (stages.rewritten.length === 0) return false;
  const drawsNothing = drawlessTestFor(resolver);
  const gatedRules = readableGatedRules(styles);

  return stages.rewritten.some(entry => {
    const after = nodeAtPointer(stages.migrated, entry.path);
    if (after === undefined) return false;
    // Nothing to be stale about a node that draws nothing now either.
    if (!drawsNothing(after)) return false;

    // Whether the node DREW when the sheet was compiled is read off the sheet
    // rather than recomputed. The compiler records every node it withheld, by
    // id, under its own combined decision — condition, drawless, or inherited
    // from an ancestor — so an entry means "these rules are not in `css`" and
    // its absence means they are.
    //
    // Read rather than re-derived for two reasons. Reapplying the gating rule
    // here would be a second implementation of a decision the compiler owns,
    // and the two only agree while both are maintained together: the compiler
    // may widen what it gates, or change how gating descends a subtree, and a
    // copy that does not follow classifies the same node differently while
    // still looking correct. And the predicate cannot answer the question at
    // all for a node whose migration RENAMED the prop `rendersNothing` reads:
    // today's predicate over yesterday's props reports drawless for a node that
    // drew, so the flip disappears. The artifact carries the answer the schema
    // of the day produced, which is the only version-independent source there
    // is.
    if (gatedRules !== undefined) {
      // Asked through `isRecordedGatedEntry`, the same predicate delivery and
      // pruning coverage use, rather than by testing for the key. A stored map
      // is input like any other: a row carrying `{ "a": null }` has the key and
      // records nothing, so key presence alone would report the node withheld
      // and keep serving rules — and any `url(...)` in them — that nothing
      // accounts for.
      return (
        typeof after.id === "string" &&
        !isRecordedGatedEntry(gatedRules[after.id])
      );
    }

    // An artifact compiled before the per-node map existed carries no record,
    // so the stored props are the only evidence left. This is the derivation
    // above, kept ONLY for those artifacts and inheriting their limitation: a
    // migration that renamed the prop the predicate reads is invisible here.
    const before = nodeAtPointer(stages.sanitized, entry.path);
    return before !== undefined && !drawsNothing(before);
  });
}

function withGatedRules(
  styles: PageStyles,
  document: BlockDocument,
  drawsNothing: (node: BlockNode) => boolean
): PageStyles {
  const entries = readableGatedRules(styles);
  if (entries === undefined || styles.css === undefined) return styles;
  const appended: string[] = [];
  // Which nodes have EARNED their rules back. Surviving the visibility prune is
  // one half; the other is that the block did not answer that these props draw
  // nothing, because appending such a node's rules would put back exactly what
  // holding them per node was for.
  //
  // Asked HERE rather than left to the caller because this function is exported
  // and the documented direct flow — `prepareDocumentForRead` then this — has no
  // pass that removes such a node. A consumer following it would otherwise
  // publish the rules while the block drew nothing, with no way to prevent it.
  //
  // Through the PRUNE rather than a per-node test, because the answer is not
  // per-node: a block that draws nothing places none of its slot children, so
  // the compiler holds the whole subtree back and those descendants each answer
  // "I draw" about themselves. Testing each node alone would skip the container
  // and append every child under it. One walk, one rule, no way for the two to
  // disagree about a subtree.
  //
  // The failure direction is the safe one: the test answers "draws" for anything
  // short of an explicit `true`, so a block that cannot be asked keeps its
  // styling.
  const surviving = pruneNodes(document, node => !drawsNothing(node));
  for (const id of documentNodeIds(surviving)) {
    const rules = entries[id];
    if (isUsableGatedEntry(rules)) appended.push(rules);
  }
  if (appended.length === 0) return styles;
  // An empty main sheet is joined without a leading newline. `css` is legitimately
  // empty whenever every styled node was gated — a page whose only styling lives
  // on a conditioned block compiles to exactly that — so emptiness cannot be read
  // as a refusal here. The refusal is decided by `normalizeStoredStyles`, which
  // rebuilds the classes; this only ever sees what that returned.
  const parts = styles.css === "" ? appended : [styles.css, ...appended];
  return { ...styles, css: parts.join("\n") };
}

/**
 * PRECONDITION: `document` is the tree that will RENDER, with condition-gated nodes already
 * removed by {@link pruneHiddenNodes}.
 *
 * Stated on the signature because this is exported and the unsafe call is the natural-looking one.
 * Handed a RAW document, every gated node counts as surviving, so its rules are appended from the
 * artifact and its markup is withheld by the renderer — publishing the colours, fonts and
 * `url(...)` of a block nobody was served. `PageRenderer` runs the pass itself, so the ordinary
 * path cannot get this wrong; a consumer assembling styles by hand can, which is why the prune is
 * exported alongside this.
 */
/**
 * A stable label for a host-fetch policy, or `undefined` when there is none.
 *
 * Derived from the patterns rather than assigned by a caller, so it changes
 * exactly when the policy does and there is nothing to remember to bump. Sorted
 * before joining because two lists holding the same entries in a different
 * order are the same policy, and a label that disagreed would recompile every
 * stored sheet on a cosmetic reordering.
 *
 * Written as JSON, for two reasons that are both about being WRONG in a way
 * nobody would see.
 *
 * It has to survive storage. This label is persisted inside the stylesheet
 * artifact, and that artifact is written to a JSON column — which on PostgreSQL
 * cannot hold a NUL byte at all. A separator chosen for being impossible in a
 * hostname is exactly the kind that is also impossible to store, and the failure
 * would be a save that errors only once a site turns the policy on.
 *
 * It has to keep ABSENT and EMPTY apart. `isAllowedRemoteUrl` reads an omitted
 * `port` as "any port" and `port: ""` as "the default port only", so a policy
 * tightened from one to the other is a different policy. Joining fields into a
 * string collapses that difference, and a stylesheet compiled under the broader
 * rule would go on being served under the narrower one. `JSON.stringify` drops
 * an undefined field and keeps an empty one, which is precisely the distinction.
 */
export function fetchPolicyLabel(
  patterns: readonly RemotePatternInput[] | undefined
): string | undefined {
  if (patterns === undefined) return undefined;
  const parts = patterns.map(pattern => {
    // A `URL` keeps the trailing colon on `protocol` and answers "" for the
    // fields it has none of; the object form omits them. Normalised to the
    // object's spelling so the same policy written either way labels the same.
    const fields =
      pattern instanceof URL
        ? {
            protocol: pattern.protocol.replace(/:$/, ""),
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          }
        : {
            protocol: pattern.protocol,
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          };
    // Key order is fixed by writing the members out, so two equal patterns
    // cannot label differently because they were built in a different order.
    return JSON.stringify([
      fields.protocol ?? null,
      fields.hostname,
      fields.port ?? null,
      fields.pathname ?? null,
      fields.search ?? null,
    ]);
  });
  // An EMPTY list is a real policy — it allows no remote host at all — and must
  // not label the same as having no policy, which asks nothing. The version
  // prefix means a later change to this encoding invalidates old stamps rather
  // than silently matching them.
  return JSON.stringify(["v1", ...parts.sort()]);
}

/**
 * The identity of a fetch policy that declines to identify itself.
 *
 * A plain word, and deliberately not valid `fetchPolicyLabel` output: every
 * label this module produces is a JSON array, so no stored stamp can ever equal
 * this. That makes "a custom predicate with no stated identity" mean recompile
 * every time — the slow answer and the correct one, since the alternative is
 * serving CSS whose URLs were admitted by a function that has since changed.
 *
 * Storage-safe on purpose. It can be STAMPED onto a recompiled artifact and
 * written to a JSON column, so it must not carry the control characters an
 * impossible-looking sentinel invites.
 */
export const UNIDENTIFIED_FETCH_POLICY = "unidentified-fetch-policy";

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
export function gatedEntriesCoverRemovedNodes(
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
export function gatedMapCoversPrunedNodes(
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
export function hasDuplicateNodeIds(document: BlockDocument): boolean {
  const seen = new Set<string>();
  let duplicate = false;
  walkNodes(document.nodes, node => {
    if (seen.has(node.id)) duplicate = true;
    seen.add(node.id);
  });
  return duplicate;
}

/** What a page must be recompiled WITH, and judged BY. */
export interface EffectiveCompile {
  /** The context to recompile with, or `undefined` when the caller gave none. */
  context: StyleCompileContext | undefined;
  /** The policy label to compare a stored sheet's stamp against. */
  fetchPolicyId: string | undefined;
  /**
   * The host-fetch predicate in force for this render — the caller's own when
   * they supplied one, otherwise the one derived from the pattern list.
   *
   * Returned in its own right because the SITE sheet needs it and cannot read
   * it off `context`: that is `undefined` whenever the caller gave no style
   * context, while the site sheet is compiled regardless. Deriving it a second
   * time at the other call site is how one sheet comes to refuse a host the
   * other serves.
   */
  mayFetchUrl: MayFetchUrl | undefined;
}

/**
 * Reconcile what a CALLER supplied with what the stored artifact and the host
 * already knew.
 *
 * A caller's raw context is not the context to compile with, and the three
 * differences all fail silently:
 *
 * - **Scope lives on the ARTIFACT, not the context.** A caller normally omits it
 *   for exactly that reason, so compiling with the raw context rebuilds a scoped
 *   page unscoped and lets its selectors reach another document rendered beside
 *   it. Only a STRING is carried over: the artifact is a database record, so its
 *   `scope` can be null or a number, and the compiler dereferences it before any
 *   block boundary exists — a malformed one would fail the whole page rather
 *   than render it unstyled.
 * - **Limits come from the caller's own cap**, which preparation already honours.
 *   Compiling against the context's caps instead retains nodes whose styles were
 *   never written, so the document holds nodes the class map does not name.
 * - **A sheet with no policy stamp compares equal to no policy at all.** A caller
 *   with its own `mayFetchUrl` and no `fetchPolicyId` would therefore reuse an
 *   unstamped sheet under a predicate that never judged it. A caller's predicate
 *   is authoritative and opaque — nothing here can tell one such function from
 *   another — so absent a stated identity it gets one no artifact can carry, and
 *   every stored sheet reads as compiled under another policy. Safe rather than
 *   fast, and a caller wanting its sheets cached says which policy its predicate
 *   IS.
 *
 * One derivation for every entry point that resolves a stored page. Two would
 * agree on the day they were written, and the drift would be a page served with
 * another page's selectors or with URLs the current policy refuses.
 */
export function effectiveCompile(args: {
  styleContext: StyleCompileContext | undefined;
  styles: PageStyles | undefined;
  limits: DocumentLimits | undefined;
  remotePatterns: readonly RemotePatternInput[] | undefined;
}): EffectiveCompile {
  const patterns = args.remotePatterns;
  // A caller's OWN predicate wins: it is the more specific answer, and a host
  // that passed one deliberately should not have it replaced by one derived
  // from the pattern list.
  const fetchPolicyId =
    args.styleContext?.mayFetchUrl === undefined
      ? fetchPolicyLabel(patterns)
      : (args.styleContext.fetchPolicyId ?? UNIDENTIFIED_FETCH_POLICY);
  // Derived ONCE, here, and handed back so both sheets are judged by the same
  // function. The caller's own predicate wins for the same reason it does
  // below; a pattern list with no caller predicate becomes one.
  const derived =
    args.styleContext?.mayFetchUrl ??
    (patterns === undefined
      ? undefined
      : (url: string) => isFetchableUrl(url, patterns));
  if (args.styleContext === undefined)
    return { context: undefined, fetchPolicyId, mayFetchUrl: derived };
  return {
    mayFetchUrl: derived,
    context: {
      ...args.styleContext,
      limits: args.limits ?? args.styleContext.limits ?? DEFAULT_LIMITS,
      // `derived` itself, not a second closure over the same list. It already
      // encodes both rules: a caller's own predicate is what it resolved to,
      // and no list with no caller predicate leaves it undefined. Rebuilding
      // one here would hand the two sheets different functions while this
      // module promised them one, which is the divergence the promise exists
      // to prevent.
      ...(derived === undefined ? {} : { mayFetchUrl: derived }),
      ...(args.styleContext.scope === undefined &&
      typeof args.styles?.scope === "string"
        ? { scope: args.styles.scope }
        : {}),
    },
    fetchPolicyId,
  };
}

/** Caller-supplied policy for one style resolution. */
export interface ResolveStyleOptions {
  /**
   * Which host-fetch policy is in force now. Compared against the stamp the
   * stored artifact carries; a difference means that artifact was compiled
   * under other rules and cannot be trusted for this render.
   */
  fetchPolicyId?: string;
  /**
   * The tree the STORED artifact describes, when the caller narrowed the
   * document before calling this.
   *
   * The documented direct-caller flow is prune-then-resolve, so `document` here
   * is often already smaller than the tree the artifact was compiled from — and
   * two of those prunes are LICENSED to keep the artifact rather than to refuse
   * it. Anything derived from the tree for the artifact's identity has to be
   * derived from this one instead, or a covered prune moves that identity and
   * rejects the very sheet it was allowed in order to reuse.
   *
   * Absent means the two are the same tree, which is the case for every caller
   * that has not pruned.
   */
  storedDocument?: BlockDocument;
  /**
   * Ask for the cascade that produced the sheet, alongside the sheet.
   *
   * The editor needs it and nothing else does. A control showing where its
   * value came from — authored here, inherited from a class, inherited from a
   * wider breakpoint — is answering a question only the compiler can answer,
   * because it has already settled tier order, both breakpoint axes, states,
   * refused values, descendant selectors and specificity. Re-deriving that
   * beside the compiler is the drift every staleness test in this file exists
   * to catch.
   *
   * Off by default, and the compiler builds the array only when asked, so an
   * ordinary render pays nothing. It is deliberately NOT part of
   * {@link PageStyles}: that shape is what gets stored, and a cascade recorded
   * for one editing session has no business in the database.
   */
  trace?: boolean;
}

/** A resolved sheet, and the cascade that produced it when one was asked for. */
export interface ResolvedPageStyles {
  readonly styles: PageStyles;
  /**
   * Present only when `trace` was asked for AND a compile actually ran.
   *
   * Absent is a real answer rather than a failure: a page served from a stored
   * artifact is not recompiled, so there IS no cascade to report, and a caller
   * that treats absence as "nothing is authored" would tell an author their
   * values came from nowhere. Show no provenance rather than a wrong one.
   */
  readonly trace?: readonly StyleTraceEntry[];
}

export function resolvePageStylesWithTrace(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined,
  blocks: BlockResolver,
  /**
   * Whether condition-gated nodes were removed from `document` before this ran.
   *
   * It changes what a STORED artifact may be trusted for. The artifact is
   * compiled at write time from the whole document, and conditions are decided
   * at read time, so a sheet saved before any gating knows nothing about it:
   * the gated node's markup is withheld while the rules compiled for it — and
   * any URL inside them — are still published.
   *
   * Recompiling is the right answer whenever the inputs to do so are present.
   * When they are not, the sheet is withheld: the format says a hidden node is
   * omitted from server output, and an unstyled page keeps that promise while a
   * styled one breaks it. Classes are kept either way, so blocks still carry
   * the names the rest of the system expects.
   *
   * An artifact carrying `gated` no longer needs either. Its rules travel per
   * node, so the caller can leave gating out of this flag and let
   * {@link withGatedRules} append exactly the survivors. The other repair
   * causes still belong here: none of them is fixed by a per-node split.
   */
  repairedDocument = false,
  /**
   * What this render knows that the positional arguments cannot carry.
   *
   * An object rather than more positionals: five is already where a call stops
   * reading by position, and the next thing added in line would sit beside a
   * boolean with only its type to separate them.
   */
  options: ResolveStyleOptions = {}
): ResolvedPageStyles {
  // Derived before either branch, so the read path and the compile path cannot
  // answer differently about the same document.
  const drawsNothing = drawlessTestFor(blocks);

  const compileContext = compileContextFor(
    styleContext,
    document,
    blocks,
    drawsNothing,
    options.storedDocument
  );
  const sharedInputsId = sharedStyleInputsId(compileContext);

  // An artifact naming classes for nodes this document does not contain was compiled from a
  // DIFFERENT, larger tree — which is exactly what pruning produces. Its `css` may carry those
  // nodes' rules and asset URLs while their markup is withheld, so it cannot be trusted however
  // the caller filled in `repairedDocument`. Checked here rather than left to the flag because
  // this function is exported and the documented direct-caller flow is prune-then-resolve, where
  // the flag defaults to false and nothing else would notice.
  const compiledFromAnotherTree =
    styles !== undefined && artifactDescribesUnaccountedNodes(styles, document);
  // A stored sheet compiled under a DIFFERENT fetch policy than the one in
  // force is untrusted for the same reason a sheet compiled from a larger tree
  // is: its `url(...)` values were admitted by rules that no longer apply, and
  // the reader cannot tell which of them the current rules would refuse without
  // compiling again. So it is treated as a repair cause, which already means
  // recompile when the inputs are there and withhold the CSS when they are not.
  //
  // Equality, not containment. A list that only ever grew would still be safe
  // to reuse a sheet from, but deciding that needs the rules rather than the
  // label, and a reader that has to reason about the rules is one that can get
  // it wrong quietly.
  //
  // A sheet compiled under an ANONYMOUS predicate is stale against every policy
  // including no policy at all, which is why its own stamp is not enough to
  // decide by. Two transitions make that concrete and they fail in opposite
  // directions: to another anonymous predicate, where a stable sentinel would
  // compare equal to itself and reuse CSS the new predicate never judged; and
  // away from the predicate entirely, where absence is ALSO the honest stamp for
  // an unrestricted compile, so a restrictive artifact would be reused and the
  // URLs it dropped would stay missing for good. Neither a stable stamp nor an
  // absent one separates those, so the stamp records what compiled the sheet and
  // this comparison refuses it outright.
  const compiledUnderAnotherPolicy =
    styles !== undefined &&
    (styles.fetchPolicyId !== options.fetchPolicyId ||
      styles.fetchPolicyId === UNIDENTIFIED_FETCH_POLICY);

  // The same test for the site-level inputs, and it refuses an ABSENT stamp for
  // the same reason the policy one refuses its sentinel: absence is equally the
  // honest stamp for a compile that had no shared inputs at all, so treating it
  // as a match would reuse a sheet compiled against a library, a prefix and a
  // breakpoint set that nothing here has seen.
  //
  // Every artifact written before this field existed is unstamped, so each is
  // recompiled and the value returned carries the stamp. Whether that is paid
  // ONCE is not this module's to promise: it returns a stamped value and does
  // not write one, so the cost is once per artifact where a caller persists or
  // caches the result, and once per request where nothing does. The correctness
  // is the same either way; only the price differs.
  // Only ASKED when a context exists. With none there is nothing to compare a
  // stamp against and nothing to recompile with, so a mismatch could not be
  // acted on — it would withhold the sheet and render the page unstyled, which
  // is worse than the staleness it was guarding. A context-free read is not a
  // place this question can be answered, so it is not asked there.
  const compiledAgainstOtherInputs =
    styles !== undefined &&
    compileContext !== undefined &&
    (styles.sharedInputsId !== sharedInputsId ||
      styles.sharedInputsId === UNIDENTIFIED_SHARED_INPUTS);
  /*
   * A PREVIEW artifact on a CONTEXT-FREE read, which is the only place this
   * question is still open.
   *
   * Gated the opposite way to every other rule here, and for the same reason
   * they are gated at all. They compare the artifact against an input the
   * context supplies, so they can only be asked WITH one. This one is a
   * property of the artifact alone and can only be asked WITHOUT one — because
   * when a context exists, `compiledAgainstOtherInputs` has already settled it:
   * `sharedStyleInputsId` folds the preview container into its breakpoint
   * contexts, so a preview artifact read under a published context has a
   * different stamp and is refused there, and one read under the SAME preview
   * context has a matching stamp and is correctly reused.
   *
   * Asking it unconditionally therefore did not add safety, it removed reuse:
   * every preview render recompiled the whole document even when the stamp
   * proved the inputs identical, which on a large editor document is the
   * editor's own hot path.
   *
   * What remains is the case no stamp can reach. Its viewport tiers are
   * `@container` rules naming a box that only the previewing surface declares,
   * so on a published page they match nothing.
   *
   * That is why the reasoning above — that withholding a sheet is worse than
   * serving a stale one — inverts here. A stale sheet is a page styled with
   * yesterday's values, which is wrong and recognisable. A preview sheet served
   * published renders the base tier and silently drops every breakpoint above
   * it, so the page looks deliberately styled at one width and stops responding
   * at every other. Refusing produces a page that is visibly unstyled, which
   * someone notices.
   *
   * `resolvePageStyles` is exported and returns this shape, so this is reachable
   * rather than theoretical: a caller can persist a preview result and hand it
   * back later with `styles` and no `styleContext`.
   */
  const compiledForPreview =
    styles !== undefined &&
    compileContext === undefined &&
    styles.previewContainer !== undefined;

  /*
   * ONE answer to "may this stored sheet be served as it stands", used by both
   * the trust branch and the context-free refusal below.
   *
   * They were the same list written twice, once negated and once positive, so a
   * reason added to one and missed in the other would trust an artifact on one
   * path and withhold it on the other — for the same document, decided by
   * whether a context happened to be supplied. Naming it once makes the two
   * unable to disagree.
   */
  const untrusted =
    repairedDocument ||
    compiledFromAnotherTree ||
    compiledUnderAnotherPolicy ||
    compiledAgainstOtherInputs ||
    compiledForPreview;

  if (styles && !untrusted) {
    const normalized = normalizeStoredStyles(styles, document);
    // A refused artifact had its classes rebuilt, so the gated rules — written
    // against the classes it USED to carry — would select nothing. Nothing is
    // appended, which is the same answer the sheet itself got.
    return {
      styles: normalized.refused
        ? normalized.styles
        : withGatedRules(normalized.styles, document, drawsNothing),
    };
  }
  if (styles && untrusted && styleContext === undefined) {
    return {
      styles: { ...normalizeStoredStyles(styles, document).styles, css: "" },
    };
  }
  if (compileContext) {
    // Compiled with the context built above rather than the caller's, for the
    // reasons `compileContextFor` states — including that a predicate injected
    // only by `PageRenderer` would mean every sheet written through this entry
    // keeps its drawless nodes' rules in `css` and carries no `gated` entry for
    // them, so republishing a page would never enable the drop.
    return compileToStyles(document, compileContext, options, sharedInputsId);
  }
  return {
    styles: {
      css: "",
      classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
    },
  };
}

/**
 * One compile, packaged as the storable sheet plus the cascade behind it.
 *
 * Separated from the resolution above because the two answer different
 * questions. That one decides WHETHER to compile — which is where every
 * staleness rule lives — and this one performs the compile and shapes what
 * comes back. Keeping them together meant a reader had to hold the trust rules
 * in mind to follow the packaging, and the compiler's own options as well.
 */
function compileToStyles(
  document: BlockDocument,
  compileContext: StyleCompileContext,
  options: ResolveStyleOptions,
  sharedInputsId: string | undefined
): ResolvedPageStyles {
  const compiled = compilePageCss(document, {
    ...compileContext,
    // Asked for only when a caller wants it. The compiler builds the array
    // lazily, so an ordinary render pays nothing for a facility the editor is
    // the only consumer of.
    ...(options.trace === true ? { trace: true } : {}),
  });
  const styles = toPageStyles(
    compiled,
    compileContext.scope,
    options.fetchPolicyId,
    sharedInputsId
  );
  return compiled.trace === undefined
    ? { styles }
    : { styles, trace: compiled.trace };
}

/**
 * The compiled sheet alone, which is what almost every caller wants.
 *
 * DERIVED from {@link resolvePageStylesWithTrace} rather than computed beside
 * it. The two answers would otherwise be two resolutions of one question, and
 * this file already carries several reasons why a second answer about the same
 * document drifts from the first — every staleness test above exists because a
 * stored sheet and a fresh compile disagreed.
 */
export function resolvePageStyles(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined,
  blocks: BlockResolver,
  repairedDocument = false,
  options: ResolveStyleOptions = {}
): PageStyles {
  return resolvePageStylesWithTrace(
    document,
    styles,
    styleContext,
    blocks,
    repairedDocument,
    options
  ).styles;
}

/**
 * CSS made safe to place inside a `<style>` element.
 *
 * A stylesheet has to be injected unescaped or every `>` in a selector breaks,
 * which means the one sequence that can end the element early has to be
 * neutralised here. `</style` inside the text closes the element in the HTML
 * parser regardless of CSS syntax, and everything after it becomes markup — the
 * shortest path from author-supplied custom CSS to script execution.
 *
 * Escaping the slash keeps the CSS meaning identical (a backslash escape is
 * valid inside a CSS string or comment, and the sequence is not valid CSS
 * anywhere else) while leaving the parser nothing to match.
 */
export function styleTextForInjection(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}
