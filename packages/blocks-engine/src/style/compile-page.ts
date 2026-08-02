/**
 * Compiling a document's stored styles into one stylesheet.
 *
 * A pure function of persisted data. It reads a document and a context the
 * caller loaded; it never reaches into storage, never calls a block's `render`,
 * and imports no framework. Styles are therefore never collected while
 * something renders, which is the failure mode this design exists to avoid: a
 * stylesheet assembled during a render is missing whatever did not render, and
 * the bug shows up as a block that looks right until the day it is the only
 * thing on the page.
 *
 * Everything is anchored to the page root and emitted at the same specificity,
 * so precedence comes from source order alone. That is why the tiers below are
 * emitted whole, one after another, rather than interleaved by breakpoint: a
 * node's own style beats its block type's default at every width, which is only
 * true if the whole of one tier precedes the whole of the next.
 *
 * @module style/compile-page
 */
import type {
  BlockDocument,
  BlockNode,
  BreakpointDef,
  BreakpointSet,
  NodeStyles,
  StyleState,
} from "../document";
import { STYLE_STATES } from "../document";
import { describeValue, pointer } from "../issue-text";
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import { compileStyleValues, DEFAULT_TOKEN_PREFIX } from "./declarations";
import type { Declaration } from "./declarations";
import {
  blockTypeClassName,
  nodeClassNames,
  PAGE_ROOT_CLASS,
} from "./node-class";
import { serializeRules } from "./serialize";
import type { CssRule } from "./serialize";
import type { StyleIssueBudget } from "./validate-style-value";
import { newStyleIssueBudget } from "./validate-style-value";

/** Everything site-level the compiler needs; the caller loads it. */
export interface StyleCompileContext {
  breakpoints: BreakpointSet;
  /**
   * Base styles per block type, keyed by block name. One shared rule per type
   * rather than a copy inside every node: a page of forty default sections
   * stores no style bytes, resetting a node is deleting its own values, and
   * improving a block's default look reaches pages that already exist.
   */
  blockBases?: Readonly<Record<string, NodeStyles>>;
  /**
   * The custom-property prefix site tokens are emitted under. Configurable
   * because a site's tokens live in the same namespace as everything else on
   * the page; the reserved prefixes belong to the admin and to Tailwind.
   */
  tokenPrefix?: string;
  /**
   * A class distinguishing this document's rules from another's.
   *
   * Node ids are unique within a document, not across documents, so two
   * documents rendered into one DOM — a page and a region, say — can hold the
   * same id and therefore the same generated class. Without a scope their rules
   * cross-apply and page settings from each reach both roots.
   *
   * Added to the page root rather than replacing it, so the anchored selector
   * shape is unchanged and a renderer showing one document at a time needs
   * nothing. The renderer puts the same class on the element it mounts.
   */
  scope?: string;
}

/** A compiled page stylesheet. */
export interface CompiledPageCss {
  css: string;
  /**
   * What was not written, and why. Every entry names a value that is in the
   * document and absent from the stylesheet, so "my style did nothing" always
   * has an answer.
   */
  warnings: ValidationIssue[];
  /**
   * The class assigned to each node id.
   *
   * Returned rather than recomputed by the renderer because two ids can hash
   * alike: only a pass over the whole document sees that, and a renderer that
   * derived the class per node in isolation would give both nodes the same one.
   */
  classes: Map<string, string>;
}

/** The pseudo-class each stored state compiles to. */
const STATE_SELECTORS: Readonly<Record<StyleState, string>> = {
  base: "",
  hover: ":hover",
  // `:focus-visible`, not `:focus`. Styling every focus paints a ring on mouse
  // users who never asked for one, which is why authors historically removed
  // focus styling altogether and broke keyboard navigation.
  focus: ":focus-visible",
  active: ":active",
};

/** One breakpoint to emit under, with the at-rule it needs. */
interface BreakpointContext {
  id: string;
  atRule?: string;
  /** Which axis this belongs to; visibility bands are computed per axis. */
  axis?: "viewport" | "container";
  /** The upper bound, for narrowing a hiding rule that a narrower id undoes. */
  maxWidth?: number;
}

/**
 * The breakpoints to emit, in cascade order.
 *
 * The base breakpoint first and unconditional, then viewport widths descending,
 * then container widths descending. Descending because the model is
 * desktop-first: the unconditional rule describes the widest layout and each
 * narrower breakpoint overrides it, so a narrower one has to come later to win.
 * Container rules follow viewport rules so that an element asked to respond to
 * its own box wins over the same value keyed to the window.
 */
function breakpointContexts(set: BreakpointSet): BreakpointContext[] {
  // The base context carries no upper bound and no at-rule, but it still needs
  // to be bounded from below when a narrower breakpoint shows a node again:
  // without that, hiding at base emits an unconditional rule that a later
  // `true` cannot undo.
  const contexts: BreakpointContext[] = [
    { id: BASE_BREAKPOINT, axis: "viewport" },
  ];
  const widthDescending = (a: BreakpointDef, b: BreakpointDef): number =>
    (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity);
  // The breakpoint set comes from stored settings, so it is read the way
  // validation reads it: as untrusted. A null axis or a malformed definition is
  // skipped rather than dereferenced, because throwing here would take down
  // every page on the site over one corrupt settings record, and rendering is
  // the half a reader still gets after forgiving validation let the document
  // through.
  //
  // A definition whose `maxWidth` is not a finite number is dropped rather than
  // treated as unbounded. Unbounded is not a safe reading of a broken bound: it
  // would emit the breakpoint's values unconditionally, applying at every width
  // the author meant to exclude. Dropped, the id is simply not one this site
  // defines, and the values keyed to it are reported as stale like any other.
  const rawSet: unknown = set;
  const axisDefs = (axis: "viewport" | "container"): BreakpointDef[] => {
    const defs = isPlainRecord(rawSet) ? rawSet[axis] : undefined;
    if (!Array.isArray(defs)) return [];
    return defs.filter((def: unknown): def is BreakpointDef => {
      if (!isPlainRecord(def) || typeof def.id !== "string") return false;
      return (
        def.maxWidth === undefined ||
        (typeof def.maxWidth === "number" && Number.isFinite(def.maxWidth))
      );
    });
  };
  for (const def of axisDefs("viewport").sort(widthDescending)) {
    if (def.id === BASE_BREAKPOINT) continue;
    contexts.push({
      id: def.id,
      axis: "viewport",
      maxWidth: def.maxWidth,
      ...(def.maxWidth === undefined
        ? {}
        : { atRule: `@media (max-width: ${def.maxWidth}px)` }),
    });
  }
  for (const def of axisDefs("container").sort(widthDescending)) {
    if (def.id === BASE_BREAKPOINT) continue;
    contexts.push({
      id: def.id,
      maxWidth: def.maxWidth,
      // A container axis always emits a container query, the widest one
      // included. Left unconditional, the container's own base values would
      // apply to a node with no query-container ancestor at all, and would
      // outrank every viewport rule while doing it. `min-width: 0` matches
      // inside any container and nowhere else, which is exactly the scope.
      atRule:
        def.maxWidth === undefined
          ? `@container (min-width: 0)`
          : `@container (max-width: ${def.maxWidth}px)`,
      axis: "container",
    });
  }
  return contexts;
}

/** The breakpoint id meaning "no media query" in a stored style envelope. */
export const BASE_BREAKPOINT = "base";

/** How many stale-breakpoint warnings one compile reports. */
const MAX_STALE_BREAKPOINT_WARNINGS = 50;

/** How many bytes of JSON-Pointer those warnings may spend between them. */
const MAX_STALE_BREAKPOINT_PATH_BYTES = 10_000;

/**
 * What a compile may spend saying that a breakpoint id no longer resolves.
 *
 * A stale id costs one warning per place it appears, and every one of those
 * repeats the whole pointer above it — a long ancestor slot key included. A
 * document inside the byte cap can therefore hold enough of them to answer with
 * output far larger than itself, which is the amplification a bound exists to
 * stop.
 *
 * Bounded on its own rather than against the style-issue budget, and the
 * separation is the point. That budget decides what gets WRITTEN: a style map
 * reached after it runs out is refused rather than written unchecked. Charging
 * these warnings to it would let one settings record with many stale ids spend
 * the allowance on diagnostics and take the whole page's CSS down behind them,
 * so renaming a breakpoint would blank every page that referenced it. These
 * cost only their own output.
 */
interface StaleIdAllowance {
  remaining: number;
  pathBytes: number;
  announced: boolean;
}

function newStaleIdAllowance(): StaleIdAllowance {
  return {
    remaining: MAX_STALE_BREAKPOINT_WARNINGS,
    pathBytes: MAX_STALE_BREAKPOINT_PATH_BYTES,
    announced: false,
  };
}

/**
 * Report one stale-breakpoint warning, or say once that the rest are not being
 * reported. Silent after that: a word per unreported id would be the
 * amplification restated as an explanation of the bound.
 */
function pushStaleIdWarning(
  allowance: StaleIdAllowance,
  warnings: ValidationIssue[],
  issue: ValidationIssue
): void {
  if (allowance.remaining <= 0 || allowance.pathBytes <= 0) {
    if (allowance.announced) return;
    allowance.announced = true;
    warnings.push({
      path: "",
      code: "style-issues-truncated",
      severity: "warning",
      message:
        "More breakpoint ids are referenced than this site defines than are reported here, so some values and visibility settings were left out of the stylesheet without being listed.",
    });
    return;
  }
  allowance.remaining -= 1;
  allowance.pathBytes -= issue.path.length;
  warnings.push(issue);
}

/**
 * Warn for style values keyed to a breakpoint the site does not define.
 *
 * A breakpoint id is just a string, so a document can outlive the breakpoint it
 * was written against: renaming or removing one leaves values keyed to an id
 * nothing resolves. Compiling only the ids the context knows would drop those
 * values without a word, and this result promises that anything missing from
 * the stylesheet is explained.
 */
function unknownBreakpointWarnings(
  styles: NodeStyles,
  basePath: string,
  contexts: readonly BreakpointContext[],
  warnings: ValidationIssue[],
  allowance: StaleIdAllowance
): void {
  const known = new Set(contexts.map(context => context.id));
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const id of Object.keys(byBreakpoint).sort()) {
      if (known.has(id)) continue;
      pushStaleIdWarning(allowance, warnings, {
        path: pointer(pointer(basePath, state), id),
        code: "unknown-breakpoint",
        severity: "warning",
        message: `Breakpoint "${describeValue(id)}" is not defined for this site, so these values were not written.`,
      });
    }
  }
}

/** Compile one styles envelope into rules under one selector. */
function envelopeRules(
  styles: NodeStyles | undefined,
  selector: string,
  basePath: string,
  contexts: readonly BreakpointContext[],
  tokenPrefix: string,
  warnings: ValidationIssue[],
  budget: StyleIssueBudget,
  staleIds: StaleIdAllowance
): CssRule[] {
  if (!isPlainRecord(styles)) return [];
  unknownBreakpointWarnings(styles, basePath, contexts, warnings, staleIds);
  const rules: CssRule[] = [];
  for (const context of contexts) {
    for (const state of STYLE_STATES) {
      const byBreakpoint = styles[state];
      if (!isPlainRecord(byBreakpoint)) continue;
      const values = byBreakpoint[context.id];
      if (!isPlainRecord(values)) continue;
      const path = pointer(pointer(basePath, state), context.id);
      const compiled = compileStyleValues(values, path, tokenPrefix, budget);
      warnings.push(...compiled.warnings);
      // A property that styles something inside the block goes into its own
      // rule. Keeping the exception in the catalog rather than in a branch here
      // is what makes the set of them enumerable; this only has to honour it.
      for (const rule of groupByDescendant(compiled.declarations)) {
        rules.push({
          ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
          selector: `${selector}${STATE_SELECTORS[state]}${rule.descendant}`,
          declarations: rule.declarations,
        });
      }
    }
  }
  return rules;
}

/** Split declarations by the descendant they attach to, root first. */
function groupByDescendant(
  declarations: readonly Declaration[]
): { descendant: string; declarations: Declaration[] }[] {
  const groups = new Map<string, Declaration[]>();
  for (const declaration of declarations) {
    const key =
      declaration.descendant === undefined ? "" : ` ${declaration.descendant}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [declaration]);
    else group.push(declaration);
  }
  return (
    [...groups.entries()]
      // The node's own rule first, then descendants in a fixed order, so the same
      // document always serializes the same way.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([descendant, group]) => ({ descendant, declarations: group }))
  );
}

/**
 * Rules hiding a node at the breakpoints it is marked hidden for.
 *
 * Visibility is not a style property: it is stored on the node rather than in
 * its style envelope, and a value of `false` means "not shown here" rather than
 * naming a CSS property. Compiling it here keeps the one place that turns a
 * document into CSS in one file.
 *
 * Hiding INHERITS downward, the way every other value in a desktop-first model
 * does: marked hidden at tablet and unmarked below, a node stays hidden on a
 * phone. Marking it visible again at a narrower breakpoint has to stop that,
 * which a plain `max-width` rule cannot do, because the wider rule still
 * matches at the narrower width. Such a rule is bounded below instead, so it
 * covers its own band and stops where the author said to stop.
 */
function visibilityRules(
  node: BlockNode,
  selector: string,
  contexts: readonly BreakpointContext[],
  basePath: string,
  warnings: ValidationIssue[],
  staleIds: StaleIdAllowance
): CssRule[] {
  const devices = node.visibility?.devices;
  if (!isPlainRecord(devices)) return [];
  const rules: CssRule[] = [];
  const known = new Set(contexts.map(context => context.id));
  for (const id of Object.keys(devices).sort()) {
    if (known.has(id)) continue;
    // The same promise the style envelope keeps: a breakpoint the site no
    // longer defines leaves a stored `false` that hides nothing, and saying so
    // is the difference between a node that reappears and a mystery.
    pushStaleIdWarning(staleIds, warnings, {
      path: pointer(pointer(pointer(basePath, "visibility"), "devices"), id),
      code: "unknown-breakpoint",
      severity: "warning",
      message: `Breakpoint "${describeValue(id)}" is not defined for this site, so this visibility setting was not applied.`,
    });
  }
  // Per axis: a container breakpoint neither inherits from nor cancels a
  // viewport one, because the two ask about different boxes.
  for (const axis of ["viewport", "container"] as const) {
    const axisContexts = contexts.filter(context => context.axis === axis);
    let hidden = false;
    let hidingFrom: BreakpointContext | undefined;
    const flush = (lowerBound: number | undefined): void => {
      if (hidingFrom === undefined) return;
      const atRule = boundedAtRule(hidingFrom, lowerBound);
      rules.push({
        ...(atRule === undefined ? {} : { atRule }),
        // Hiding has to beat the node's own `display`, including one stored on
        // a state: `.node:focus-visible { display: block }` outranks a plain
        // `.node { display: none }` however late it comes, so a focused node
        // would stay on screen at a width it is meant to be gone from. Doubling
        // the node class raises this rule above every state selector without
        // reaching for `!important`, which an author could not then override.
        selector: selector.replace(
          /(\.[A-Za-z0-9_-]+)$/,
          (match: string) => `${match}${match}`
        ),
        declarations: [{ property: "display", value: "none" }],
      });
      hidingFrom = undefined;
    };
    for (const context of axisContexts) {
      const declared = devices[context.id];
      if (declared === false && !hidden) {
        hidden = true;
        hidingFrom = context;
        continue;
      }
      if (declared === true && hidden) {
        hidden = false;
        flush(context.maxWidth);
      }
    }
    // Still hidden at the narrowest breakpoint, so the rule runs all the way
    // down and needs no lower bound.
    flush(undefined);
  }
  return rules;
}

/**
 * An at-rule narrowed to stop at a lower bound.
 *
 * Only ever used for a hiding rule that a narrower breakpoint undoes; every
 * other rule inherits downward and wants no floor.
 */
function boundedAtRule(
  context: BreakpointContext,
  lowerBound: number | undefined
): string | undefined {
  if (lowerBound === undefined) return context.atRule;
  const feature = context.axis === "container" ? "@container" : "@media";
  const upper =
    context.maxWidth === undefined
      ? ""
      : `(max-width: ${context.maxWidth}px) and `;
  // A strict lower bound rather than the next whole pixel. Breakpoint widths
  // are arbitrary numbers, so adding one can erase the band entirely — bounds
  // of 640.5 and 640 would ask for `(max-width: 640.5px) and (min-width: 641px)`
  // — and even between whole numbers it leaves fractional widths uncovered,
  // which is exactly where a device pixel ratio puts a viewport.
  return `${feature} ${upper}(width > ${lowerBound}px)`;
}

/** One node and the pointer that resolves to it inside the document. */
interface PlacedNode {
  node: BlockNode;
  path: string;
}

/**
 * Every node in the document, each with the pointer that reaches it.
 *
 * The pointer is built during the walk rather than counted, because a warning's
 * path is a promise that it resolves into the document being compiled: a node
 * inside a slot lives at `/nodes/0/slots/children/1`, and numbering nodes in
 * visit order would produce a path that reaches a different node or none at all.
 */
function documentNodes(doc: BlockDocument): PlacedNode[] {
  const placed: PlacedNode[] = [];
  if (!Array.isArray(doc.nodes)) return placed;
  // A worklist rather than recursion. A stored document is not required to have
  // been validated before it is compiled — a render pass may validate
  // forgivingly, or not at all — and a deeply nested slot chain would then
  // overflow the stack and fail the request with a RangeError instead of
  // returning a stylesheet. Validation walks the same adversarial shape the
  // same way.
  const queue: { nodes: readonly BlockNode[]; base: string }[] = [
    { nodes: doc.nodes, base: "/nodes" },
  ];
  for (let at = 0; at < queue.length; at += 1) {
    const level = queue[at];
    if (level === undefined) continue;
    level.nodes.forEach((node, index) => {
      if (!isPlainRecord(node) || typeof node.id !== "string") return;
      const path = pointer(level.base, index);
      placed.push({ node, path });
      if (!isPlainRecord(node.slots)) return;
      // Sorted, so two documents whose slots were written in a different order
      // still compile to the same bytes.
      for (const slot of Object.keys(node.slots).sort()) {
        const children = node.slots[slot];
        if (!Array.isArray(children)) continue;
        queue.push({
          nodes: children,
          base: pointer(pointer(path, "slots"), slot),
        });
      }
    });
  }
  return placed;
}

/**
 * Compile a document's styles.
 *
 * The tiers, in the order they are emitted and therefore in the order they
 * override one another: page settings, block-type defaults, then each node's
 * own values. Two tiers named in the cascade are deliberately absent here.
 * Design tokens and named classes are defined by data this signature does not
 * take yet, and user custom CSS has to be sanitized before it can be written at
 * all, so writing it before that exists would be the one hole nothing else in
 * this design leaves open.
 */
export function compilePageCss(
  doc: BlockDocument,
  ctx: StyleCompileContext
): CompiledPageCss {
  const warnings: ValidationIssue[] = [];
  // One allowance for the whole compile. Per style map it would reset, and a
  // document with a long slot key and many bad values would answer with output
  // quadratic in its own size.
  const budget = newStyleIssueBudget();
  // Bounded separately from the budget above, so a settings record full of
  // stale ids costs its own diagnostics and not the page's stylesheet.
  const staleIds = newStaleIdAllowance();
  const contexts = breakpointContexts(ctx.breakpoints);
  const tokenPrefix = ctx.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;
  // A scope is a class the renderer also puts on the mounted root, so it is
  // held to what a class may contain rather than trusted into a selector.
  const scope =
    ctx.scope !== undefined && /^[A-Za-z][A-Za-z0-9_-]*$/.test(ctx.scope)
      ? `.${ctx.scope}`
      : "";
  const pageRoot = `.${PAGE_ROOT_CLASS}${scope}`;

  const nodes = documentNodes(doc);
  const classes = nodeClassNames(nodes.map(entry => entry.node.id));

  const rules: CssRule[] = [];

  // Page-scoped values, on the root every other selector is anchored to. First
  // because it is the outermost element: what it sets is what everything inside
  // inherits before any block has said anything.
  rules.push(
    ...envelopeRules(
      doc.settings?.styles,
      pageRoot,
      "/settings/styles",
      contexts,
      tokenPrefix,
      warnings,
      budget,
      staleIds
    )
  );

  // One rule per block type present, not per node using it.
  const usedTypes = new Set<string>();
  for (const { node } of nodes) {
    if (typeof node.type === "string") usedTypes.add(node.type);
  }
  const bases = ctx.blockBases ?? {};
  for (const type of [...usedTypes].sort()) {
    if (!Object.hasOwn(bases, type)) continue;
    rules.push(
      ...envelopeRules(
        bases[type],
        `${pageRoot} .${blockTypeClassName(type)}`,
        pointer("/blockBases", type),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        staleIds
      )
    );
  }

  // Each node's own values, in document order so the stylesheet reads the way
  // the page does.
  for (const { node, path } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined) continue;
    const selector = `${pageRoot} .${className}`;
    rules.push(
      ...envelopeRules(
        node.styles,
        selector,
        pointer(path, "styles"),
        contexts,
        tokenPrefix,
        warnings,
        budget,
        staleIds
      )
    );
    rules.push(
      ...visibilityRules(node, selector, contexts, path, warnings, staleIds)
    );
  }

  return { css: serializeRules(rules), warnings, classes };
}
