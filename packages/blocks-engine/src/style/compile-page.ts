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
import { pointer } from "../issue-text";
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
  const contexts: BreakpointContext[] = [{ id: BASE_BREAKPOINT }];
  const widthDescending = (a: BreakpointDef, b: BreakpointDef): number =>
    (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity);
  for (const def of [...set.viewport].sort(widthDescending)) {
    if (def.id === BASE_BREAKPOINT) continue;
    contexts.push({
      id: def.id,
      ...(def.maxWidth === undefined
        ? {}
        : { atRule: `@media (max-width: ${def.maxWidth}px)` }),
    });
  }
  for (const def of [...set.container].sort(widthDescending)) {
    if (def.id === BASE_BREAKPOINT) continue;
    contexts.push({
      id: def.id,
      ...(def.maxWidth === undefined
        ? {}
        : { atRule: `@container (max-width: ${def.maxWidth}px)` }),
    });
  }
  return contexts;
}

/** The breakpoint id meaning "no media query" in a stored style envelope. */
export const BASE_BREAKPOINT = "base";

/** Compile one styles envelope into rules under one selector. */
function envelopeRules(
  styles: NodeStyles | undefined,
  selector: string,
  basePath: string,
  contexts: readonly BreakpointContext[],
  tokenPrefix: string,
  warnings: ValidationIssue[]
): CssRule[] {
  if (!isPlainRecord(styles)) return [];
  const rules: CssRule[] = [];
  for (const context of contexts) {
    for (const state of STYLE_STATES) {
      const byBreakpoint = styles[state];
      if (!isPlainRecord(byBreakpoint)) continue;
      const values = byBreakpoint[context.id];
      if (!isPlainRecord(values)) continue;
      const path = pointer(pointer(basePath, state), context.id);
      const compiled = compileStyleValues(values, path, tokenPrefix);
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
 */
function visibilityRules(
  node: BlockNode,
  selector: string,
  contexts: readonly BreakpointContext[]
): CssRule[] {
  const devices = node.visibility?.devices;
  if (!isPlainRecord(devices)) return [];
  const rules: CssRule[] = [];
  for (const context of contexts) {
    if (devices[context.id] !== false) continue;
    rules.push({
      ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
      selector,
      declarations: [{ property: "display", value: "none" }],
    });
  }
  return rules;
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
  const visit = (nodes: readonly BlockNode[], base: string): void => {
    nodes.forEach((node, index) => {
      if (!isPlainRecord(node) || typeof node.id !== "string") return;
      const path = pointer(base, index);
      placed.push({ node, path });
      if (!isPlainRecord(node.slots)) return;
      // Sorted, so two documents whose slots were written in a different order
      // still compile to the same bytes.
      for (const slot of Object.keys(node.slots).sort()) {
        const children = node.slots[slot];
        if (!Array.isArray(children)) continue;
        visit(children, pointer(pointer(path, "slots"), slot));
      }
    });
  };
  visit(doc.nodes, "/nodes");
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
  const contexts = breakpointContexts(ctx.breakpoints);
  const tokenPrefix = ctx.tokenPrefix ?? DEFAULT_TOKEN_PREFIX;

  const nodes = documentNodes(doc);
  const classes = nodeClassNames(nodes.map(entry => entry.node.id));

  const rules: CssRule[] = [];

  // Page-scoped values, on the root every other selector is anchored to. First
  // because it is the outermost element: what it sets is what everything inside
  // inherits before any block has said anything.
  rules.push(
    ...envelopeRules(
      doc.settings?.styles,
      `.${PAGE_ROOT_CLASS}`,
      "/settings/styles",
      contexts,
      tokenPrefix,
      warnings
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
        `.${PAGE_ROOT_CLASS} .${blockTypeClassName(type)}`,
        `/blockBases/${type}`,
        contexts,
        tokenPrefix,
        warnings
      )
    );
  }

  // Each node's own values, in document order so the stylesheet reads the way
  // the page does.
  for (const { node, path } of nodes) {
    const className = classes.get(node.id);
    if (className === undefined) continue;
    const selector = `.${PAGE_ROOT_CLASS} .${className}`;
    rules.push(
      ...envelopeRules(
        node.styles,
        selector,
        pointer(path, "styles"),
        contexts,
        tokenPrefix,
        warnings
      )
    );
    rules.push(...visibilityRules(node, selector, contexts));
  }

  return { css: serializeRules(rules), warnings, classes };
}
