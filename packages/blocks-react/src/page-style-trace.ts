/**
 * The cascade behind a page, for chrome that has to say where a value came from.
 *
 * A style control showing "you set this here" or "this comes from `.card`" is
 * answering a question only the compiler can answer, and the answer has to come
 * from the SAME compile inputs the page was drawn with. That is the whole reason
 * this lives here rather than in the editor: `namedClasses`, `blockBases`,
 * `tokenPrefix` and the fetch predicate are each reconciled from two tiers, and a
 * caller outside this package cannot reach that reconciliation.
 *
 * An editor that assembled a narrower context of its own would compile a cascade
 * the page never had. Measured against the shape it replaces: with only
 * `breakpoints` passed, no class declaration reaches the trace at all, so every
 * value arriving from a named class is reported as set by nobody — and a
 * `url(...)` the host's policy refuses is reported as active, because the
 * predicate that refused it was never applied.
 *
 * @module page-style-trace
 */

import type {
  BlockDocument,
  BlockNode,
  DocumentLimits,
  RemotePatternInput,
  SiteSheetInput,
  StyleCompileContext,
  StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

import { withTypographyDefaults } from "./blocks/typography-defaults";
import {
  pruneRenderedPlaceholders,
  sharedStyleInputs,
  statedBreakpoints,
  withoutStatedNulls,
} from "./page-renderer";
import { prepareDocumentReadStages } from "./prepare-document";
import type { BlockResolver } from "./resolver";
import { registeredBlocks } from "./resolver";
import { effectiveCompile, resolvePageStylesWithTrace } from "./styles";

/** What the page was, or would be, compiled from. */
export interface PageStyleTraceInput {
  readonly document: BlockDocument;
  /** The route's own compile context, as a renderer would receive it. */
  readonly styleContext: StyleCompileContext | undefined;
  /** The site tier, whose classes and breakpoints outrank or fall back to it. */
  readonly site: SiteSheetInput | undefined;
  /**
   * The block registry, defaulting to the one a renderer uses when a host names
   * none — so the two are looking at one registry rather than at two assembled
   * alike.
   */
  readonly blocks?: BlockResolver;
  /** The host's fetch policy, so a refused `url(...)` is refused here too. */
  readonly remotePatterns?: readonly RemotePatternInput[];
  /**
   * The caps the renderer prepares and compiles under.
   *
   * Forwarded because they change what EXISTS: preparation drops nodes past a
   * cap, and the compile drops declarations past another. A page rendered under
   * one cap and a trace compiled under a different one disagree about which
   * declarations were written, so a control is attributed a value the page never
   * emitted, or none at all.
   */
  readonly limits?: DocumentLimits;
}

/**
 * A page's cascade, and the tree it describes.
 *
 * The two travel TOGETHER because they are one answer. Every reader of the
 * entries also has to know which node an entry belongs to, and deriving that
 * from the document the caller happens to hold reintroduces the divergence this
 * module exists to close — the entries describe the prepared tree, so anything
 * asking "which node is this" must ask the same tree.
 */
export interface PageStyleCascade {
  /** The declarations the compiler wrote, in cascade order. */
  readonly entries: readonly StyleTraceEntry[];
  /** The nodes those declarations describe: the tree the sheet was compiled from. */
  readonly nodes: readonly BlockNode[];
}

/**
 * Every declaration the compiler would write for this page, in cascade order.
 *
 * `undefined` when no compile could run — there are no breakpoints to compile
 * against — which is a real answer rather than a failure. A caller must not read
 * it as "nothing is authored": a control told that reports every value as coming
 * from nowhere, which is worse than showing no indicator at all.
 *
 * The document is NOT pruned first. `resolvePageStyles` documents a precondition
 * that it be handed the tree which will RENDER, because a raw one emits rules for
 * nodes a reader withholds and publishes the colours and `url(...)` of a block
 * nobody was served. That precondition guards PUBLISHING, and nothing here
 * publishes — the sheet is discarded and only the trace kept. Pruning would also
 * make the answer worse where it differs: a node hidden at the breakpoint being
 * edited is still selectable from a layers panel and still has authored values an
 * author is entitled to an explanation of, and compiled from the pruned tree
 * every one of its controls would report having been set by nobody.
 */
export function pageStyleTrace(
  input: PageStyleTraceInput
): PageStyleCascade | undefined {
  const shared = sharedStyleInputs(input.styleContext, input.site);
  /*
   * ASKED of the renderer's own helper rather than computed here. This trace and
   * the render must agree about what a stated null means, and two computations
   * of one question agree until the day one of them changes.
   */
  const stated = statedBreakpoints(shared.breakpoints);
  /*
   * The same construction the renderer uses, and for its reason: a route context
   * takes the shared inputs over the top, while a site tier alone can still
   * compile provided it named the breakpoints — the one field a compile cannot
   * proceed without.
   */
  // The same baseline the render path applies, from the same function. The
  // panel explains a cascade, so it has to compile the cascade the page has.
  const merged: StyleCompileContext | undefined =
    input.styleContext !== undefined
      ? withTypographyDefaults({
          ...input.styleContext,
          ...withoutStatedNulls(shared),
          // Spread LAST, so the normalised set replaces the null the spread
          // above would otherwise carry into a slot declared as a set.
          breakpoints: stated ?? input.styleContext.breakpoints,
        })
      : stated === undefined
        ? undefined
        : withTypographyDefaults({
            ...withoutStatedNulls(shared),
            breakpoints: stated,
            /*
             * The site's OWN predicate, copied exactly as the renderer's
             * site-only construction copies it. Dropped, a `url(...)` the site
             * refuses stays in the trace and is reported as active on a page
             * that never fetched it — and the host's `remotePatterns` do not
             * stand in for it, because they are a different tier's answer to a
             * different question.
             */
            ...(input.site?.mayFetchUrl === undefined
              ? {}
              : { mayFetchUrl: input.site.mayFetchUrl }),
          });
  if (merged === undefined) return undefined;
  const { context } = effectiveCompile({
    styleContext: merged,
    // No stored artifact and no caller cap: this compiles to READ the cascade,
    // and a sheet is never kept from it.
    styles: undefined,
    limits: input.limits,
    remotePatterns: input.remotePatterns,
  });
  const resolver = input.blocks ?? registeredBlocks();
  /*
   * The SAME preparation the renderer runs, and for the reason it runs it: a
   * stored document is untrusted. A malformed node — a `null` in `nodes`, or one
   * written against an old block version — passes the envelope guard and then
   * throws while the cascade is read, so an editor compiling the raw tree
   * crashes on open, before the renderer can show the placeholder it has for
   * exactly this.
   *
   * `deduped` put through `pruneRenderedPlaceholders`, which is the derivation
   * the renderer's own style input uses — NOT the pipeline's `prepared`, whose
   * last pass is `pruneKnownPlaceholders`.
   *
   * The two pruning passes share their placeholder predicate and differ in one
   * respect: `pruneKnownPlaceholders` walks only the slots a definition
   * declares, and `pruneRenderedPlaceholders` walks every stored slot. That
   * difference is the whole of what is wrong with `prepared` here.
   *
   * That pass rests on a stated assumption — "a block never calls `renderSlot`
   * for a region it does not declare" — and nothing enforces it. `renderSlot`
   * reads `node.slots?.[name]` and never consults the resolver, so a block whose
   * definition dropped a slot while stored documents still carry it, or a
   * third-party block that renders a name it never declared, puts those children
   * on the page anyway. The renderer knows this: it compiles its own style input
   * from `deduped` through a DIFFERENT pass that walks every stored slot,
   * precisely so their rules survive.
   *
   * Compiled from `prepared`, the trace therefore described a page missing
   * markup the renderer draws. Measured on a block declaring no slots and
   * rendering a stored one: the render path compiled the child's rule and the
   * trace came back EMPTY, so every control on a visibly styled block reported
   * having been set by nobody.
   *
   * Skipping the pruning ALTOGETHER only swaps the error's direction, and that
   * was measured too. A placeholder replaces its node and everything the node
   * contained, so a healthy child of a broken parent reaches no markup: rendered
   * through `PageRenderer`, a styled child under an unregistered block produces
   * a page whose sheet does not carry its rule, while a trace compiled from
   * `deduped` alone reports it. The panel would name a source for a control on a
   * block that is not on the page.
   *
   * The renderer's remaining pass is not mirrored because it cannot apply here.
   * Its drawless drop is taken only when a stored artifact covers the removed
   * nodes' rules, and this compiles with no stored artifact by construction —
   * so that branch is `visible` unchanged, and the renderer's style input
   * reduces exactly to the derivation above.
   *
   * Sanitizing, migration, gating and address repair all still apply, which is
   * what the following paragraphs are about.
   *
   * An earlier version took `migrated` on the reasoning that a node the reader
   * withholds is still selectable from a layers panel and still owed an account.
   * Measured, that distinction buys NOTHING here: a condition-gated node's
   * declarations are dropped by the compiler before any pruning, and a node
   * hidden at a breakpoint survives both trees, being kept and given visibility
   * rules rather than removed.
   *
   * What the earlier stage cost was real. Address repair happens AFTER gating,
   * so `migrated` still holds duplicate node ids — and the compiler deliberately
   * suppresses node-local rules for every node sharing one, because they cannot
   * be addressed separately. The trace then reported the surviving node's
   * controls as unset while its CSS was plainly on the page. A hypothetical
   * benefit against a measured defect is not a trade.
   */
  const stages = prepareDocumentReadStages(input.document, {
    resolver,
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    styleContext: context,
  });
  // An unreadable ENVELOPE, which is a real answer: nothing can be compiled from
  // a document this format does not recognise.
  if (stages === null) return undefined;
  /*
   * The tree, named once and used twice.
   *
   * Returned alongside the entries rather than recomputed by the caller, and
   * that is the whole point of the pairing: a reader that asks WHICH NODE it is
   * looking at from the raw document, while the entries describe this tree,
   * has two answers to one question. They diverge wherever the preparation
   * repaired something — most sharply on a duplicated id, where gating can
   * remove the first node and leave a later one rendering under that id, so the
   * raw lookup returns a node with different classes, a different type and a
   * different chain of ancestors than the one the declarations belong to.
   */
  const nodes = pruneRenderedPlaceholders(stages.deduped, resolver);
  const entries = resolvePageStylesWithTrace(
    nodes,
    // No stored artifact. One would be REUSED rather than recompiled, and a
    // reused sheet has no cascade to report — the caller would get `undefined`
    // for a document it can perfectly well compile.
    undefined,
    context,
    resolver,
    false,
    { trace: true }
  ).trace;
  return entries === undefined ? undefined : { entries, nodes: nodes.nodes };
}
