/**
 * The nodes a page's styles are compiled for, in drawing order, and the
 * layout each container gives its children: the flow gap, and the rules a
 * flex or grid container writes.
 *
 * @module style/compile-page-nodes
 */
import {
  type BlockDocument,
  type BlockNode,
  STYLE_STATES,
  type StyleState,
} from "../document";
import { DEFAULT_LIMITS, type DocumentLimits } from "../limits";
import { isPlainRecord } from "../plain-record";
import { selectNodes } from "../select-nodes";
import type { ValidationIssue } from "../validation";
import { isConditionGated } from "../visibility";

import type { BreakpointContext } from "./compile-page-breakpoints";
import { compileStyleValues, type Declaration } from "./declarations";
import type { CssRule } from "./serialize";
import { pushBoundedWarning, type WarningAllowance } from "./warning-allowance";

/** One node, the pointer that resolves to it, and whether anything gates it. */
interface PlacedNode {
  node: BlockNode;
  path: string;
  /**
   * Whether this node is condition-gated, by its OWN conditions or an ancestor's.
   *
   * Inherited down the walk because a reader prunes whole SUBTREES: a conditioned container takes
   * its children with it. A node judged only by its own conditions therefore leaves an
   * unconditional child's rules in the main sheet while that child's markup is withheld —
   * publishing the colours, fonts and `url(...)` of an element nobody was served.
   */
  gated: boolean;
}

/**
 * Every node in the document, each with the pointer that reaches it.
 *
 * The pointer is built during the walk rather than counted, because a warning's
 * path is a promise that it resolves into the document being compiled: a node
 * inside a slot lives at `/nodes/0/slots/children/1`, and numbering nodes in
 * visit order would produce a path that reaches a different node or none at all.
 */
/**
 * Whether a caller's predicate says this node draws nothing, contained.
 *
 * `compilePageCss` is exported, so the predicate is a consumer's function
 * running with nothing above it to catch a failure: a throw would abort the
 * whole compile rather than cost one node its exemption, and a mistakenly
 * `async` one returns a promise that compares unequal to `true` while leaving a
 * rejection nobody handles — which Node reports and can end the process with.
 *
 * Anything short of an explicit `true` counts as drawing, so a predicate that
 * cannot be trusted keeps a node's rules in the sheet rather than removing
 * styling from something that is on the page.
 */
// RELOCATED, not written here — see the docblock of `compile-page.ts`.
// fallow-ignore-next-line code-duplication
function containedDrawsNothing(
  predicate: ((node: BlockNode) => boolean) | undefined,
  node: BlockNode
): boolean {
  if (predicate === undefined) return false;
  let answer: unknown;
  let deferred = false;
  try {
    answer = predicate(node);
    // Read inside the guard: a throwing `then` getter on the returned value
    // would otherwise escape on its way to being caught.
    deferred =
      typeof (answer as { then?: unknown } | undefined)?.then === "function";
  } catch {
    return false;
  }
  if (deferred) {
    void Promise.resolve(answer).catch(() => undefined);
    return false;
  }
  return answer === true;
}

export function documentNodes(
  doc: BlockDocument,
  warnings: ValidationIssue[],
  warningAllowance: WarningAllowance,
  limits: DocumentLimits = DEFAULT_LIMITS,
  drawsNothing?: (node: BlockNode) => boolean
): PlacedNode[] {
  // WHICH nodes are read is `selectNodes`, shared with every other reader of a
  // stored document, because two readers stopping in different places is not a
  // difference anyone sees until a class is deleted off a page still rendering
  // it. What this function adds is the part only styling needs: the gating a
  // node inherits, and how to phrase the limit for an author.
  const selection = selectNodes(doc, limits);

  if (selection.stopped !== undefined) {
    pushBoundedWarning(warningAllowance, warnings, {
      path: selection.stopped.path,
      code: "node-count-exceeded",
      severity: "warning",
      message:
        selection.stopped.reason === "depth"
          ? `Nodes below depth ${selection.stopped.limit} were not styled, because the document nests deeper than a document may.`
          : `Only the first ${selection.stopped.limit} nodes were styled, because the document holds more than a document may.`,
    });
  }

  const saysItDrawsNothing = (node: BlockNode): boolean =>
    containedDrawsNothing(drawsNothing, node);

  const placed: PlacedNode[] = [];
  for (const entry of selection.nodes) {
    // Once gated, gated for the whole subtree: a descendant cannot be served
    // when the ancestor carrying it is not. A block that draws nothing takes
    // its slots with it for the same reason — a slot's children are placed by
    // the markup the block returns, and a block returning nothing places none
    // of them.
    //
    // Read from the parent already placed rather than carried down the walk.
    // Level order puts a parent before its children, so by the time a child is
    // reached its parent's verdict is final.
    const inherited = entry.parent === -1 ? false : placed[entry.parent].gated;
    placed.push({
      node: entry.node,
      path: entry.path,
      gated:
        inherited ||
        isConditionGated(entry.node) ||
        saysItDrawsNothing(entry.node),
    });
  }
  return placed;
}

/**
 * Compile a document's styles.
 *
 * The tiers, in the order they are emitted and therefore in the order they
 * override one another: page settings, block-type defaults, the site's named
 * classes in library order, then each node's own values. A whole tier precedes
 * the whole of the next, so a node's value beats a class's at any breakpoint.
 *
 * Two tiers named in the cascade are still absent. Design tokens are defined by
 * data this signature does not take yet, and user custom CSS has to be sanitized
 * before it can be written at all, so writing it before that exists would be the
 * one hole nothing else in this design leaves open.
 */
/**
 * The children a container's gap spaces: every child after the first.
 *
 * The first child is left alone so the gap never reaches the container's own
 * outer edge, which is what keeps a block from carrying space it did not ask
 * for into whatever holds it.
 *
 * A selector reads siblings in the markup, not boxes on screen, so a child
 * hidden at a breakpoint still counts as one before the next. When every child
 * before it is hidden there, the first child shown keeps the gap. Hiding is a
 * `display: none` written on the hidden node's own class under a width query,
 * which leaves nothing a sibling selector can read; telling the two apart
 * would take a rule per width band per run of hidden siblings, across both
 * breakpoint axes. An author's top margin of zero on that child, at that
 * breakpoint, removes the space.
 */
export const FLOW_CHILDREN = "> * + *";

/** The flow margin a flex or grid container's children get instead of the gap. */
const NO_FLOW_GAP: readonly Declaration[] = [
  { property: "margin-block-start", value: "0" },
];

/**
 * Whether a compiled `display` lays its children out with `gap` rather than in
 * block flow. Every flex and grid form counts, including the inline and
 * two-keyword ones (`inline-flex`, `block grid`).
 */
function spacesWithGap(display: string): boolean {
  return /\b(?:flex|grid)\b/.test(display);
}

/**
 * The flow-margin rules a container needs where its own styles set `display`.
 *
 * One rule per state and breakpoint that states a display, state outside and
 * breakpoint inside — the order `envelopeRules` writes the display itself in —
 * so the cascade that decides which display applies decides which margin
 * applies too: a flex or grid display takes the flow margin off the children,
 * any other display puts the gap back. A state's rule carries the same state
 * selector the display rule does, so a container that turns flex on hover
 * drops the margin only while hovered.
 *
 * The display is compiled through the catalog rather than read raw, so a value
 * the stylesheet refuses changes nothing here either. Its warnings are already
 * reported by the envelope that emits the display, so they are not repeated.
 */
export function layoutModeRules(
  styles: unknown,
  container: string,
  flow: readonly Declaration[],
  contexts: readonly BreakpointContext[],
  anchor: string,
  tokenPrefix: string,
  stateSelectors: Readonly<Record<StyleState, string>>
): CssRule[] {
  if (!isPlainRecord(styles)) return [];
  const rules: CssRule[] = [];
  for (const state of STYLE_STATES) {
    const byBreakpoint = styles[state];
    if (!isPlainRecord(byBreakpoint)) continue;
    for (const context of contexts) {
      const display = displayAt(byBreakpoint[context.id], tokenPrefix);
      if (display === undefined) continue;
      rules.push({
        ...(context.atRule === undefined ? {} : { atRule: context.atRule }),
        selector: `${anchor} :where(${container}${stateSelectors[state]} ${FLOW_CHILDREN})`,
        declarations: [...(spacesWithGap(display) ? NO_FLOW_GAP : flow)],
      });
    }
  }
  return rules;
}

/** The compiled `display` one breakpoint's values state, if any. */
function displayAt(values: unknown, tokenPrefix: string): string | undefined {
  if (!isPlainRecord(values) || !Object.hasOwn(values, "display")) {
    return undefined;
  }
  return compileStyleValues(
    { display: values.display },
    "/display",
    tokenPrefix
  ).declarations.find(declaration => declaration.property === "display")?.value;
}
