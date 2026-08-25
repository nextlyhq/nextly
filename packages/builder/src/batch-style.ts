/**
 * What a SELECTION of blocks shares at one style address, and what it takes to
 * change it.
 *
 * ## A different surface, not a wider one
 *
 * `StyleInspectorPanel` refuses a multi-selection and says why: `selectedId` is
 * the primary, so inspecting it would draw writable controls that change one
 * block while the canvas outlines six. Editing one property across a whole
 * selection is a different question — it has to say what a shared value even
 * MEANS before it can offer to change one — and this module answers that half
 * without knowing anything about how it is drawn.
 *
 * ## One group, one undo
 *
 * Every write here produces a GROUP of ops for `applyAll`, never a sequence of
 * `apply` calls. The store folds a group onto a working document and commits
 * nothing until all of them succeed, then pushes one history entry. That is the
 * whole point of batching: six blocks aligned in one gesture must come back in
 * one undo, and a half-applied batch must not exist at all.
 *
 * ## The nodes are passed in, not looked up
 *
 * A caller holds the selection and the document; resolving ids here would mean
 * walking the tree once per address, and a panel asks about many addresses per
 * render. The same reason `style-subject` gives for building a subject once.
 *
 * @module batch-style
 */

import { measureBytes } from "@nextlyhq/blocks-engine";
import type {
  BlockNode,
  StyleValue,
  TokenKind,
  ValidationIssue,
} from "@nextlyhq/blocks-engine";

import { sameStyleValue, type BuilderOp } from "./ops";
import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  type StyleAddress,
  type StylePolicy,
} from "./style-values";

/**
 * What a selection holds at one address.
 *
 * `mixed` is a THIRD answer rather than an absence, and keeping it distinct is
 * the whole reason this type exists. A control showing nothing means every
 * selected block has nothing there and typing sets them all; a control showing
 * "Mixed" means typing REPLACES values that differ, and an author is entitled
 * to know which of those they are about to do.
 */
export type SharedValue =
  | { readonly kind: "same"; readonly value: StyleValue | undefined }
  | { readonly kind: "mixed" };

/**
 * What the selection shares at one address, or that it shares nothing.
 *
 * An EMPTY selection answers `same` with no value rather than `mixed`: nothing
 * disagrees when there is nothing to disagree, and reporting a conflict for an
 * empty set would put "Mixed" on a panel describing no blocks.
 *
 * Compared with `sameStyleValue`, which is the predicate `styleWriteOp` uses to
 * decide a write changes nothing. Sharing it is what keeps this reader and that
 * writer from disagreeing: a comparison of this module's own could call two
 * values equal that the writer treats as different, and a control committing
 * the value they "share" would then emit an op per node and an undo entry for a
 * gesture that changed nothing.
 *
 * The STYLE comparison rather than the general stored one, because the compiler
 * sorts a composite's keys before emitting it — so two blocks holding one value
 * in different key order render identically and do agree.
 *
 * What it brings: structural rather than serialised, so a value carrying its
 * own `toJSON` cannot decide its comparison; iterative, so a deep value cannot
 * exhaust the stack; bounded, and answering "different" when the budget runs
 * out. That direction is the safe one — MIXED makes the control say so and
 * makes typing a replacement, while a wrong "same" shows one block's value
 * while another holds a different one and the next edit overwrites it silently.
 */
export function sharedValueAt(
  nodes: readonly BlockNode[],
  address: StyleAddress
): SharedValue {
  let first: { value: StyleValue | undefined } | undefined;
  for (const node of nodes) {
    const value = readStyleValue(node.styles, address);
    if (first === undefined) {
      first = { value };
      continue;
    }
    if (!sameStyleValue(first.value, value)) return { kind: "mixed" };
  }
  return { kind: "same", value: first?.value };
}

/** What a batch edit would do, before anything is applied. */
export interface BatchStyleWrite {
  /**
   * The ops to apply as ONE group, in selection order.
   *
   * Empty when every selected block already holds the value. That is not a
   * failure and must not be reported as one — it is the ordinary result of
   * setting a value half the selection already had, and applying an empty group
   * would ask the store for a history entry that undoes nothing.
   */
  readonly ops: readonly BuilderOp[];
  /**
   * Why the value cannot be written, or `undefined` when it can.
   *
   * ONE answer for the whole selection rather than one per block, because that
   * is what the value layer actually decides: `styleWriteOp` refuses on the
   * VALUE and the POLICY, and a batch passes the same two to every node — so a
   * refusal is a property of what is being written, never of which block is
   * receiving it. Measured rather than assumed: a node carrying an unrelated
   * invalid stored value is still accepted, so even a malformed document does
   * not split the answer.
   *
   * A per-block list was the first shape here and it was machinery for a case
   * that cannot arise. If a policy ever varies by block type — which is the
   * reason one would — this becomes a list again, as a change with its own
   * evidence rather than a shape kept in advance.
   */
  readonly refused: string | undefined;
  /**
   * Findings the catalog reported that do NOT refuse the write.
   *
   * Carried rather than dropped, for the reason `style-values` gives beside
   * its own `warnings`: a warning is the validator explaining something about
   * a value it ACCEPTED — a token reference no supplied token table defines,
   * for instance, which renders as nothing — and a surface that discarded them
   * would present an accepted-with-reservations value as an unremarkable one.
   * The single-block panel already shows them; a batch that swallowed them
   * would be the same edit explaining less about itself the more blocks it
   * touched.
   *
   * DEDUPLICATED across the selection rather than repeated per block. Every
   * node is asked about the same value under the same policy, so an issue
   * arising from the value appears once per node and saying it six times is
   * noise. Deduplicated by CONTENT rather than assumed identical, because that
   * every node produces the same set is a property of today's value layer
   * rather than something this module is entitled to rely on.
   */
  readonly warnings: readonly ValidationIssue[];
}

/**
 * The ops that set one address across a selection.
 *
 * Built per node from that node's OWN styles, never from the primary's, and the
 * reason is the OTHER values each block holds. A style op patches the whole
 * `styles` envelope, so an op built from the primary and repeated carries the
 * primary's unrelated declarations with it: measured, writing `fontSize` to a
 * block from a primary that also set `color` produces a patch containing both,
 * so the batch silently gives every block the primary's colour.
 *
 * Not, as first written here, because the inverse would be wrong. `applyOp`
 * derives the inverse from the document it is applied to rather than from the
 * op, so undo is correct either way — which is exactly why this had to be
 * measured instead of reasoned about.
 */
export function batchStyleWriteOps(
  nodes: readonly BlockNode[],
  address: StyleAddress,
  value: StyleValue,
  policy?: StylePolicy
): BatchStyleWrite {
  const shared = batchPolicy(policy);
  return collect(nodes, node =>
    styleWriteOp(node.id, node.styles, address, value, shared)
  );
}

/**
 * The ops that clear one address across a selection.
 *
 * Clearing is not writing an empty value, and the distinction survives the
 * batch: a block with nothing there produces no op rather than an op that
 * writes nothing.
 */
export function batchStyleClearOps(
  nodes: readonly BlockNode[],
  address: StyleAddress,
  policy?: StylePolicy
): BatchStyleWrite {
  const shared = batchPolicy(policy);
  return collect(nodes, node =>
    styleClearOp(node.id, node.styles, address, shared)
  );
}

/**
 * The caller's policy with its lookups answered once per BATCH.
 *
 * `tokens.kindOf` and `mayFetchUrl` are supplied by the site, and the value
 * layer memoizes them for the span of ONE validation — so a ten-node selection
 * asked the site ten times for the same answer. Measured: ten nodes, ten
 * `kindOf` calls, for a token whose kind cannot vary by node.
 *
 * Sound because the question does not depend on the node. `kindOf` maps a token
 * NAME to its kind and `mayFetchUrl` judges a URL; neither is handed anything
 * about the block receiving the value, so an answer that differed between two
 * nodes of one batch would be a site policy contradicting itself mid-gesture.
 *
 * Scoped to the batch and thrown away with it, rather than cached across calls:
 * a site that adds a token between two gestures must be seen by the second one.
 *
 * Deliberately NOT solved by validating once and reusing the result. That needs
 * the value layer to split validation from op-building — a second entry point
 * into the code deciding what a valid write is, and two of those drift. The
 * per-node validation that remains is a pure function of a small value and
 * costs nothing measurable; what costs something is calling the SITE.
 */
function batchPolicy(policy: StylePolicy | undefined): StylePolicy | undefined {
  if (policy === undefined) return policy;
  const lookup = policy.tokens;
  const mayFetch = policy.mayFetchUrl;
  if (lookup === undefined && mayFetch === undefined) return policy;

  const kinds = new Map<string, TokenKind | undefined>();
  const urls = new Map<string, boolean>();
  return {
    ...policy,
    ...(lookup === undefined
      ? {}
      : {
          tokens: {
            kindOf(name: string) {
              // `has` rather than a truthy check: `undefined` is the answer for
              // a token the site does not define, and it is the answer most
              // worth not asking twice.
              if (kinds.has(name)) return kinds.get(name);
              const kind = lookup.kindOf(name);
              kinds.set(name, kind);
              return kind;
            },
          },
        }),
    ...(mayFetch === undefined
      ? {}
      : {
          mayFetchUrl(url: string) {
            const cached = urls.get(url);
            if (cached !== undefined) return cached;
            const allowed = mayFetch(url);
            urls.set(url, allowed);
            return allowed;
          },
        }),
  };
}

/**
 * How many bytes this op adds to the node it targets, or takes away.
 *
 * EXACT rather than estimated: a style op replaces the node'"'"'s whole `styles`
 * envelope, so the difference between what the patch carries and what the node
 * holds today is the difference the document will see. Nothing here is a proxy
 * for size — measuring the op itself, or counting keys, would order by
 * something correlated with the answer instead of by the answer.
 *
 * Measured with the engine'"'"'s own counter, which walks and stops as soon as the
 * question is settled, rather than by serialising: a value far past any cap
 * would otherwise be built as a string twice just to decide it is large.
 *
 * An unmeasurable side answers 0 — a value that cannot be sized cannot be
 * ordered by size, and the op layer will refuse it on its own terms. Ordering
 * is an optimisation of the PEAK, never a gate.
 */
function growth(node: BlockNode, op: BuilderOp): number {
  const after = op.kind === "update" ? op.patch.styles : undefined;
  const before = node.styles;
  return sizeOf(after) - sizeOf(before);
}

function sizeOf(value: unknown): number {
  if (value === undefined) return 0;
  const measured = measureBytes(value, Number.MAX_SAFE_INTEGER);
  return measured.exceeded ? 0 : measured.bytes;
}

/** The shared walk, so writing and clearing cannot come to differ. */
function collect(
  nodes: readonly BlockNode[],
  build: (node: BlockNode) => ReturnType<typeof styleWriteOp>
): BatchStyleWrite {
  const ops: { readonly op: BuilderOp; readonly delta: number }[] = [];
  // Keyed on every field an issue carries, so two findings that differ only in
  // `path` or `suggestion` both survive. `code` and `message` alone would merge
  // the same complaint about two different sub-values into one.
  const warnings = new Map<string, ValidationIssue>();
  for (const node of nodes) {
    const result = build(node);
    if (!result.ok) {
      // The FIRST refusal ends it, and nothing partial is returned. Every node
      // is being asked the same question, so a second answer would repeat the
      // first — and writing the blocks that agreed while the rest did not would
      // leave a selection half-styled from one gesture.
      return {
        ops: [],
        refused: result.issues[0]?.message ?? "This value cannot be used here.",
        // Nothing is being written, so there is nothing an accepted value
        // needs explaining about. A refusal and a warning are different
        // answers and reporting both would leave a surface saying the value
        // was rejected AND that it was accepted with reservations.
        warnings: [],
      };
    }
    for (const warning of result.warnings) {
      warnings.set(
        `${warning.code}\u0000${warning.severity}\u0000${warning.path}\u0000${warning.message}\u0000${warning.suggestion ?? ""}`,
        warning
      );
    }
    // `null` is the value already being there, which is not a refusal and not
    // an op. Six blocks where two already match produce four ops, and the two
    // are as successful as the four.
    if (result.op !== null)
      ops.push({ op: result.op, delta: growth(node, result.op) });
  }
  // SHRINKING FIRST, which is what keeps the gesture'"'"'s outcome independent of
  // the order the author happened to select in.
  //
  // The editor applies a group by folding it, and every step is judged against
  // the document'"'"'s byte cap — as it must be, since a document that transiently
  // breaks its own invariant is one whose UNDO may not be applicable. So a
  // selection sitting at the cap, where one block grows to the shared value and
  // another shrinks by more, was refused when the growing block came first and
  // accepted when it came second, for the same resulting document.
  //
  // Sound to reorder HERE, where it is not sound in general: these ops target
  // DISTINCT nodes — one per selected block — so no two of them touch the same
  // subtree and the resulting document is the same whatever order they run in.
  // Only the peak size along the way changes, and taking the reductions first
  // makes that peak the lowest any order can reach.
  //
  // A stable sort, so blocks that cost the same keep selection order and the
  // ops a reader sees still line up with the selection they came from.
  return {
    ops: [...ops]
      .sort((left, right) => left.delta - right.delta)
      .map(entry => entry.op),
    refused: undefined,
    warnings: [...warnings.values()],
  };
}
