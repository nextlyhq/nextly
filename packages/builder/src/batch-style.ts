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

import {
  getBlock,
  isLook,
  isTextStyle,
  STYLE_CATALOG,
  stylePropertiesForSupports,
  TEXT_STYLE_PROPERTIES,
  type AnyBlockDefinition,
  type BlockNode,
  type NamedClass,
  type NodeStyles,
  type StyleValue,
  type TokenKind,
  type ValidationIssue,
} from "@nextlyhq/blocks-engine";

import { sameStyleValue, type BuilderOp } from "./op-vocabulary";
import {
  readStyleValue,
  styleClearOp,
  styleWriteOp,
  styleWriteOps,
  type StyleWriteRequest,
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
   * Pair an op with the node it NAMES rather than with the position it
   * arrived in: there is one op per block that needs writing, so a selection
   * where some blocks already hold the value yields fewer ops than nodes.
   *
   * Deliberately NOT ordered by what each op costs the document, though there
   * is a reason to want that. The editor folds a group and judges every step
   * against the byte cap, so a selection sitting at that cap — where one block
   * grows to the shared value and another shrinks by more — is refused when
   * the growing block comes first and accepted when it comes second, for the
   * same resulting document. Writing the reductions first would fix it.
   *
   * Knowing which block shrinks means measuring what each one currently holds,
   * and `measureBytes` invokes a value's own `toJSON` — measured, once per
   * call — on data no guard has accepted yet. Ordering is an optimisation of
   * the peak, never a gate, and running author code to obtain one is not a
   * trade worth making; a measurement that avoided it would be a second
   * implementation of a walk the engine already owns. Left to the surface
   * that can reach a multi-selection, which does not exist yet.
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
 * The ops that set several addresses, each to its own value, across a
 * selection: the sides of a margin set together, or two parts of one value.
 * One op per block, the writes folded into it, so the gesture is one entry in
 * the history.
 */
export function batchStyleWritesOps(
  nodes: readonly BlockNode[],
  writes: readonly StyleWriteRequest[],
  policy?: StylePolicy
): BatchStyleWrite {
  const shared = batchPolicy(policy);
  return collect(nodes, node =>
    styleWriteOps(node.id, node.styles, writes, shared)
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

/**
 * One block's look as "Copy style" takes it: its own values, every state and
 * device, and the classes it wears (its block style, its text style and its
 * shared styles), as the class list holds them.
 */
export interface StyleSource {
  readonly styles: NodeStyles | undefined;
  readonly classes: readonly string[];
}

/** What a paste reads besides the blocks. */
export interface StylePasteOptions {
  /**
   * The site's styles, to tell a block style and a text style from a shared
   * style. Unread, every class is pasted as it is.
   */
  readonly library?: readonly NamedClass[] | undefined;
  /** Where block definitions are read: the registry, unless told. */
  readonly definitions?: (type: string) => AnyBlockDefinition | undefined;
}

/** How many of the source's settings one target had no place for. */
export interface SkippedSettings {
  readonly nodeId: string;
  readonly type: string;
  readonly count: number;
}

/** What a paste would do: the ops as one group, and what each target skips. */
export interface BatchStylePaste {
  /** One op per target that changes, in selection order; empty when none does. */
  readonly ops: readonly BuilderOp[];
  /** The targets that skip something, in selection order. */
  readonly skipped: readonly SkippedSettings[];
}

/** Every property the catalog knows, so another kind of entry is carried. */
const CATALOG_PROPERTIES: ReadonlySet<string> = new Set(
  STYLE_CATALOG.map(entry => entry.property)
);

/**
 * The ops that give each block the source's look: the source's own values in
 * place of the block's, and the source's classes in place of the ones it
 * wears. The block's words, images and links are not touched.
 *
 * Each op updates a block's own `styles` and `classes` and nothing else, so a
 * paste never writes into a shared style, whatever the editing bar targets.
 *
 * A block keeps only what it can show, as "Turn into" does: a value its type
 * does not support, a block style of another type, and a text style on a
 * block with no text settings are skipped and counted, one per value at each
 * state and device, so the author can be told how many.
 */
export function batchStylePasteOps(
  nodes: readonly BlockNode[],
  source: StyleSource,
  options: StylePasteOptions = {}
): BatchStylePaste {
  const definitionOf = options.definitions ?? getBlock;
  const ops: BuilderOp[] = [];
  const skipped: SkippedSettings[] = [];
  for (const node of nodes) {
    const supported = new Set(
      stylePropertiesForSupports(definitionOf(node.type)?.supports).map(
        entry => entry.property
      )
    );
    const styles = keptStyles(source.styles, supported);
    const classes = keptClasses(
      source.classes,
      node.type,
      supported,
      options.library
    );
    const count = styles.skipped + classes.skipped;
    if (count > 0) skipped.push({ nodeId: node.id, type: node.type, count });
    const op = pasteOp(node, styles.kept, classes.kept);
    if (op !== null) ops.push(op);
  }
  return { ops, skipped };
}

/**
 * The source's values a block can take, and how many it can't: a catalog
 * property its type does not support is left out at every state and device.
 * A state or device left empty goes with it.
 */
function keptStyles(
  styles: NodeStyles | undefined,
  supported: ReadonlySet<string>
): { kept: NodeStyles | undefined; skipped: number } {
  if (styles === undefined) return { kept: undefined, skipped: 0 };
  const kept: Record<string, Record<string, Record<string, unknown>>> = {};
  let skipped = 0;
  for (const [state, byDevice] of Object.entries(styles)) {
    const keptDevices: Record<string, Record<string, unknown>> = {};
    for (const [device, values] of Object.entries(byDevice ?? {})) {
      const taken = keptValues(values, supported);
      skipped += taken.skipped;
      if (taken.kept !== undefined) keptDevices[device] = taken.kept;
    }
    if (Object.keys(keptDevices).length > 0) kept[state] = keptDevices;
  }
  return {
    kept: Object.keys(kept).length === 0 ? undefined : kept,
    skipped,
  };
}

/** One state and device's values a block can take, copied, and how many it can't. */
function keptValues(
  values: Readonly<Record<string, unknown>> | undefined,
  supported: ReadonlySet<string>
): { kept: Record<string, unknown> | undefined; skipped: number } {
  const kept: Record<string, unknown> = {};
  let skipped = 0;
  for (const [property, value] of Object.entries(values ?? {})) {
    if (CATALOG_PROPERTIES.has(property) && !supported.has(property)) {
      skipped += 1;
    } else {
      kept[property] = structuredClone(value);
    }
  }
  return {
    kept: Object.keys(kept).length === 0 ? undefined : kept,
    skipped,
  };
}

/**
 * The source's classes a block can wear, and how many it can't: a block
 * style belongs to one block type, and a text style is offered only on a
 * block with text settings. A shared style, and a class the site doesn't
 * name, are worn as they are.
 */
function keptClasses(
  classes: readonly string[],
  type: string,
  supported: ReadonlySet<string>,
  library: readonly NamedClass[] | undefined
): { kept: string[]; skipped: number } {
  const takesText = [...TEXT_STYLE_PROPERTIES].some(property =>
    supported.has(property)
  );
  const kept: string[] = [];
  let skipped = 0;
  for (const id of classes) {
    const entry = library?.find(each => each.id === id);
    const fits =
      entry === undefined ||
      (isLook(entry)
        ? entry.blockType === type
        : !isTextStyle(entry) || takesText);
    if (fits) kept.push(id);
    else skipped += 1;
  }
  return { kept, skipped };
}

/**
 * The one op that leaves a block with these values and classes, or `null`
 * when it already has them. A field left empty is removed by name, as every
 * style op removes one.
 */
function pasteOp(
  node: BlockNode,
  styles: NodeStyles | undefined,
  classes: readonly string[]
): BuilderOp | null {
  const patch: { styles?: NodeStyles; classes?: string[] } = {};
  const unset: ("styles" | "classes")[] = [];
  if (!sameStyleValue(node.styles ?? {}, styles ?? {})) {
    if (styles === undefined) unset.push("styles");
    else patch.styles = styles;
  }
  if (!sameIds(node.classes ?? [], classes)) {
    if (classes.length === 0) unset.push("classes");
    else patch.classes = [...classes];
  }
  if (Object.keys(patch).length === 0 && unset.length === 0) return null;
  return {
    kind: "update",
    id: node.id,
    patch,
    ...(unset.length === 0 ? {} : { unset }),
  };
}

/** Two class lists by value, in order: the order is what a block stores. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
