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

import type {
  BlockNode,
  StyleValue,
  TokenKind,
  ValidationIssue,
} from "@nextlyhq/blocks-engine";

import type { BuilderOp } from "./ops";
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
 * Compared by STRUCTURE, because a style value is a tree — a padding is four
 * sides, a shadow is a record — and two blocks holding equal trees hold equal
 * values however separately those trees were built. Reference equality would
 * report every selection as mixed the moment the values came from different
 * nodes, which is always.
 *
 * A value this cannot compare answers MIXED, and that direction is the whole
 * safety of the surface. "Mixed" makes the control say so and makes typing a
 * replacement, which is safe; a wrong "same" shows one block's value while
 * another holds a different one, and the next edit overwrites it silently.
 */
export function sharedValueAt(
  nodes: readonly BlockNode[],
  address: StyleAddress
): SharedValue {
  let first: { value: StyleValue | undefined } | undefined;
  let firstShape: string | undefined;
  for (const node of nodes) {
    const value = readStyleValue(node.styles, address);
    const shape = shapeOf(value);
    // Not comparable without running code this module does not own. Reported as
    // a disagreement rather than skipped, so an unreadable value can never be
    // the reason a selection looks unanimous.
    if (shape === null) return { kind: "mixed" };
    if (first === undefined) {
      first = { value };
      firstShape = shape;
      continue;
    }
    if (shape !== firstShape) return { kind: "mixed" };
  }
  return { kind: "same", value: first?.value };
}

/**
 * How deep {@link shapeOf} will walk before refusing to compare.
 *
 * The stack is the real limit and a cycle is the real reason: without this, a
 * value referring to itself recursed until the budget ran out — ten thousand
 * frames — and threw `RangeError` out of a comparison rather than answering.
 */
const MAX_VALUE_DEPTH = 32;

/**
 * A stable string for a style value, or `null` when it cannot be compared.
 *
 * Walks the value's OWN data properties rather than serialising it, and the
 * difference is not stylistic. `JSON.stringify` calls `toJSON` before a
 * replacer ever sees the object, so a value carrying an inherited `toJSON`
 * decides its own comparison text: two paddings differing at `blockStart`
 * measured as EQUAL through a prototype whose `toJSON` returned a constant,
 * and `sharedValueAt` answered `same` for a selection that disagreed — the
 * exact failure this module exists to prevent. A throwing `toJSON` escaped the
 * read entirely, which in a panel is the panel.
 *
 * So nothing here runs code the value brought with it:
 *
 * - **Own properties only.** `Object.keys` never reaches the prototype, so an
 *   inherited `toJSON`, `toString` or accessor is not consulted at all.
 * - **Data properties only.** An OWN accessor is refused rather than invoked —
 *   answering `null`, which the caller reads as a disagreement. Invoking it
 *   would run author code during an inspection; treating two accessors as
 *   equal would hide a real difference behind them.
 * - **Keys sorted at every level**, so `{ top, left }` and `{ left, top }` —
 *   the same value assembled by two code paths — read the same.
 * - **Bounded in BOTH directions**, which is what terminates a cycle.
 *   `JSON.stringify` threw on one; a hand-rolled walk loops, and this is
 *   exported API now, so the value is whatever a caller passed. The budget
 *   bounds how many values are read; the DEPTH bounds how deep the walk goes,
 *   and only the second one stops a cycle — measured, because a budget of
 *   10,000 alone recursed ten thousand frames deep on a two-node cycle and
 *   exhausted the stack instead of answering.
 *
 * Types are part of the text: `1` and `"1"` are different values and must not
 * compare equal because they print alike.
 *
 * `undefined` gets a marker leading with NUL, which no ordinary text produces,
 * so it cannot collide with a real value's shape. Written as the ESCAPE `\0`,
 * never as the byte itself — a literal NUL makes the whole file binary to the
 * tools that read it: `file` reports `data` instead of TypeScript, and
 * `rg`/`grep` answer "binary file matches" and stop, so every symbol here goes
 * missing from routine searches unless the caller remembers `--text`. Shipped
 * that way once and it hid the module from its own callers.
 */
function shapeOf(
  value: unknown,
  budget = { left: 10_000 },
  depth = 0
): string | null {
  // A style value is shallow — a property holding sides, or corners, or a
  // record of them — so this bound is far above anything a document produces
  // and well below what the stack can take.
  if (depth > MAX_VALUE_DEPTH) return null;
  if (budget.left-- <= 0) return null;
  const leaf = scalarShapeOf(value);
  if (leaf !== undefined) return leaf;
  return Array.isArray(value)
    ? listShapeOf(value, budget, depth)
    : recordShapeOf(value as object, budget, depth);
}

/**
 * The text for a value with no PARTS, or `undefined` when it has parts.
 *
 * Three answers, and the third is why this is separate from the walk above: a
 * string is the comparison, `null` refuses the comparison, and `undefined` says
 * "this is a container, keep walking". Folding that into the walk made one
 * function answer both what a leaf reads as and how a tree is assembled.
 *
 * The type letter is part of the text. `1` and `"1"` are different values and
 * must not compare equal for printing alike; so must `1` and `1n`.
 *
 * A string leaf is LENGTH-PREFIXED, which is what makes the encoding injective.
 * Inserted verbatim, a string can forge the punctuation that separates parts:
 * measured, `{ a: 'x,"b":sy' }` and `{ a: "x", b: "y" }` — one key against two
 * — produced the identical text and `sharedValueAt` answered `same` for values
 * that disagree. The length pins where the leaf ends, so no content can end it
 * early.
 */
function scalarShapeOf(value: unknown): string | null | undefined {
  if (value === undefined) return "\0unset";
  if (value === null) return "\0null";
  if (typeof value === "string") return `s${value.length}:${value}`;
  if (typeof value === "number") return `n${String(value)}`;
  if (typeof value === "bigint") return `i${String(value)}`;
  if (typeof value === "boolean") return `b${String(value)}`;
  // A function or a symbol is not a style value and has no comparable text.
  // Refused rather than given one, so it cannot read as equal to anything.
  if (typeof value !== "object") return null;
  return undefined;
}

/** How a list's parts compare, by INDEX, which is the only order it has. */
function listShapeOf(
  value: readonly unknown[],
  budget: { left: number },
  depth: number
): string | null {
  const parts: string[] = [];
  for (const entry of value) {
    const shape = shapeOf(entry, budget, depth + 1);
    if (shape === null) return null;
    parts.push(shape);
  }
  return `[${parts.join(",")}]`;
}

/**
 * The record's OWN enumerable keys, sorted, or `null` when there are more of
 * them than the budget allows.
 *
 * Counted DURING enumeration rather than after it. `Object.keys(value).sort()`
 * builds and sorts the whole list before anything can refuse it, so a value
 * carrying hundreds of thousands of keys — which an import or a corrupt
 * document can produce — costs all of that per node before the budget is
 * consulted even once. Measured at 300,000 keys: the walk refused, having first
 * enumerated and sorted every one of them.
 *
 * `for...in` reaches the prototype, so `Object.hasOwn` filters; the pair reads
 * exactly what `Object.keys` would, one key at a time and interruptibly.
 */
function ownKeysWithin(
  value: object,
  budget: { left: number }
): string[] | null {
  const keys: string[] = [];
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (keys.length >= budget.left) return null;
    keys.push(key);
  }
  return keys.sort();
}

/**
 * How a record's parts compare: its OWN data properties, keys sorted.
 *
 * The prototype is never reached, so an inherited `toJSON`, `toString` or
 * accessor is not consulted. An OWN accessor is refused rather than invoked —
 * reading it would run author code during an inspection, and treating two
 * accessors as equal would hide a real difference behind them.
 *
 * Keys are length-prefixed for the same reason string leaves are: a key
 * containing the punctuation between parts could otherwise forge a boundary.
 */
function recordShapeOf(
  value: object,
  budget: { left: number },
  depth: number
): string | null {
  const keys = ownKeysWithin(value, budget);
  if (keys === null) return null;
  const parts: string[] = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return null;
    const shape = shapeOf(descriptor.value, budget, depth + 1);
    if (shape === null) return null;
    parts.push(`${key.length}:${key}=${shape}`);
  }
  return `{${parts.join(",")}}`;
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

/** The shared walk, so writing and clearing cannot come to differ. */
function collect(
  nodes: readonly BlockNode[],
  build: (node: BlockNode) => ReturnType<typeof styleWriteOp>
): BatchStyleWrite {
  const ops: BuilderOp[] = [];
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
    if (result.op !== null) ops.push(result.op);
  }
  return { ops, refused: undefined, warnings: [...warnings.values()] };
}
