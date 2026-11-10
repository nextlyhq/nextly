"use client";

/**
 * The editing canvas — the authored page, drawn by the same renderer that draws
 * the published one.
 *
 * It delegates every pixel to `PageRenderer` and adds only the things editing
 * needs on top: which node is selected, which is under the pointer, and the
 * outlines that say so. Nothing here knows how a heading or a gallery draws
 * itself, and that is the property worth protecting — a canvas with its own
 * rendering path is a second implementation of "what does this page look like",
 * and the two drift in the direction nobody tests, so the preview stops matching
 * the page while both look correct in isolation.
 *
 * That mattered concretely: the editor this replaces DID have its own compiler
 * and its own block set, and the two disagreed about the token namespace, about
 * where a page's nodes live, and about what a binding is. A faithful preview was
 * unreachable from there by construction, not by neglect.
 *
 * **`siteStyles` is a required prop, deliberately.** `PageRenderer` takes it as
 * optional because a standalone consumer may legitimately emit no site sheet,
 * but for the canvas an omitted sheet is never correct: the design tokens, the
 * block-type defaults and the named classes all live in it, so a canvas without
 * it shows a page whose grid, clipping and colours are missing exactly where the
 * published page has them. Making it optional here would let a faithful-looking
 * preview be wrong in a way no assertion catches, so the type demands it and the
 * host has to supply what the route supplies.
 *
 * @module canvas
 */

import {
  entryContentFieldOf,
  entryContentPlacements,
  findNode,
  isPlainRecord,
  PAGE_ROOT_CLASS,
  placementGatesOf,
  previewStateClass,
  resolveSiteTokens,
  resolveTokenPrefix,
  revealConditioned,
  statePropagatesToAncestors,
  STYLE_STATES,
  tokenCustomProperty,
  tokenIdentity,
  walkNodes,
  DEFAULT_LIMITS,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type DefinitionsById,
  type DocumentLimits,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import {
  ENTRY_CONTENT_DRAWN_ATTRIBUTE,
  INSTANCE_ATTRIBUTE,
  layoutPartSheets,
  LIST_ACTION_ATTRIBUTE,
  LIST_REF_ATTRIBUTE,
  NODE_ID_ATTRIBUTE,
  PageRenderer,
  registeredBlocks,
  sharedStyleInputs,
  type PagePart,
  type PageRendererProps,
  type PartSheet,
} from "@nextlyhq/blocks-react";
import {
  BlockEnvironmentProvider,
  type BlockEnvironment,
} from "@nextlyhq/blocks-react/environment";
import { useIsomorphicLayoutEffect } from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  revealedForCanvas,
  type AppliedConditions,
} from "./applied-conditions";
import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import type { CanvasDragHandlers, CanvasDragState } from "./canvas-drag";
import { useCanvasFrame } from "./canvas-frame-context";
import { guardCanvasNavigation } from "./canvas-link-guard";
import {
  CANVAS_REGION_CLASS,
  CanvasRegionFrame,
  type CanvasRegion,
} from "./canvas-regions";
import {
  asStoredDefinitions,
  gatedAsDrawn,
  gatedAsStored,
} from "./condition-gate";
import { withConditionHiddenBlock } from "./condition-hidden-block";
import { isElement } from "./dom-kind";
import { refusalWording } from "./drag-refusal";
import {
  useAppliedDrawing,
  useEntryContentDrawing,
} from "./entry-content-canvas";
import {
  canvasContentRect,
  canvasScroller,
  overlaySpaceOf,
  scrollEventTarget,
  visibleBandOf,
} from "./geometry-dom";
import { useHoveredBlockSetter } from "./hovered-block";
import { lockRefusalWording } from "./lock-refusal";
import { isLocked } from "./locking";
import { useNearestThemeMarker } from "./nearest-theme";
import {
  entryContentLabel,
  usePreviewedCollection,
  type PreviewedCollection,
} from "./previewed-entry";
import { RefusalNotice } from "./refusal-notice";
import { nodeElements } from "./rendered-nodes";
import { observeRenderedTree } from "./rendered-tree";
import { selectionModeFor, type SelectionMode } from "./selection";
import { CANVAS_ROOT_CLASS } from "./shell-state";
import { alphaOf, computedAlphaOf, isDarkGround } from "./site-ground";

/**
 * The class marking the canvas root, and the boundary the hit-test stops at.
 *
 * Declared in `shell-state.ts` beside the other markers `builder-chrome.css`
 * spells out literally, and re-exported here because this is where a reader
 * looks for the canvas's own marker. See {@link nodeIdFromEvent} for the walk
 * that needs it as an upper bound.
 */
export { CANVAS_ROOT_CLASS };

/**
 * Marks the selected block's own element.
 *
 * Boolean by presence rather than carrying the id: the element already states
 * its id through `NODE_ID_ATTRIBUTE`, and repeating it here would be a second
 * copy that a partial re-mark could leave disagreeing with the first.
 *
 * Exported because a host styling the canvas, and a test asserting what is
 * selected, both need to name it — and a string typed twice is a contract with
 * no compiler behind it.
 */
export const SELECTED_ATTRIBUTE = "data-nx-selected";

/**
 * Marks a node the drag engine will refuse to pick up.
 *
 * Drawn so the grab cursor can be withheld from it. With no drag handle, that
 * cursor is the only thing advertising a block as movable, so offering it on a
 * node `useCanvasDrag` returns early for leaves an author pressing repeatedly
 * at something that will never move — an affordance promising what the engine
 * has already decided against.
 */
export const LOCKED_ATTRIBUTE = "data-nx-locked";

/** How a block is locked in Layers: by its own lock, or by one around it. */
export type LockMark = "own" | "inherited";

/**
 * Every locked block's mark, from one walk: a block's own lock, else the lock
 * of a block it sits inside, carried down rather than climbed per block.
 */
export function lockMarksOf(document: BlockDocument): Map<string, LockMark> {
  const marks = new Map<string, LockMark>();
  walkNodes(document.nodes, (node, parent) => {
    if (isLocked(node)) marks.set(node.id, "own");
    else if (parent !== undefined && marks.has(parent.id)) {
      marks.set(node.id, "inherited");
    }
  });
  return marks;
}

/**
 * Marks a block whose visibility conditions decide who sees it. The canvas
 * draws it whoever the page would show it to, so the author can see and
 * select it, and this says it isn't shown to everyone: `conditional`, or
 * `unchecked` for one whose conditions the page can't check, which visitors
 * never see.
 */
export const CONDITIONED_ATTRIBUTE = "data-nx-conditioned";

/**
 * Marks an element whose condition mark is its own block's, a block of a
 * placed component's definition, rather than its placement's: the marks
 * badge each such block apart, where a placement's roots share one badge.
 * Its value names the placement nested in a component whose gate the block
 * carries, when that gate is all it carries, so that placement's roots share
 * one badge too; empty for a block's own conditions.
 */
export const CONDITIONED_OWN_ATTRIBUTE = "data-nx-conditioned-own";

/**
 * How a conditioned block is marked on the canvas: conditional, or conditions
 * the page can't check, or, while conditions are applied, shown for the
 * previewed entry.
 */
type ConditionMark = "conditional" | "unchecked" | "shown";

/**
 * Every conditioned block's mark, and for a composed block gated only by a
 * placement nested in a component, which placement: the badge its roots
 * share.
 */
interface ConditionMarks {
  readonly marks: ReadonlyMap<string, ConditionMark>;
  readonly nested: ReadonlyMap<string, string>;
}

/**
 * Every conditioned block's mark, from one walk, asked of the engine's own
 * gate so the canvas marks exactly the blocks the page judges. `unchecked`
 * names the blocks whose conditions the page can't check, which only a host
 * knowing the collections' fields can say.
 */
function conditionMarksOf(
  document: BlockDocument,
  unchecked: ReadonlySet<string> | undefined,
  composed: { definitions?: DefinitionsById; limits?: DocumentLimits },
  applied?: AppliedConditions
): ConditionMarks {
  const marks = new Map<string, ConditionMark>();
  const nested = new Map<string, string>();
  const markIf = (node: BlockNode, gated: boolean): void => {
    if (marks.has(node.id) || !gated) return;
    marks.set(
      node.id,
      unchecked?.has(node.id) === true ? "unchecked" : "conditional"
    );
  };
  const bound = {
    maxNodes: composed.limits?.maxNodes ?? DEFAULT_LIMITS.maxNodes,
  };
  // The page's own blocks, a placement among them, by their ids, which are
  // the addresses the canvas draws them with.
  walkNodes(document.nodes, node => markIf(node, gatedAsStored(node)), bound);
  // And the blocks a placed component's definition holds, by the ids the
  // composed tree gives them, which the canvas draws them with: composed as
  // the renderer composes, each conditioned placement expanded too. The
  // page's own conditions are lifted first, as the canvas draws the page, so
  // what a composed block carries is its definition's: its own conditions,
  // and the gates of the placements nested inside a component that were
  // expanded into it, which only the composed tree still holds.
  if (composed.definitions !== undefined && composed.definitions.size > 0) {
    // Under the limits the canvas renders with, so a page the site allows
    // past the default is composed here as it is drawn, from the definitions
    // as the renderer reads them.
    const tree = resolveComponentInstances(
      revealConditioned(document),
      asStoredDefinitions(composed.definitions, composed.limits),
      {
        conditioned: "carry",
        ...(composed.limits === undefined ? {} : { limits: composed.limits }),
      }
    ).document;
    const placements = new Map<string, string>();
    walkNodes(
      tree.nodes,
      node => {
        markIf(node, gatedAsDrawn(node));
        const placement = nestedPlacementOf(node);
        if (placement === undefined) return;
        // The innermost placement's gate is the first a root carries, the
        // same for each of its roots, so they share one badge.
        let group = placements.get(placement);
        if (group === undefined) {
          group = `p${String(placements.size + 1)}`;
          placements.set(placement, group);
        }
        nested.set(node.id, group);
      },
      bound
    );
  }
  // While conditions are applied, a judged block a visitor would see says so,
  // and one they would not is drawn as its marker, which says so itself.
  if (applied !== undefined) {
    for (const id of applied.shown) marks.set(id, "shown");
    for (const block of applied.hidden) marks.delete(block.id);
  }
  return { marks, nested };
}

/**
 * The gate of the innermost placement nested in a component that a composed
 * block is a root of, as text, when that gate, and not conditions of its own,
 * is what gates it.
 */
function nestedPlacementOf(node: BlockNode): string | undefined {
  if (gatedAsStored(node) || !isPlainRecord(node.visibility)) return undefined;
  const gates = placementGatesOf(node.visibility);
  return gates.length === 0 ? undefined : JSON.stringify(gates[0]);
}

/**
 * The definitions a page reaches, the components it places and those they
 * place, with each one's conditions lifted so the canvas draws its
 * conditioned blocks; every other definition as it is. The reached ones are
 * those the resolver reads composing the page as the canvas does, so a
 * component a variant or an override selects, at any depth and through any
 * setting a placement rewrites, is lifted exactly when it is drawn. Only
 * those are walked, so a large component library costs nothing on a page
 * that places none of it.
 *
 * Exported so a surface that reads the page as the canvas draws it composes
 * it from these same definitions.
 *
 * @experimental
 */
export function revealedDefinitions(
  document: BlockDocument,
  definitions: DefinitionsById,
  limits: DocumentLimits | undefined
): DefinitionsById {
  const reached = new Set(
    resolveComponentInstances(document, definitions, {
      conditioned: "carry",
      ...(limits === undefined ? {} : { limits }),
    }).referenced
  );
  if (reached.size === 0) return definitions;
  const next = new Map(definitions);
  for (const id of reached) {
    const definition = definitions.get(id);
    if (definition !== undefined) next.set(id, revealConditioned(definition));
  }
  return next;
}

/**
 * Marks an Entry content block, with the words its at-rest mark's tab reads:
 * "Entry content · Body". The block draws the entry's own content rather
 * than the template's, which is edited on the entry, so the canvas says so
 * whether or not it is selected.
 */
export const ENTRY_CONTENT_ATTRIBUTE = "data-nx-entry-content";

/**
 * Every Entry content block's words, by its id, from one walk: the field it
 * draws named as the template's collection names it.
 */
function entryContentMarksOf(
  document: BlockDocument,
  collection: PreviewedCollection | undefined,
  maxNodes: number | undefined
): Map<string, string> {
  const marks = new Map<string, string>();
  for (const { node } of entryContentPlacements(
    document.nodes,
    maxNodes ?? DEFAULT_LIMITS.maxNodes
  )) {
    marks.set(
      node.id,
      entryContentLabel(entryContentFieldOf(node), collection)
    );
  }
  return marks;
}

/**
 * The words an Entry content block's outermost element carries, by its
 * address. Never inside a Layout region, a document of its own whose ids
 * may repeat the page's.
 */
function entryContentMarkFor(
  element: Element,
  container: HTMLElement,
  marks: ReadonlyMap<string, string>
): string | undefined {
  if (marks.size === 0) return undefined;
  const address = nodeAddressOf(element);
  if (address === null) return undefined;
  if (element.closest(`.${CANVAS_REGION_CLASS}`) !== null) return undefined;
  return isOutermostForAddress(element, address, container)
    ? marks.get(address)
    : undefined;
}

/**
 * Marks the drawn element of each of the entry's own blocks this canvas draws
 * in Entry content as ours to make `inert`. Its value says whether the `inert`
 * is ours to give back ({@link INERT_ADDED}) or was the block's own before the
 * canvas marked it ({@link INERT_KEPT}).
 */
export const ENTRY_CONTENT_INERT_ATTRIBUTE = "data-nx-entry-content-inert";

/** The canvas made the element inert, and takes that back when it leaves. */
const INERT_ADDED = "added";

/** The element was inert already, by its own block, and stays so. */
const INERT_KEPT = "kept";

/**
 * Each canvas's observer of who owns its marked elements' `inert`, by
 * container, so a marking pass reads what it has not delivered yet first.
 */
const inertOwnership = new WeakMap<HTMLElement, MutationObserver>();

/**
 * Watch whose `inert` each element marked in Entry content holds, as its block
 * changes its own after the canvas marked it. Returns the unsubscribe.
 *
 * A block that starts rendering inert on an element the canvas already made
 * inert changes nothing the tree shows, so only the mutation tells: React's
 * `setAttribute` on a present attribute still queues a record, with the old
 * value. The canvas writes `inert` only where it is absent, so a record with an
 * old value that leaves the attribute present is the block's write, and the
 * element's inert is now its own. One that leaves it absent is the block
 * dropping its inert, and the canvas holds the element inert in its place.
 */
export function observeEntryContentInertOwnership(
  container: HTMLElement
): () => void {
  // From the container's own window, as the rendered tree's observer is.
  const Mutations = container.ownerDocument.defaultView?.MutationObserver;
  if (typeof Mutations !== "function") return () => undefined;
  const observer = new Mutations(records =>
    readInertOwnership(container, records)
  );
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["inert"],
    attributeOldValue: true,
    subtree: true,
  });
  inertOwnership.set(container, observer);
  return () => {
    readInertOwnership(container, observer.takeRecords());
    observer.disconnect();
    if (inertOwnership.get(container) === observer) {
      inertOwnership.delete(container);
    }
  };
}

function readInertOwnership(
  container: HTMLElement,
  records: readonly MutationRecord[]
): void {
  const marked = new Set<Element>();
  records.forEach((record, index) => {
    // An attribute record's target is always an element.
    const element = record.target as Element;
    if (
      !element.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE) ||
      !ownedByCanvas(element, container)
    ) {
      return;
    }
    marked.add(element);
    // Absent before: an add, which is how the canvas writes it.
    if (record.oldValue === null) return;
    // What this write left: the next record's old value, or the tree now.
    const next = records
      .slice(index + 1)
      .find(later => later.target === element);
    const present =
      next === undefined
        ? element.hasAttribute("inert")
        : next.oldValue !== null;
    if (present) setMark(element, ENTRY_CONTENT_INERT_ATTRIBUTE, INERT_KEPT);
  });
  marked.forEach(holdEntryContentInert);
}

/**
 * Make a marked element inert where it is not. Not inert now, the inert it
 * gets is the canvas's to give back, also where its block had one and dropped
 * it: left `kept`, it would stay inert once no longer drawn in Entry content.
 */
function holdEntryContentInert(element: Element): void {
  if (element.hasAttribute("inert")) return;
  setMark(element, ENTRY_CONTENT_INERT_ATTRIBUTE, INERT_ADDED);
  element.setAttribute("inert", "");
}

/**
 * Make the entry's blocks an Entry content block draws on this canvas inert,
 * and nothing else: each child of a drawn wrapper, so no link, field or button
 * inside takes focus, a caret or a press, while the wrapper, the block's own
 * element, stays the one a click lands on and selects. The page's markup is
 * not changed, so the canvas lays the blocks out as the published page does.
 * An element no longer drawn there gives back the inert this set, and only
 * that: one a block rendered inert itself (a custom block whose root is inert)
 * keeps its `inert` when it leaves, as the canvas frame keeps a site's own.
 * Written only where it changes, as every mark here is.
 */
export function markEntryContentInert(container: HTMLElement): void {
  // A block's write to its inert this commit, before this pass gives any back.
  const pending = inertOwnership.get(container);
  if (pending !== undefined) {
    readInertOwnership(container, pending.takeRecords());
  }
  const wanted = new Set<Element>();
  container
    .querySelectorAll(`[${ENTRY_CONTENT_DRAWN_ATTRIBUTE}]`)
    .forEach(wrapper => {
      if (!ownedByCanvas(wrapper, container)) return;
      for (const child of Array.from(wrapper.children)) wanted.add(child);
    });
  container
    .querySelectorAll(`[${ENTRY_CONTENT_INERT_ATTRIBUTE}]`)
    .forEach(element => {
      // Another canvas's marks are that canvas's to clear, as they were its
      // to set: a canvas drawn inside this one (a component's own view) keeps
      // its entry's blocks inert whatever this one re-marks.
      if (wanted.has(element) || !ownedByCanvas(element, container)) return;
      const ours =
        element.getAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE) !== INERT_KEPT;
      element.removeAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE);
      if (ours) element.removeAttribute("inert");
    });
  wanted.forEach(element => {
    // Whether the inert was the block's own is read when the canvas first
    // marks the element, before it adds any; after that, its block changing
    // it is read by `observeEntryContentInertOwnership` and the hold below.
    if (!element.hasAttribute(ENTRY_CONTENT_INERT_ATTRIBUTE)) {
      element.setAttribute(
        ENTRY_CONTENT_INERT_ATTRIBUTE,
        element.hasAttribute("inert") ? INERT_KEPT : INERT_ADDED
      );
    }
    holdEntryContentInert(element);
  });
}

/**
 * The mark a drawn element carries: a definition's own conditioned block by
 * its composed id, else the block or placement it is the outermost element
 * of, by its address. Never inside a Layout region, a document of its own
 * whose ids may repeat the page's.
 */
function conditionMarkFor(
  element: Element,
  container: HTMLElement,
  { marks, nested }: ConditionMarks
): { mark: ConditionMark; own: boolean; nested?: string } | undefined {
  const address = nodeAddressOf(element);
  if (address === null) return undefined;
  if (element.closest(`.${CANVAS_REGION_CLASS}`) !== null) return undefined;
  const id = element.getAttribute(NODE_ID_ATTRIBUTE);
  const own = id !== null && id !== address ? marks.get(id) : undefined;
  const placed = isOutermostForAddress(element, address, container)
    ? marks.get(address)
    : undefined;
  if (own === undefined) {
    return placed === undefined ? undefined : { mark: placed, own: false };
  }
  // A block with conditions of its own that is also the root of a
  // conditioned placement is drawn only when both hold, so its one badge says
  // "Can't be checked" when either can't be.
  const placement = id === null ? undefined : nested.get(id);
  return {
    mark: placed === "unchecked" ? "unchecked" : own,
    own: true,
    ...(placement === undefined ? {} : { nested: placement }),
  };
}

/**
 * Marks every element drawing the block currently being dragged.
 *
 * EVERY element rather than one: a node id is unique in a document and not in
 * the tree drawn from it, so a repeating block is many elements for one id and
 * a mark that stopped at the first would dim one copy of a block that is
 * wholly in flight.
 *
 * Boolean by presence, for the reason {@link SELECTED_ATTRIBUTE} is: the
 * element already states its id.
 */
export const DRAG_SOURCE_ATTRIBUTE = "data-nx-drag-source";

/**
 * Marks the container a drop would land in.
 *
 * The line says WHERE among siblings; this says WHICH container, and the two
 * are different questions. They come apart exactly where the line alone is
 * ambiguous — the coordinate at the bottom edge of one container is also the
 * top edge of the next, and only this mark separates them.
 */
export const DROP_PARENT_ATTRIBUTE = "data-nx-drop-parent";

/**
 * Marks the container that will not take the block being dragged.
 *
 * Mutually exclusive with {@link DROP_PARENT_ATTRIBUTE} by construction: the
 * engine answers with a target or a refusal, never both, so an element carrying
 * the two at once is drawing a state that cannot exist.
 */
export const DROP_REFUSED_ATTRIBUTE = "data-nx-drop-refused";

// Defined in its own module so the region frames drawn inside the canvas can
// mark themselves as chrome without importing the canvas back.
export { CHROME_ATTRIBUTE } from "./canvas-chrome";

/**
 * The site tokens the canvas page is drawn from, by IDENTITY as the default
 * token set declares them, mapped to the custom property the stylesheet reads
 * each from, with the value it falls back to where the token is undeclared.
 *
 * Set inline on the canvas root because the property each points at depends on
 * the prefix the site's tokens are emitted under, which only the site sheet
 * knows. An identity rather than a display name, so a site that renamed a
 * token still resolves: the property is built from the identity. The
 * fallbacks are the browser's own defaults, which is what a published page
 * shows where nothing paints.
 */
const SITE_SURFACE_TOKENS = [
  ["--nx-canvas-site-font", "font.body", "system-ui"],
  ["--nx-canvas-site-ground", "color.background", "Canvas"],
  ["--nx-canvas-site-ink", "color.text", "CanvasText"],
] as const;

/** The token the page's ground is drawn from, by identity. */
const SITE_GROUND_TOKEN = "color.background";

/** What the canvas root needs from the site sheet to draw the page as the site. */
interface SiteSurface {
  /** The custom properties naming the site's tokens, under its prefix. */
  readonly style: Record<`--${string}`, string>;
  /** Whether the site's background token has a DARK value. */
  readonly darkGround: boolean;
  /** Whether every value of the site's background token is fully opaque. */
  readonly opaqueGround: boolean;
}

/**
 * The site's own surface tokens, as the canvas root carries them, or undefined
 * when the host serves no site sheet.
 *
 * The prefix is the one the renderer compiles the sheet under:
 * `sharedStyleInputs` reconciles the site's own prefixes with the route
 * context's, exactly as `PageRenderer` does before emitting the sheet, and
 * `resolveTokenPrefix` gives what is actually written. The token set is the
 * one the sheet emits — the site's own layered over the defaults by
 * `resolveSiteTokens` — so whether the ground has a dark value is asked of the
 * same tokens the page draws with.
 *
 * The site sheet applies dark values with the device (or a dark marker), for
 * every site. The scheme goes dark only where those values include a dark
 * ground, so a site whose dark set leaves the background light keeps a light
 * page and light native controls.
 */
function siteSurface(
  render: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>
): SiteSurface | undefined {
  if (typeof siteStyles !== "object") return undefined;
  const stated = sharedStyleInputs(
    render?.styleContext,
    siteStyles
  ).tokenPrefix;
  const { prefix } = resolveTokenPrefix(stated ?? undefined);
  const style: Record<`--${string}`, string> = {};
  for (const [property, token, fallback] of SITE_SURFACE_TOKENS) {
    style[property] = `var(${tokenCustomProperty(token, prefix)}, ${fallback})`;
  }
  const tokens = resolveSiteTokens(siteStyles.tokens);
  const values = tokens.tokens.find(
    token => tokenIdentity(token) === SITE_GROUND_TOKEN
  )?.values;
  const ground = values?.dark;
  return {
    style,
    darkGround: ground !== undefined && isDarkGround(ground),
    opaqueGround:
      values !== undefined &&
      [values.light, values.dark].every(
        value => value === undefined || alphaOf(value.trim()) === 1
      ),
  };
}

/**
 * The block a context gesture is aimed at, or `null` when it is aimed at
 * nothing a block menu could act on.
 *
 * Published because a context menu can be opened TWO ways and they arrive by
 * different events. A secondary click arrives as `contextmenu`, which the
 * canvas sees; a touch or pen long-press is opened by Radix from its own timer
 * on `pointerdown`, and never produces a `contextmenu` event at all. A menu
 * that filtered one path and not the other would offer a block's verbs for a
 * press aimed at chrome, or — worse — offer the PREVIOUS selection's verbs,
 * with Delete among them, for a press on a block that was never selected.
 *
 * So the decision lives here once and both callers ask it, rather than each
 * spelling out three rejections and drifting.
 */
export function contextMenuTargetOf(
  target: EventTarget | null,
  root: Element
): string | null {
  if (isEditableTarget(target) || isChrome(target)) return null;
  // By node kind rather than `instanceof Element`: a press inside a canvas
  // mounted in an iframe targets an element that window built.
  if (!isElement(target)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  /*
   * Owned by THIS canvas, not merely by A canvas.
   *
   * `nodeIdFromEvent` asks the weaker question — its own comment claims this
   * one, and it checks only that some canvas is an ancestor. That is enough
   * for selection, where a foreign id is ignored and nothing happens. It is
   * not enough here: a canvas rendered inside a block of another canvas sends
   * its events up through the outer one, which would then let a menu open
   * while the outer selection stayed where it was — and its verbs would act on
   * a block nobody was pointing at.
   */
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) !== root) return null;
  // The same address the click path resolves. Returning the raw attribute here
  // hands the menu a re-minted id the stored document does not contain, so
  // `applySelection` keeps the PREVIOUS selection — and a destructive verb then
  // acts on a block nobody pointed at.
  return nodeAddressOf(owner);
}

/**
 * Whether the gesture landed in text the author is editing.
 *
 * Asked apart from {@link isChrome} because the answer is the same and the
 * reason is not: chrome is not the page, while this IS the page and is being
 * typed into. The browser's own menu carries spelling, selection and clipboard
 * for a caret, and none of that has a replacement here — taking it away mid
 * sentence to offer "Move up" is a straight loss.
 *
 * `contenteditable="false"` is excluded explicitly: it marks a region the
 * editor has deliberately made uneditable INSIDE an editable one, which is a
 * block again rather than text.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  const editable = target.closest("[contenteditable]");
  return (
    editable !== null && editable.getAttribute("contenteditable") !== "false"
  );
}

function isChrome(target: EventTarget | null): boolean {
  return isElement(target) && target.closest(`[${CHROME_ATTRIBUTE}]`) !== null;
}

/** How long a list note's Copy ref says "Copied" once pressed. */
const COPIED_FOR_MS = 2000;

/**
 * A list note's Copy ref, when a press landed on it: the log reference it
 * names goes to the clipboard, and the button says so for a moment. Answers
 * whether it was one, so the press does nothing else.
 */
function copyNoteReference(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  const button = target.closest(`[${LIST_ACTION_ATTRIBUTE}="copy-ref"]`);
  const ref = button?.getAttribute(LIST_REF_ATTRIBUTE);
  if (
    button === null ||
    button === undefined ||
    ref === null ||
    ref === undefined
  ) {
    return false;
  }
  // The editor's own clipboard, not the canvas frame's: a frame may not be
  // allowed to write to it.
  const clipboard: Clipboard | undefined =
    typeof navigator === "undefined" ? undefined : navigator.clipboard;
  void clipboard?.writeText(ref).then(
    () => {
      button.setAttribute("data-nx-list-copied", "");
      setTimeout(
        () => button.removeAttribute("data-nx-list-copied"),
        COPIED_FOR_MS
      );
    },
    // A clipboard the page may not write to leaves the reference selectable
    // in the note, where it is set apart to be copied by hand.
    () => undefined
  );
  return true;
}

/** The action a list's note offers, when a press landed on it. */
function listActionOf(target: EventTarget | null): string | null {
  if (!isElement(target)) return null;
  return (
    target
      .closest(`[${LIST_ACTION_ATTRIBUTE}]`)
      ?.getAttribute(LIST_ACTION_ATTRIBUTE) ?? null
  );
}

/**
 * How a pointer event on the canvas resolves to a node id, or to nothing.
 *
 * `closest` rather than reading the target directly: a click lands on whatever
 * leaf is under the pointer — a `<span>` inside a heading, an `<img>` inside a
 * card — and the node that owns it is an ancestor. Reading the target alone
 * selects nothing for every block that renders more than one element, which is
 * most of them.
 *
 * The attribute name comes from `@nextlyhq/blocks-react` rather than being
 * spelled here. The renderer writes it and this reads it, so two spellings
 * would be two declarations of one name, and the day it moves the hit-testing
 * would resolve nothing while every test that hard-coded it still passed.
 *
 * **Bounded at the canvas root, which is not a detail.** The renderer applies
 * the attribute by cloning the block's root element and returns the output
 * untouched when it is not a single host element — so a block rendering a
 * fragment or a component carries none. An unbounded `closest` then walks past
 * it to the nearest ANCESTOR that has one, and returns that node's id: a
 * confidently WRONG selection rather than a missing one.
 *
 * The two failures are not equally bad. A miss is visible immediately — the
 * author clicks and nothing happens. A wrong hit selects a container while the
 * author believes they selected the child inside it, and every edit afterwards
 * lands on the wrong node with nothing to indicate it.
 */
export function nodeIdFromEvent(target: EventTarget | null): string | null {
  // Any realm's element, for the reason `contextMenuTargetOf` gives.
  if (!isElement(target)) return null;
  const owner = target.closest(`[${NODE_ID_ATTRIBUTE}]`);
  if (owner === null) return null;
  // Inside THIS canvas, not merely inside something carrying the attribute. A
  // canvas rendered within another rendered page would otherwise resolve a
  // click to the outer page's node.
  if (owner.closest(`.${CANVAS_ROOT_CLASS}`) === null) return null;
  return nodeAddressOf(owner);
}

/**
 * Which node an element stands for, once components are inlined.
 *
 * EXPORTED because it is the one rule, and every reader of the element-to-node
 * mapping has to use it. Slice one of this work updated the click path and the
 * geometry lookup and left three other readers on the raw attribute — the
 * context menu, the selection markers and the drag rectangles — which is how a
 * right-click came to act on the previously selected block.
 *
 * A component is inlined at render: the instance node is replaced by the tree
 * its definition describes, and every element of that tree carries a RE-MINTED
 * id the page's document does not contain. Returning that id hands the editor
 * an address it cannot select, edit or delete — so a definition-owned element
 * answers with the INSTANCE the author actually placed, which is a real node in
 * the page.
 *
 * ## Asked of the ELEMENT, never of its ancestors
 *
 * `owner.closest(\`[${"$"}{INSTANCE_ATTRIBUTE}]\`)` is the obvious implementation and
 * it is wrong. An instance's SLOT CONTENT belongs to the page and is
 * deliberately unmarked, but it renders NESTED INSIDE the definition's marked
 * box — so a walk upwards finds that box and answers with the component for a
 * node the author can and should select directly. That content is exactly what
 * a marketer opened the editor to change.
 *
 * The marker is per-node rather than a wrapper element precisely so this
 * question can be asked without walking, and `hasAttribute` is what asks it:
 * marked means definition-owned, unmarked means the page's own whatever
 * encloses it.
 */
export function nodeAddressOf(owner: Element): string | null {
  const instance = owner.getAttribute(INSTANCE_ATTRIBUTE);
  // Present AND non-empty. The renderer never emits an empty one — it treats
  // that as no provenance — but an address of "" is not selectable, so reading
  // it as page-owned is the answer that leaves the element addressable by its
  // own id.
  if (instance !== null && instance !== "") return instance;
  return owner.getAttribute(NODE_ID_ATTRIBUTE);
}

/**
 * Whether this element is the OUTERMOST one standing for its address.
 *
 * Two different things put one address on several elements, and they need
 * opposite answers:
 *
 * - A node rendered more than once — a block that draws its child twice — puts
 *   the same node id on SIBLING elements. Every copy is a rendering of that
 *   node, and marking only one outlines a single row of ten while previewing a
 *   state on another. Neither copy encloses the other, so both are outermost.
 * - A component instance puts one address on every element its definition
 *   contributed, NESTED. Those are renderings of different definition nodes
 *   that share a host, so marking all of them outlines everything inside the
 *   component and measuring all of them keys the drag geometry to whichever was
 *   visited last.
 *
 * Enclosure is what separates them, so enclosure is what this asks. The host
 * marker is contiguous over a subtree, so the nearest enclosing one carrying
 * the same value is the whole test — no walk to the root is needed.
 */
export function isOutermostForAddress(
  element: Element,
  address: string,
  container: HTMLElement
): boolean {
  const host = element.parentElement?.closest(`[${INSTANCE_ATTRIBUTE}]`);
  if (host === null || host === undefined) return true;
  // Bounded by the canvas that owns the element. A canvas can render inside a
  // definition-owned element — component edit mode does — and ids are scoped
  // per document, so the inner document may reuse the enclosing instance's
  // address. An unbounded search then finds the OUTER document's marker,
  // classifies the inner component as nested inside itself, and leaves it with
  // no outline and no rectangle for a drag.
  if (!ownedByCanvas(host, container)) return true;
  return host.getAttribute(INSTANCE_ATTRIBUTE) !== address;
}

/**
 * Every element standing for each of `addresses` on this canvas: the
 * outermost per address, in document order. What a toolbar or a gap measures a
 * block by, so that a component placement whose definition draws several
 * top-level elements is measured as all of them rather than as its first.
 * Only this canvas's own: a canvas nested inside a block (component edit
 * mode) scopes ids to its own document, which may reuse an address from out
 * here.
 */
export function outermostElementsOf(
  root: HTMLElement,
  addresses: ReadonlySet<string>
): Map<string, Element[]> {
  const drawn = new Map<string, Element[]>();
  for (const element of nodeElements(root)) {
    if (!ownedByCanvas(element, root)) continue;
    const address = nodeAddressOf(element);
    if (address === null || !addresses.has(address)) continue;
    if (!isOutermostForAddress(element, address, root)) continue;
    const elements = drawn.get(address) ?? [];
    elements.push(element);
    drawn.set(address, elements);
  }
  return drawn;
}

/**
 * The element a node id was rendered as, or `null` when it is not on screen.
 *
 * The inverse of {@link nodeIdFromEvent}, and beside it because the two are one
 * mapping read in two directions — separated, they become two answers to what a
 * node id means in the DOM.
 *
 * Ids are COMPARED rather than interpolated into a selector. A node id reaches
 * here from stored data, so any character CSS treats specially makes
 * `querySelector` either throw or match something else entirely.
 *
 * Deliberately not the {@link SELECTED_ATTRIBUTE} marker. That marker is applied
 * in a passive effect, so on the render where the selection changes it is still
 * on the previously selected element, and any chrome measuring in a layout
 * effect would spend a frame measuring the wrong block.
 */
export function nodeElement(root: HTMLElement, id: string): Element | null {
  let own: Element | null = null;
  let hosted: Element | null = null;
  // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
  // that declares its iterator, and this package compiles without one.
  root.querySelectorAll(`[${NODE_ID_ATTRIBUTE}]`).forEach(element => {
    if (own === null && element.getAttribute(NODE_ID_ATTRIBUTE) === id) {
      own = element;
    }
    // An INSTANCE id addresses a node that renders no element of its own: it
    // was replaced by the definition's tree. The first element that tree
    // contributed is what a caller measuring the selection needs, and document
    // order makes that the outermost one.
    if (hosted === null && element.getAttribute(INSTANCE_ATTRIBUTE) === id) {
      hosted = element;
    }
  });
  // The node's OWN element wins where both exist. They cannot today — an
  // instance is replaced rather than rendered — but the precedence states which
  // answer is the node's rather than leaving it to iteration order.
  return own ?? hosted;
}

/**
 * Mark the selected elements on the rendered tree.
 *
 * Applied AFTER the renderer has produced them, rather than asked of
 * `PageRenderer`. Which node an editor considers current is an editor's
 * concern, and a published route renders the same document without one —
 * pushing it into the renderer's contract would put editor state in the
 * component that serves live pages.
 *
 * Ids are COMPARED in JavaScript rather than matched with a selector built from
 * one. A node id reaches this from stored data, and interpolating it into
 * `querySelector` makes any character CSS treats specially either throw or,
 * worse, match something else.
 *
 * `page` is a dependency because the rendered tree is what carries the markers:
 * a re-render replaces the elements, and an effect keyed on the selection alone
 * would leave the new tree carrying none at all.
 */
function useCanvasMarkers(
  box: React.RefObject<HTMLElement | null>,
  marked: readonly string[],
  selectedId: string | null,
  page: React.ReactNode,
  forcedState: StyleState | undefined,
  drag: CanvasDragState | undefined,
  lockedIds: ReadonlyMap<string, LockMark>,
  conditionMarks: ConditionMarks,
  entryContentMarks: ReadonlyMap<string, string>
): void {
  /*
   * The drag's three marks are read into plain ids here rather than inside the
   * walk, so the effect depends on the VALUES that change the answer instead of
   * on the drag object's identity. `useCanvasDrag` returns a fresh object on
   * every pointer move, and an effect keyed on it would re-walk the whole tree
   * per frame while writing nothing new.
   */
  const sourceId = drag?.draggingId ?? null;
  const parentId = drag?.target?.at.parentId ?? null;
  const refusedId = drawnRefusal(drag)?.parentId ?? null;
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    /*
     * NAMED and re-run rather than written straight into the effect, because
     * the dependency list is not the only thing that changes the answer.
     *
     * A block whose `render` returns a promise commits its Suspense fallback
     * first and its resolved root later. That second commit inserts the element
     * carrying the node id while changing no prop, no state and no id in this
     * list — so an effect that ran once would have marked a tree the resolved
     * block was not in yet, and would leave it unmarked until an unrelated
     * selection or document change happened to run this again. Selecting a
     * `core/collection-loop` showed exactly that: no outline and no forced
     * state, on an ordinary shipping block.
     */
    const mark = (): void => {
      /*
       * Every element a marker can land on OR currently carries one, which are
       * not the same set. A render can move a node id from one existing element
       * to another without touching the child list — the attribute case this
       * effect subscribes to — and the element that LOST the id then matches
       * nothing selected by node id. Left out, it keeps the selection attribute
       * and the state class it was last given: a second outline around a block
       * nothing is editing, and a hover appearance forced on it.
       *
       * The rendered PAGE ROOT is named explicitly rather than reached by one
       * of the marker selectors: `PageRenderer` draws `.nx-pb-page` as a child
       * of this container and the page tier compiles onto that element rather
       * than onto the canvas wrapper, so it must be markable before it has ever
       * been marked.
       */
      const touched = new Set<Element>([container]);
      // `forEach` rather than `for…of`: a `NodeList` is only iterable under a lib
      // that declares its iterator, and this package compiles without one — so the
      // loop that reads more naturally does not type-check here.
      container
        .querySelectorAll(
          [
            `.${PAGE_ROOT_CLASS}`,
            `[${NODE_ID_ATTRIBUTE}]`,
            `[${SELECTED_ATTRIBUTE}]`,
            // The drag marks belong here for the reason the selection attribute
            // does, and the case is the same one: an element that LOSES its node
            // id matches nothing selected by node id, so leaving these out
            // strands whatever they were last given. A block that stopped being
            // the drag source would stay dimmed with nothing left to clear it.
            `[${DRAG_SOURCE_ATTRIBUTE}]`,
            `[${DROP_PARENT_ATTRIBUTE}]`,
            `[${DROP_REFUSED_ATTRIBUTE}]`,
            `[${LOCKED_ATTRIBUTE}]`,
            `[${CONDITIONED_ATTRIBUTE}]`,
            `[${CONDITIONED_OWN_ATTRIBUTE}]`,
            `[${ENTRY_CONTENT_ATTRIBUTE}]`,
            ...STYLE_STATES.map(state => `.${previewStateClass(state)}`),
          ].join(", ")
        )
        .forEach(element => touched.add(element));

      touched.forEach(element => {
        // Another canvas's elements are that canvas's to mark, exactly as the
        // drag pass below leaves them. Ids are scoped per document, so a nested
        // canvas can hold an instance with the SAME address as the one selected
        // out here — and marking it would outline a block belonging to a
        // document this selection is not in.
        if (!ownedByCanvas(element, container)) return;
        // The ADDRESS, not the raw attribute. A definition-owned element
        // carries a re-minted id the selection never holds, so comparing the
        // attribute leaves a selected component with no outline at all.
        const id = nodeAddressOf(element);
        // OUTERMOST only, which draws one outline per instance while still
        // marking every copy of a node a block rendered more than once — see
        // `isOutermostForAddress` for why those two cases need opposite
        // answers.
        if (
          id === null ||
          !marked.includes(id) ||
          !isOutermostForAddress(element, id, container)
        ) {
          // Guarded like the writes below: this walk now visits the page root
          // and the container, which never carry the attribute, and removing an
          // absent one still touches the element.
          if (element.hasAttribute(SELECTED_ATTRIBUTE)) {
            element.removeAttribute(SELECTED_ATTRIBUTE);
          }
          return;
        }
        // The VALUE carries which member the panels answer for. A boolean
        // attribute could not, and a second attribute for the primary would be a
        // state where a block is primary without being selected.
        //
        // Compared before writing, for the reason the class below is: this walk
        // re-runs on every change to the rendered tree, and `setAttribute`
        // queues a mutation record even when the value it writes is the value
        // already there. Unguarded, marking a tree that did not change is
        // itself a change — the spacing overlay observes this subtree and
        // re-measures on one, so its own output would arrive back here as a
        // reason to write again.
        const value = id === selectedId ? "primary" : "";
        if (element.getAttribute(SELECTED_ATTRIBUTE) !== value) {
          element.setAttribute(SELECTED_ATTRIBUTE, value);
        }
      });

      /*
       * The drag's marks, in the SAME walk and over the SAME set, for the
       * reason the forced state below is: all of them answer "what is marked on
       * this element right now", and two walks over one question drift — one
       * runs on a change the other does not.
       *
       * Over `touched` rather than a fresh query, so an element that has just
       * LOST the node id is visited and cleared. Left out, a block that stopped
       * being the drag source keeps the mark and stays dimmed after the drop.
       */
      const dragMarks: ReadonlyArray<readonly [string, string | null]> = [
        [DRAG_SOURCE_ATTRIBUTE, sourceId],
        [DROP_PARENT_ATTRIBUTE, parentId],
        [DROP_REFUSED_ATTRIBUTE, refusedId],
      ];
      touched.forEach(element => {
        if (!ownedByCanvas(element, container)) return;
        const id = element.getAttribute(NODE_ID_ATTRIBUTE);
        // Whether the engine would refuse to move this node, asked from the set
        // rather than from the document per element: this walk re-runs on every
        // change to the rendered tree, and a tree search per element would make
        // that quadratic on a large page. Asked by the ADDRESS, as the selection
        // pass above is: a placement's parts carry a re-minted id the document
        // does not hold, and the lock that holds them is the placement's.
        const address = nodeAddressOf(element);
        setMark(
          element,
          LOCKED_ATTRIBUTE,
          address === null ? undefined : lockedIds.get(address)
        );
        // On the block's own outermost element, so a block a list draws once
        // per entry is marked once per copy and its parts are not marked again.
        const condition = conditionMarkFor(element, container, conditionMarks);
        setMark(element, CONDITIONED_ATTRIBUTE, condition?.mark);
        setMark(
          element,
          CONDITIONED_OWN_ATTRIBUTE,
          condition?.own === true ? (condition.nested ?? "") : undefined
        );
        // An Entry content block's words, on its outermost element alike.
        setMark(
          element,
          ENTRY_CONTENT_ATTRIBUTE,
          entryContentMarkFor(element, container, entryContentMarks)
        );
        for (const [attribute, wanted] of dragMarks) {
          setFlag(element, attribute, id !== null && id === wanted);
        }
      });

      /*
       * The forced interaction state, in the SAME walk rather than a second one.
       * Both answer "what is marked on this element right now", and two walks
       * over one question drift — one runs on a change the other does not.
       *
       * On the PRIMARY alone. A page cannot force a pseudo-class on itself, so
       * the compiler emits a class alternative beside each one and this puts it
       * on the element the panel is editing. Forcing it page-wide would show
       * every other block in a state nobody asked about.
       *
       * Cleared from everything first, including the primary: a state that
       * changes from hover to focus, or a selection that moves, must not leave
       * the previous class behind on an element nothing is editing.
       */
      /*
       * WHICH ELEMENTS a forced state belongs on, ASKED of the engine rather
       * than decided here.
       *
       * Whether a state propagates follows from the pseudo-class the compiler
       * emits for it — an ancestor matches `:hover` and `:active` and does not
       * match `:focus-visible` — so the two facts live together beside that
       * definition. Encoding the rule here as well would be a second opinion
       * about the CSS: changing `focus` to `:focus-within` would move the
       * published rules and leave this canvas marking the wrong chain, with both
       * sides type-correct.
       *
       * Where a state does propagate the chain is required rather than tidy: the
       * page tier compiles onto the RENDERED page root, and a marker on a
       * descendant cannot make its ancestor match.
       */
      const chain = new Set<Element>();
      if (forcedState !== undefined && forcedState !== "base") {
        /*
         * EVERY rendering of the primary node, not the first one found.
         *
         * A node id is unique in a DOCUMENT and not in the tree drawn from it:
         * `core/collection-loop` draws its children once per entry, so one
         * selected node is many elements, and the walk above has already marked
         * all of them primary. Taking `querySelector` here would preview the
         * state on whichever copy came first in DOM order — the outline on ten
         * rows and the hover appearance on one, which reads as the state being
         * broken rather than as the preview being partial.
         */
        container
          .querySelectorAll(`[${SELECTED_ATTRIBUTE}="primary"]`)
          .forEach(primary => {
            chain.add(primary);
            if (!statePropagatesToAncestors(forcedState)) return;
            for (
              let node: Element | null = primary.parentElement;
              node !== null && container.contains(node);
              node = node.parentElement
            ) {
              chain.add(node);
            }
          });
      }

      // The SAME set the selection was written from, so the two markers cannot
      // disagree about which elements exist.
      const marks: Element[] = Array.from(touched);

      marks.forEach(element => {
        // `base` is not a state anything forces: it is what applies when nothing
        // else does, and the compiler emits no marker for it.
        const wanted =
          chain.has(element) && forcedState !== undefined
            ? previewStateClass(forcedState)
            : undefined;

        /*
         * WRITTEN ONLY WHEN IT CHANGES, which is not a micro-optimisation.
         *
         * `classList.remove` of a token that is not present still touches the
         * attribute, and this canvas is observed: the empty-container appender
         * watches its subtree for layout-relevant mutations and re-measures on
         * one. An unconditional clear across every marked element therefore made
         * every selection change schedule a re-measure of the whole overlay,
         * which its own test caught — it asserts the control does NOT move for a
         * mutation of its own output, and it moved.
         */
        for (const state of STYLE_STATES) {
          const marker = previewStateClass(state);
          if (marker !== wanted && element.classList.contains(marker)) {
            element.classList.remove(marker);
          }
        }
        if (wanted !== undefined && !element.classList.contains(wanted)) {
          element.classList.add(wanted);
        }
      });
      // The entry's blocks drawn in Entry content: looked at, never used.
      markEntryContentInert(container);
    };

    // Before the first pass, so a block's change to an element's inert after
    // the pass marks it is seen; it writes only `inert` and the inert mark,
    // neither of which counts as the tree changing.
    const stopOwnership = observeEntryContentInertOwnership(container);
    mark();
    // Subscribed AFTER the first pass, because an observer reports what changes
    // from the moment it attaches and says nothing about the tree already
    // there. Writing the markers cannot re-enter this: what counts as the tree
    // changing excludes every attribute `mark` writes.
    const stopTree = observeRenderedTree(container, mark);
    return () => {
      stopTree();
      stopOwnership();
    };
  }, [
    box,
    selectedId,
    marked,
    page,
    forcedState,
    sourceId,
    parentId,
    refusedId,
    lockedIds,
    conditionMarks,
    entryContentMarks,
  ]);
}

/**
 * Whether this element belongs to the canvas doing the marking.
 *
 * A node id is unique within a DOCUMENT and not across documents, so a block
 * that renders a second canvas puts another document's ids inside the outer
 * walk's reach. An inner node sharing the dragged id would then be dimmed by a
 * drag it has no part in, and the refusal could anchor to it.
 */
function ownedByCanvas(element: Element, container: HTMLElement): boolean {
  if (element === container) return true;
  return element.closest(`.${CANVAS_ROOT_CLASS}`) === container;
}

/**
 * Add or remove a boolean attribute, writing only when the answer changes.
 *
 * The comparison is the point rather than a saving. `setAttribute` queues a
 * mutation record even when the value it writes is the value already there,
 * the empty-container appender observes this subtree, and a drag re-marks on
 * every pointer move — so an unguarded write is a re-measure per frame rather
 * than one per drop.
 *
 * One function rather than the same three lines at each mark: they are one
 * rule, and four copies of it are four chances for the guard to be dropped
 * from whichever copy is edited next.
 */
/**
 * Set an attribute to a value, or remove it for `undefined`, writing only when
 * it changes, for the reason {@link setFlag} gives.
 */
function setMark(
  element: Element,
  attribute: string,
  value: string | undefined
): void {
  if (element.getAttribute(attribute) === (value ?? null)) return;
  if (value === undefined) element.removeAttribute(attribute);
  else element.setAttribute(attribute, value);
}

/**
 * The marks the site's surface puts on the canvas root, written before paint:
 * the nearest theme marker above it (`useNearestThemeMarker`), and whether the
 * site's ground is fully opaque.
 *
 * Only an opaque ground is repeated on the rendered page as well as the
 * canvas: painted twice, an opaque ground looks exactly as it does once, while
 * a translucent one would darken where the layers overlap. Judged from the
 * colour the root's background RESOLVES to, because the host's own CSS can
 * set the token's property to something the token set does not say. The
 * token set's answer stands where the resolved colour says nothing: one that
 * cannot be read, or one fully transparent, which is what a root painting no
 * ground of its own resolves to (a page the site serves), and a transparent
 * ground repeated on the page paints nothing either way.
 */
function useSiteSurfaceMarks(
  rootRef: React.RefObject<HTMLElement | null>,
  opaqueByTokens: boolean
): void {
  useNearestThemeMarker(rootRef);
  const tokens = useRef(opaqueByTokens);
  tokens.current = opaqueByTokens;
  // On every render: a render is what brings new site styles.
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (root !== null) markGround(root, tokens.current);
  });
  /*
   * And on what changes the ground with no render, subscribed once for the
   * root rather than on every render:
   *
   * - the site's mode: the theme marker rewrites the root's
   *   `data-nx-site-theme` from an observer of its own, and the device's
   *   colour scheme changes on its own. A light ground and a dark one can
   *   differ in whether they are opaque;
   * - the canvas's window resizing, or the canvas itself: a site can override
   *   the ground under a width or height query, which a resized frame
   *   crosses, and under a container query, which a canvas drawn without a
   *   frame crosses as the layout around it changes.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const view = root.ownerDocument.defaultView;
    const mark = (): void => markGround(root, tokens.current);
    const Observer = view?.MutationObserver;
    const theme =
      typeof Observer === "function" ? new Observer(() => mark()) : null;
    theme?.observe(root, {
      attributes: true,
      attributeFilter: ["data-nx-site-theme"],
    });
    const scheme = view?.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", mark);
    view?.addEventListener("resize", mark);
    const Sizes = view?.ResizeObserver;
    const size = typeof Sizes === "function" ? new Sizes(() => mark()) : null;
    size?.observe(root);
    return () => {
      theme?.disconnect();
      scheme?.removeEventListener("change", mark);
      view?.removeEventListener("resize", mark);
      size?.disconnect();
    };
  }, [rootRef]);
}

/**
 * Mark whether the site's ground is fully opaque, from the colour the root's
 * background resolves to; the token set's answer where that says nothing.
 */
function markGround(root: HTMLElement, opaqueByTokens: boolean): void {
  const resolved = (
    root.ownerDocument.defaultView?.getComputedStyle(root).backgroundColor ?? ""
  ).trim();
  const alpha = alphaOf(resolved) ?? computedAlphaOf(resolved);
  setFlag(
    root,
    "data-nx-site-ground-opaque",
    alpha === undefined || alpha === 0 ? opaqueByTokens : alpha === 1
  );
}

function setFlag(element: Element, attribute: string, wanted: boolean): void {
  if (wanted === element.hasAttribute(attribute)) return;
  if (wanted) element.setAttribute(attribute, "");
  else element.removeAttribute(attribute);
}

/**
 * Which ids to mark, given what the host supplied.
 *
 * The primary alone when a host has not adopted the set yet, which keeps every
 * existing caller correct without a change. `[]` rather than `[null]` for an
 * empty selection: the marker is applied by id, and a null in the set would
 * match the elements carrying no id at all.
 */
function markedIds(
  selectedIds: readonly string[] | undefined,
  selectedId: string | null
): readonly string[] {
  if (selectedIds !== undefined) return selectedIds;
  return selectedId === null ? [] : [selectedId];
}

/**
 * The canvas's pointer handlers, which share one rule: chrome is not the page.
 *
 * Together rather than separately, because that rule is the whole of what they
 * have in common and a version where each handler remembers it for itself is
 * the version where the next one does not. Pressing a control drawn over the
 * canvas would otherwise resolve to "no node" and deselect the very block that
 * control acts on.
 */
function useCanvasPointer(
  onSelect: ((id: string | null, mode: SelectionMode) => void) | undefined,
  onDoubleClick:
    | ((event: React.MouseEvent<HTMLDivElement>) => void)
    | undefined,
  marked: readonly string[],
  onListSortField?: (id: string) => void
): {
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const click = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onSelect === undefined || isChrome(event.target)) return;
      const id = nodeIdFromEvent(event.target);
      // A failed list's Copy ref copies the reference and stays on the
      // list: the author is about to paste it to a developer, not edit.
      if (copyNoteReference(event.target)) {
        if (id !== null) onSelect(id, "replace");
        return;
      }
      // A list note's "Choose a field", pressed or activated from the
      // keyboard: the host selects the list and takes the author to its sort,
      // in place of the plain selection a click inside the list makes.
      if (
        id !== null &&
        onListSortField !== undefined &&
        listActionOf(event.target) === "choose-sort-field"
      ) {
        onListSortField(id);
        return;
      }
      // A click on the canvas background resolves to null, which CLEARS the
      // selection rather than being ignored. Ignoring it leaves an inspector
      // showing a node the author believes they have deselected.
      onSelect(id, selectionModeFor(event));
    },
    [onSelect, onListSortField]
  );
  const doubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isChrome(event.target)) return;
      onDoubleClick?.(event);
    },
    [onDoubleClick]
  );
  /*
   * The secondary button selects, and says whether anything above this has a
   * block to act on.
   *
   * Selecting FIRST is the whole point. A menu opened over one block while the
   * selection sits on another acts on the other one, and the author is looking
   * at the block they aimed at — so the destructive verbs on it would be aimed
   * somewhere they cannot see.
   *
   * A block already in the selection is left alone rather than replacing it.
   * Right-clicking one of several chosen blocks to act on all of them is what
   * every comparable editor does, and re-selecting would silently drop the rest
   * of the author's selection at the moment they went looking for a verb.
   *
   * Over the canvas BACKGROUND the event is stopped instead. There is no node,
   * so a menu of block verbs would have no subject; stopping it here rather
   * than opening an empty one keeps that decision next to the hit test that
   * establishes it.
   */
  const contextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      /*
       * Three ways to have no block to act on, stopped the same way and for
       * separate reasons — see each predicate. Stopping rather than merely
       * returning is what matters: a menu mounted ABOVE the canvas sees
       * whatever this lets past, and the chrome and the appenders are drawn
       * INSIDE the canvas root, so a bare return offers the selected block's
       * verbs for a gesture aimed at a button that is not a block.
       *
       * `preventDefault` is deliberately not called, so the browser's own menu
       * still appears wherever this one does not.
       */
      const id = contextMenuTargetOf(event.target, event.currentTarget);
      if (id === null) {
        event.stopPropagation();
        return;
      }
      if (onSelect === undefined || marked.includes(id)) return;
      onSelect(id, "replace");
    },
    [marked, onSelect]
  );
  /*
   * The same withholding, for the gesture that carries no context event.
   *
   * A menu mounted above the canvas can open a touch or pen LONG PRESS from a
   * timer of its own, started on this event — no `contextmenu` is ever
   * dispatched, so the rule above never runs and every rejection it makes is
   * skipped. Withholding the press from anything above keeps one decision
   * governing both ways in.
   *
   * `stopPropagation` and NOT `preventDefault`, which is the whole point of
   * doing it here. This fires at the start of every contact, long before
   * anything knows whether it will become a long press, and cancelling the
   * default that early takes caret placement and text selection away from an
   * author who was only tapping into a sentence.
   */
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (contextMenuTargetOf(event.target, event.currentTarget) === null)
        event.stopPropagation();
    },
    []
  );
  return {
    onClick: click,
    onDoubleClick: doubleClick,
    onContextMenu: contextMenu,
    onPointerDown: pointerDown,
  };
}

export interface CanvasProps {
  /** The document being edited. */
  document: BlockDocument;
  /**
   * Receives the canvas root element, for a caller that needs to measure
   * against it.
   *
   * A drag that begins OUTSIDE the canvas — from a palette row — has no event
   * whose `currentTarget` is this element, and it must resolve a drop position
   * against the same box every other reader uses. This canvas owns that
   * element, so handing it over is more honest than a caller finding it by
   * class name: a query would be a second place that decides which element the
   * canvas root is.
   *
   * READ IT IN A HANDLER, NOT AN EFFECT, and that is a property of the call
   * site rather than of this prop — so it travels with nothing and has to be
   * said here. A ref answers "where is the canvas now" at press time, long
   * after mount. An effect asking the same ref reads `null` on its first run
   * and is never told otherwise, because assigning `.current` changes no
   * dependency and this canvas mounts only once styles have loaded. Anything
   * that must REACT to the canvas arriving takes {@link CanvasProps.onRoot}.
   */
  rootRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * The interaction state the panel is editing, forced on the primary
   * selection so an author can SEE what they are editing.
   *
   * A page cannot force a pseudo-class on itself — there is no CSS or DOM way
   * to make an element match `:hover` without a pointer. So the sheet has to be
   * compiled with `previewStates`, which gives each state a class alternative
   * beside its pseudo-class, and this canvas puts that class on one element.
   * Passed a state without that compile, nothing happens and nothing breaks:
   * the class is simply in no selector.
   *
   * `base` forces nothing. It is what applies when no state does.
   */
  forcedState?: StyleState;
  /**
   * The same element, published as a VALUE so a caller can react to it
   * appearing.
   *
   * A ref is not reactive. This canvas mounts only once styles have loaded
   * while the surfaces beside it stay mounted throughout, so a reader that
   * captured `rootRef` on its first render sees `null` and is never told
   * otherwise — assigning `.current` changes no dependency, so an effect
   * listing the ref never looks again.
   *
   * `rootRef` stays for the readers that only ever ask "where is it now" during
   * a gesture, where a ref is exactly right.
   */
  onRoot?: (root: HTMLDivElement | null) => void;
  /**
   * The site sheet, the same value the published route passes. Required — see
   * the module docblock for why this one is not optional.
   */
  siteStyles: NonNullable<PageRendererProps["siteStyles"]>;
  /**
   * The PRIMARY selected node's id, or null when the selection is empty.
   *
   * The one the inspector edits. Marked `data-nx-selected="primary"` so a
   * multi-block selection can show which member the panels answer for — with
   * one block selected there is nothing to distinguish and the distinction
   * costs nothing.
   */
  selectedId?: string | null;
  /**
   * Every selected id. Defaults to the primary alone.
   *
   * A separate prop rather than derived from `selectedId`, because the canvas
   * must not decide what a selection IS — `selection.ts` does, and a canvas
   * that reconstructed the set from one id would silently disagree with it the
   * moment there were two.
   */
  selectedIds?: readonly string[];
  /**
   * Raised with the clicked node's id and the gesture its modifiers meant, or
   * null when the click hit no node.
   *
   * The MODE travels with the id because only the event knows it, and a caller
   * reading modifiers off a later render's event would read a different click.
   */
  onSelect?: (id: string | null, mode: SelectionMode) => void;
  /**
   * Raised with a collection list's id when its note's "Choose a field" is
   * pressed, for the host to select the list and take the author to its
   * sort. Absent, the press selects the list as any click inside it does.
   */
  onListSortField?: (id: string) => void;
  /**
   * Everything else the renderer needs, passed through untouched.
   *
   * Spread rather than re-declared field by field: `PageRenderer` owns that
   * contract, and restating it here would be a second copy that silently stops
   * accepting whatever the renderer gains next.
   */
  render?: Omit<PageRendererProps, "document" | "siteStyles">;
  className?: string;
  /**
   * Pointer handlers for dragging blocks, from `useCanvasDrag`.
   *
   * Taken as an object rather than as individual props so the set cannot be
   * partially wired: a canvas carrying `onPointerDown` without `onPointerUp`
   * starts gestures it never ends, and the failure is a canvas that behaves
   * normally until the first drag.
   */
  dragHandlers?: CanvasDragHandlers;
  /**
   * What the pointer currently means, or absent when nothing is being dragged.
   *
   * ONE object rather than separate `draggingId`, `target` and `refusal` props,
   * for the reason {@link CanvasProps.dragHandlers} and
   * {@link CanvasProps.preview} are each one: a set spread across several
   * optional props can be PARTIALLY wired, and every partial wiring here fails
   * silently. A host passing the refusal without the moving id explains a
   * refusal while dimming nothing; one passing the id without the refusal is
   * precisely the state this prop exists to end.
   *
   * It is the shape `useCanvasDrag` already returns, so a host forwards what it
   * holds and restates none of it. Deriving a narrower view here would be a
   * second answer to a question the hook has already answered.
   *
   * Drawing only. Nothing here decides where a block may land — `resolveDrop`
   * does that, and this canvas draws whatever it was told.
   */
  drag?: CanvasDragState;
  /**
   * Raised when a double-click lands on the page.
   *
   * Separate from `onSelect` because the two gestures mean different things and
   * one handler deciding between them by counting clicks would be a second
   * place the distinction lives. A double-click that hits no editable value
   * does nothing, which the handler decides — the canvas does not know what is
   * editable.
   */
  onDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  /**
   * Editor chrome drawn ABOVE the page, for a canvas sharing the editor's
   * document.
   *
   * Inside the root rather than beside it, because the overlay is positioned in
   * the canvas's own content coordinates and the root is what establishes them.
   * Rendered after the page so it paints on top without needing a stacking
   * context of its own.
   *
   * A canvas in a `CanvasFrame` takes no overlay here: its chrome is the
   * frame's `overlay`, drawn in the editor's document over the frame, where
   * the site's CSS cannot reach it.
   */
  overlay?: React.ReactNode;
  /**
   * The regions of the page's Layout, drawn locked around the page: a header
   * before it, a footer after it, as a visitor gets them.
   *
   * Drawn inside the canvas root, as part of what the canvas renders, so any
   * surface the canvas is mounted on carries them with the page. They share
   * the page's one site sheet and its previewed breakpoints, each compiled
   * under a scope of its own (`layoutPartSheets`), so the canvas shows the
   * cascade the published route serves. Absent or empty, the canvas draws the
   * page exactly as it always has.
   */
  regions?: readonly CanvasRegion[];
  /**
   * The blocks whose visibility conditions the page can't check, which the
   * canvas marks in red: visitors never see them. Judged by the host, which
   * knows the collections' fields. Absent, every conditioned block is marked
   * only as conditional.
   */
  conditionsUnchecked?: ReadonlySet<string>;
  /**
   * The page with its visibility conditions applied for the entry it is
   * previewed with (`appliedConditionsOf`): a block hidden for that entry is
   * drawn as a one-line marker in its place, and one shown is badged so.
   * Absent, every conditioned block is drawn and marked as conditional.
   *
   * Applied to the page as drawn: a template's with the previewed entry's
   * own blocks already composed into its Entry content (`composed`), so the
   * entry's blocks are judged with the template's and the canvas draws this
   * document as it is, composing nothing of its own.
   */
  conditionsApplied?: AppliedConditions;
  /**
   * `document` with the previewed entry's own blocks composed into its Entry
   * content block (`useComposedEntryContent`), where the host composed it
   * for the conditions it applies: the canvas draws it rather than composing
   * its own, so the page has one composition. Absent, the canvas composes
   * `document` with the entry the seam names.
   */
  composed?: BlockDocument;
}

/**
 * The canvas.
 *
 * Selection is addressed by node ID and never by position. The engine's document
 * makes ids the only addressing anything stores, and a positional selection
 * breaks the moment a sibling is inserted above it — silently, by pointing at a
 * different block rather than at nothing.
 */
/**
 * The element drawing a node, restricted to the canvas that owns it.
 *
 * {@link nodeElement} answers with the first match anywhere beneath the root,
 * which is the wrong question once a block can render a canvas of its own: node
 * ids are unique within a DOCUMENT, so an inner document may legitimately carry
 * the same id and appear earlier in tree order.
 */
function ownedNodeElement(root: HTMLElement, id: string): Element | null {
  for (const candidate of nodeElements(root)) {
    if (candidate.getAttribute(NODE_ID_ATTRIBUTE) !== id) continue;
    if (ownedByCanvas(candidate, root)) return candidate;
  }
  return null;
}

/**
 * The refusal a canvas should DRAW, which is not every refusal it is given.
 *
 * `useCanvasDrag` holds the committed target across a short crossing so the
 * indicator does not flicker, while setting the refusal from the region under
 * the pointer immediately — so both are non-null for the width of the switch
 * threshold. Drawing the refusal there contradicts two things at once: the
 * line still points at the held target, and releasing commits it. The chrome
 * would say the block cannot land while letting go moves it.
 *
 * So a refusal is the honest answer only once there is no target to disagree
 * with. One function rather than the same condition written at the mark and
 * again at the message, because two spellings of one rule drift and the drift
 * shows up as chrome that half-agrees with itself.
 */
function drawnRefusal(
  drag: CanvasDragState | undefined
): CanvasDragState["refusal"] {
  if (drag === undefined || drag.target !== null) return null;
  // A drag state built without a refusal at all reads as none.
  return drag.refusal ?? null;
}

/**
 * The sentence a refused drop draws, over the container that refused it.
 *
 * Anchored to the CONTAINER rather than to the pointer. The drag state carries
 * no pointer coordinate — reading one back would mean a second answer to a
 * question `useCanvasDrag` already owns — and a message pinned to the region is
 * steadier to read than one that moves with the hand.
 *
 * Measured in the canvas's own CONTENT coordinates, the space the drop
 * indicator and the block toolbar are already positioned in, so the three agree
 * at any scroll offset and under zoom.
 *
 * Keyed on the region and the reason rather than on the refusal OBJECT: the
 * drag hook returns a fresh object every pointer move, and re-measuring per
 * frame would cost a layout read for an answer that changes only when the
 * pointer crosses into a different container.
 */
function DropRefusalNotice({
  refusal,
  movingType,
  regionType,
}: {
  refusal: NonNullable<CanvasDragState["refusal"]>;
  movingType: string;
  regionType: string | undefined;
}): React.JSX.Element {
  const notice = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Whether the canvas is in the editor's frame, whose viewport scrolls it,
  // and the zoom, which moves the region on screen while nothing in the frame
  // changes.
  const canvasFrame = useCanvasFrame();
  const framed = canvasFrame.frame !== null;
  const { parentId } = refusal;
  // One wording per rule: a lock's from the function every lock refusal uses,
  // a nesting refusal's from the drag's own.
  const { headline, remedy } =
    "lock" in refusal
      ? lockRefusalWording(refusal.lock)
      : refusalWording(refusal, movingType, regionType);

  /*
   * Measured BEFORE the browser paints, not after.
   *
   * A plain effect runs after paint, so the message draws once at the canvas's
   * top-left — where an unpositioned absolute box lands — and jumps to the
   * container on the next frame. During a drag that is not a single flash: a
   * refusal is re-entered every time the pointer crosses into a region that
   * will not take the block, so the jump repeats.
   *
   * The isomorphic form rather than `useLayoutEffect` directly, because a
   * client component is still server-rendered and the plain hook warns there.
   */
  useIsomorphicLayoutEffect(() => {
    const element = notice.current;
    if (element === null) return;
    /*
     * The canvas the notice is drawn over and the space it is drawn in: inside
     * the root over a canvas sharing the editor's document, or in the layer
     * over the canvas's frame, where the root's coordinates are scaled to the
     * zoom and the notice keeps its own size. The clamp below is worked out in
     * the root's coordinates and only the result is placed.
     */
    const space = overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) return;
    const { root } = space;
    const scroller = canvasScroller(root, framed);
    const place = (point: { x: number; y: number }): void => {
      const placed = space.place({ ...point, width: 0, height: 0 });
      setAt({ x: placed.x, y: placed.y });
    };
    const measure = (): void => {
      // The root itself when the refusal is at the page level: there is no
      // container node to point at, which is the whole of what
      // `restricted-at-root` means.
      /*
       * Resolved within THIS canvas, for the reason the marks are: a node id is
       * unique in a document and not across documents, so a block rendering a
       * second canvas can put a matching id earlier in the tree — and the message
       * would then be anchored over a block belonging to another document.
       */
      const region =
        parentId === undefined ? root : ownedNodeElement(root, parentId);
      if (region === null) return;
      const rect = canvasContentRect(region, root);

      /*
       * Clamped into the part of the canvas the author can actually see.
       *
       * The anchor alone is not enough. A root refusal has no container to point
       * at, so it resolves to the canvas itself and lands at the page origin —
       * which on a long page is several screens above someone dragging near the
       * bottom, so the explanation for what just refused them is drawn where they
       * are not looking. A very tall container scrolled past does the same.
       *
       * The scroller defines "visible": the shell scrolls an ancestor rather than
       * the canvas, and in a frame of its own the frame's viewport scrolls it.
       * The same scroller this effect listens to below, so what is measured
       * and what is heard cannot be two different elements, and its visible
       * part measured in this canvas's own content coordinates is exactly the
       * band on screen.
       */
      if (scroller === null) {
        place({ x: rect.x, y: rect.y });
        return;
      }
      const band = visibleBandOf(scroller, root);
      const inset = 12;
      // The notice's height in the root's coordinates: drawn at its own size
      // over a frame painted at another.
      const height = space.sizeOf(element).height / space.scale;
      const lowest = band.y + band.height - inset - height;
      const top = band.y + inset;
      // A band shorter than the message puts `lowest` above its own top, which
      // makes the range inverted rather than narrow. Taking the top there keeps
      // the message on screen instead of pinning it to a bound derived from a
      // height that does not fit.
      place({
        x: rect.x,
        y: lowest < top ? top : Math.max(top, Math.min(rect.y, lowest)),
      });
    };

    measure();

    /*
     * Re-measured while the canvas scrolls under a stationary pointer.
     *
     * Autoscroll is the case that makes this necessary rather than tidy: a drag
     * held near an edge keeps scrolling without the pointer moving, so the
     * refusal does not change and nothing in this effect's inputs does either —
     * while the band the message was clamped into travels away from it. The
     * explanation would sit still and the page would leave.
     *
     * Passive, because this only reads geometry, and on the SCROLLER rather
     * than the canvas: the canvas does not scroll, its ancestor does — or, in
     * a frame of its own, the frame's viewport, whose scroll is dispatched at
     * the frame's document rather than at any element.
     */
    if (scroller === null) return;
    const source = scrollEventTarget(scroller);
    source.addEventListener("scroll", measure, { passive: true });
    return () => {
      source.removeEventListener("scroll", measure);
    };
    /*
     * Re-measured when the WORDING changes, not merely when the container does.
     *
     * Two slots on one container share a `parentId` and a reason while carrying
     * different permitted lists, so the message can be replaced without any of
     * the identity this effect anchors on moving. A longer remedy wraps onto
     * another line, and the clamp would still be holding the height of the
     * sentence it replaced — which is exactly the case that pushes it back out
     * of the band near the bottom of the viewport.
     *
     * Keyed on the rendered strings rather than on `regionId`, because height
     * is a property of the text: two regions producing identical sentences need
     * no re-measure, and one region whose list changed does.
     */
  }, [parentId, headline, remedy, framed, canvasFrame]);

  return (
    <RefusalNotice
      ref={notice}
      className="nx-drop-refusal"
      style={at === null ? undefined : { left: at.x, top: at.y }}
      /*
       * NOT announced, matching {@link DropIndicator} rather than differing
       * from it: this describes a POINTER gesture, and a live region here
       * would speak to someone who is not the one dragging. The spoken
       * counterpart is `keyboard-actions`, which refuses a move the nesting
       * rule forbids and announces the same reason and remedy through its own
       * live region, asked of the same wording function.
       */
      headline={headline}
      remedy={remedy}
    />
  );
}

/**
 * Why the block being dragged cannot land where it is, drawn over the
 * container that refused it, or nothing while there is no refusal to draw.
 *
 * Chrome like the drop line, so it goes where the chrome goes: the overlay of
 * the `CanvasFrame` the canvas is drawn in, in the editor's document, or the
 * canvas's own `overlay` over a canvas sharing that document.
 *
 * @experimental
 */
export function DropRefusal({
  drag,
  document,
}: {
  /** What the pointer means, from `useCanvasDrag`, as the canvas is given it. */
  drag: CanvasDragState | undefined;
  /** The document the canvas is drawing, which names the refusing block. */
  document: BlockDocument;
}): JSX.Element | null {
  const refusal = drawnRefusal(drag);
  if (refusal === null) return null;
  const { parentId } = refusal;
  return (
    <DropRefusalNotice
      refusal={refusal}
      movingType={drag?.draggingBlockName ?? ""}
      /*
       * The container's TYPE, resolved from the document the canvas is
       * drawing. The refusal names the node; what an author reads is the
       * block's name, and the document is the only place that mapping exists.
       */
      regionType={
        parentId === undefined
          ? undefined
          : findNode(document.nodes, parentId)?.type
      }
    />
  );
}

/**
 * The canvas root's style, with the scale the page is painted at published as
 * `--nx-canvas-zoom`.
 *
 * Chrome drawn inside the page (a Layout region's badge and tag) is scaled
 * with everything else when the frame is painted smaller or larger, which
 * makes its words unreadable on a zoomed-out canvas. Reading the factor back
 * lets that chrome undo it and stay at the admin's own size, without each
 * piece measuring the canvas.
 */
function withCanvasScale(
  style: React.CSSProperties | undefined,
  scale: number
): React.CSSProperties {
  return { ...style, "--nx-canvas-zoom": scale } as React.CSSProperties;
}

/** A region of the page's Layout, with how it treats the site sheet. */
interface DrawnRegion {
  region: CanvasRegion;
  sheet: PartSheet;
}

/** The page and the regions drawn around it, each with its sheet inputs. */
interface LayoutParts {
  page: PartSheet;
  header: DrawnRegion | undefined;
  footer: DrawnRegion | undefined;
}

/**
 * The page and the regions around it, each with its site-sheet inputs.
 *
 * Asked of `layoutPartSheets`, the answer the published route uses, so the
 * first part drawn emits the site sheet and each part compiles under its own
 * scope. `undefined` when there is no region to draw.
 */
function useLayoutParts(
  regions: readonly CanvasRegion[] | undefined,
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  sheet: NonNullable<PageRendererProps["siteStyles"]>
): LayoutParts | undefined {
  return useMemo(
    () => layoutPartsOf(regions, rendered, sheet),
    [regions, rendered, sheet]
  );
}

/** {@link useLayoutParts}'s answer, computed. */
function layoutPartsOf(
  regions: readonly CanvasRegion[] | undefined,
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  sheet: NonNullable<PageRendererProps["siteStyles"]>
): LayoutParts | undefined {
  const header = regions?.find(region => region.area === "header");
  const footer = regions?.find(region => region.area === "footer");
  if (header === undefined && footer === undefined) return undefined;
  const parts = drawingOrder(header !== undefined, footer !== undefined);
  const sheets = layoutPartSheets({
    parts,
    styleContext: rendered?.styleContext,
    siteStyles: sheet,
    pageScope: pageScopeOf(rendered),
  });
  const sheetFor = (part: PagePart): PartSheet =>
    sheets[parts.indexOf(part)] ?? {};
  return {
    page: sheetFor("page"),
    header: drawnRegion(header, sheetFor),
    footer: drawnRegion(footer, sheetFor),
  };
}

/** The parts in the order they are drawn: header, page, footer. */
function drawingOrder(hasHeader: boolean, hasFooter: boolean): PagePart[] {
  return [
    ...(hasHeader ? (["header"] as const) : []),
    "page",
    ...(hasFooter ? (["footer"] as const) : []),
  ];
}

/** The scope the page's own styles compile under, when it states one. */
function pageScopeOf(
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined
): string | undefined {
  const scope = rendered?.styles?.scope;
  return typeof scope === "string" ? scope : undefined;
}

/** One region with its sheet inputs, or nothing for a region not drawn. */
function drawnRegion(
  region: CanvasRegion | undefined,
  sheetFor: (part: PagePart) => PartSheet
): DrawnRegion | undefined {
  return region === undefined
    ? undefined
    : { region, sheet: sheetFor(region.area) };
}

/**
 * The page between its Layout's header and footer, as the canvas draws them.
 *
 * Each region is drawn in the page's environment, so a header block that
 * measures itself or listens is told the frame the canvas draws in, as the
 * page is. Without regions it is the page alone, exactly as before.
 */
function RegionsAround({
  drawn,
  rendered,
  environment,
  selection,
  children,
}: {
  drawn: LayoutParts | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  environment: BlockEnvironment | undefined;
  /** The canvas's selection: a region's open tag closes when it changes. */
  selection: readonly string[];
  children: React.ReactNode;
}): React.JSX.Element {
  const frame = (part: DrawnRegion | undefined) =>
    part === undefined ? null : (
      <BlockEnvironmentProvider value={environment}>
        <CanvasRegionFrame
          region={part.region}
          rendered={rendered}
          sheet={part.sheet}
          selection={selection}
        />
      </BlockEnvironmentProvider>
    );
  return (
    <>
      {frame(drawn?.header)}
      {children}
      {frame(drawn?.footer)}
    </>
  );
}

/**
 * The document and window the canvas draws in, held where nothing walking an
 * object's own keys can reach them.
 *
 * The value is a prop of the environment provider, and React's development
 * build describes every changed prop for its performance panel by walking the
 * object's own enumerable keys a few levels down. A plain `{ document, window }`
 * leads that walk into the window, whose own keys include each child frame —
 * and a page with an Embed block has one in an opaque origin, where reading
 * anything throws a `SecurityError`. It threw while React was running the
 * commit's effects, so the effects after it never ran: the canvas stopped
 * measuring its region, and the device and zoom controls stopped moving it.
 *
 * Private fields behind getters are not own enumerable keys, so the walk finds
 * nothing to enter, while `environment.window` reads exactly as before.
 */
class CanvasEnvironment implements BlockEnvironment {
  readonly #document: Document;
  readonly #window: Window;

  constructor(document: Document, view: Window) {
    this.#document = document;
    this.#window = view;
  }

  get document(): Document {
    return this.#document;
  }

  get window(): Window {
    return this.#window;
  }
}

/**
 * The canvas root, published to both of its readers, and guarded.
 *
 * ONE assignment site for both publications.
 *
 * They are two APIs because they answer two questions — `rootRef` is read in
 * a pointer handler and asks "where is the canvas now"; `onRoot` is a value
 * so a reader can REACT to the canvas arriving, which a ref cannot express
 * because assigning `.current` changes no dependency. Neither can serve the
 * other's caller.
 *
 * But two effects deciding what the element is could drift: an edit to one is
 * invisible to the other, and the two would then hand out different answers
 * with nothing to report it. One effect, one element, published twice.
 *
 * After paint rather than through a merged ref callback: the element is the
 * same for the life of the mount, and one assignment here is easier to follow
 * than a callback keeping two refs agreeing.
 */
function usePublishedRoot(
  root: React.RefObject<HTMLDivElement | null>,
  rootRef: CanvasProps["rootRef"],
  onRoot: CanvasProps["onRoot"]
): void {
  useEffect(() => {
    const element = root.current;
    if (rootRef !== undefined) rootRef.current = element;
    onRoot?.(element);
    return () => {
      if (rootRef !== undefined) rootRef.current = null;
      onRoot?.(null);
    };
  }, [root, rootRef, onRoot]);

  // A link or form the page draws selects its block here and never takes the
  // editor anywhere: see `canvas-link-guard`. Same element, same lifetime as
  // the effect above, so it is installed once per mount.
  useEffect(() => {
    const element = root.current;
    return element === null
      ? undefined
      : guardCanvasNavigation(element, `[${CHROME_ATTRIBUTE}]`);
  }, [root]);
}

/**
 * What is marked as selected, and the pointer handlers that select.
 *
 * The primary alone is marked when a host has not adopted the set yet, which
 * keeps every existing caller correct without a change. A drag's own pointer
 * down runs first, so its behaviour is exactly what it was.
 */
function useSelectionPointer({
  selectedIds,
  selectedId,
  onSelect,
  onDoubleClick,
  onListSortField,
  dragPointerDown,
}: {
  selectedIds: CanvasProps["selectedIds"];
  selectedId: string | null;
  onSelect: CanvasProps["onSelect"];
  onDoubleClick: CanvasProps["onDoubleClick"];
  onListSortField: CanvasProps["onListSortField"];
  dragPointerDown:
    | ((event: React.PointerEvent<HTMLDivElement>) => void)
    | undefined;
}) {
  const marked = useMemo(
    () => markedIds(selectedIds, selectedId),
    [selectedIds, selectedId]
  );
  const pointer = useCanvasPointer(
    onSelect,
    onDoubleClick,
    marked,
    onListSortField
  );
  const canvasPointerDown = pointer.onPointerDown;
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragPointerDown?.(event);
      canvasPointerDown(event);
    },
    [canvasPointerDown, dragPointerDown]
  );
  return { marked, pointer, pointerDown };
}

/**
 * Point the editor's hovered block at the deepest block under the pointer, so
 * the canvas outlines it as a Layers row does, and at nothing when the
 * pointer leaves the canvas or is over its background.
 *
 * Nothing while a block is dragged: the drag's own marks say where it will
 * land, and an outline under the moving pointer would compete with them. The
 * drag's own move handler runs first, so the gesture behaves exactly as it
 * did; a move over the editor's chrome points at nothing new.
 */
function useCanvasHover(
  dragMove: React.PointerEventHandler<HTMLElement> | undefined,
  dragging: boolean
): {
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
} {
  const setHovered = useHoveredBlockSetter();
  // In the layout phase, so the frame that first draws the drag never also
  // draws the hovered outline its marks replace: a passive effect runs after
  // that paint.
  useIsomorphicLayoutEffect(() => {
    if (dragging) setHovered(null);
  }, [dragging, setHovered]);
  // Nothing stays pointed at once the canvas goes.
  useEffect(() => () => setHovered(null), [setHovered]);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragMove?.(event);
      if (dragging) return;
      const { target } = event;
      // Chrome over a block is inside the canvas, so moving onto it fires no
      // `pointerleave`: the block is let go here instead.
      if (isChrome(target)) {
        setHovered(null);
        return;
      }
      // A canvas a block renders is another document, with its own addresses:
      // its moves bubble here and are left to it.
      if (
        !isElement(target) ||
        target.closest(`.${CANVAS_ROOT_CLASS}`) !== event.currentTarget
      ) {
        return;
      }
      setHovered(nodeIdFromEvent(target));
    },
    [dragMove, dragging, setHovered]
  );
  const onPointerLeave = useCallback(() => setHovered(null), [setHovered]);
  return { onPointerMove, onPointerLeave };
}

/**
 * A click on the page around the canvas, inside its frame, answered as a
 * click on the canvas's own ground: the selection is cleared.
 *
 * On a page the site serves, the site's layout decides how tall the canvas
 * is, so below a short page the frame shows the site's own page rather than
 * the canvas, and the click an author makes there to let go of a block lands
 * outside the canvas root. Only inside a frame: where the canvas shares the
 * editor's document, everything outside it is the editor's own panels.
 */
function useFrameGroundClick(
  root: React.RefObject<HTMLDivElement | null>,
  onSelect: CanvasProps["onSelect"]
): void {
  const framed = useCanvasFrame().frame !== null;
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  }, [onSelect]);
  useEffect(() => {
    const element = root.current;
    if (!framed || element === null) return;
    const doc = element.ownerDocument;
    const ground = (event: MouseEvent): void => {
      const { target } = event;
      // The canvas answers its own clicks, and chrome is not the page.
      if (isElement(target) && element.contains(target)) return;
      if (isChrome(target)) return;
      latest.current?.(null, selectionModeFor(event));
    };
    doc.addEventListener("click", ground);
    return () => doc.removeEventListener("click", ground);
  }, [framed, root]);
}

/**
 * The document and window the blocks are drawn in, for block code that
 * measures itself or listens (`useBlockEnvironment`). Read from the canvas
 * root's OWN document rather than the globals, so the answer is the frame's
 * once the canvas renders inside one, with nothing here to change.
 * `undefined` until the root has mounted, which the hook passes on rather
 * than falling back to the admin page. Built as a `CanvasEnvironment` rather
 * than an object literal; see there for why.
 */
function useCanvasEnvironment(
  root: React.RefObject<HTMLDivElement | null>
): BlockEnvironment | undefined {
  const [environment, setEnvironment] = useState<BlockEnvironment | undefined>(
    undefined
  );
  useEffect(() => {
    const view = root.current?.ownerDocument.defaultView;
    if (root.current === null || view == null) return;
    setEnvironment(new CanvasEnvironment(root.current.ownerDocument, view));
  }, [root]);
  return environment;
}

/**
 * What the canvas renders the page with. Conditions not applied, a placed
 * component's definitions with their conditions lifted, so each conditioned
 * block is drawn. Applied, the definitions as stored, their blocks judged
 * for the previewed entry by the renderer as the page's route judges them
 * (`entryJudged`), and the blocks with the hidden-block marker among them.
 */
function drawnRenderOf(
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined,
  document: BlockDocument,
  applied: AppliedConditions | undefined
): Omit<PageRendererProps, "document" | "siteStyles"> | undefined {
  if (applied === undefined) {
    return rendered?.definitions === undefined
      ? rendered
      : {
          ...rendered,
          definitions: revealedDefinitions(
            document,
            rendered.definitions,
            rendered.limits
          ),
        };
  }
  return {
    ...rendered,
    entryJudged: applied.entryJudgement,
    blocks: withConditionHiddenBlock(rendered?.blocks ?? registeredBlocks()),
  };
}

/**
 * The page, drawn, and the regions of its Layout around it.
 *
 * The parts in drawing order, each with how it treats the site sheet:
 * `undefined` when there are no regions, so a canvas without a Layout renders
 * exactly as it did.
 */
function useDrawnPage({
  regions,
  rendered,
  sheet,
  document,
  environment,
  applied,
}: {
  regions: readonly CanvasRegion[] | undefined;
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  sheet: NonNullable<PageRendererProps["siteStyles"]>;
  document: BlockDocument;
  environment: BlockEnvironment | undefined;
  applied: AppliedConditions | undefined;
}): { drawn: LayoutParts | undefined; page: React.JSX.Element } {
  const drawn = useLayoutParts(regions, rendered, sheet);
  // Every conditioned block drawn, whoever the page would show it to, so the
  // author can see and select it; the marks say it isn't shown to everyone.
  // While conditions are applied, `document` is already the page as they
  // leave it (a hidden block as its marker), with the previewed entry's
  // blocks composed in, which are revealed as they are without conditions.
  // A block a list's entry decides keeps its conditions while the entries
  // are judged, for the renderer to judge against each one drawn.
  const limits = rendered?.limits;
  const drawable = useMemo(
    () => revealedForCanvas(document, applied, limits),
    [document, applied, limits]
  );
  // A placed component's definition too: its conditioned blocks are drawn,
  // as the page's are. While conditions are applied, the renderer also knows
  // the marker a hidden block is drawn as.
  const drawnRender = useMemo(
    () => drawnRenderOf(rendered, document, applied),
    [rendered, document, applied]
  );
  const page = useMemo(
    () => (
      <BlockEnvironmentProvider value={environment}>
        <PageRenderer
          {...drawnRender}
          document={drawable}
          siteStyles={sheet}
          {...drawn?.page}
          // What makes the hit-testing above possible at all. The renderer emits
          // the node attribute only when asked, because a PUBLISHED page should
          // not carry an editor's addressing — so the canvas asks and a route
          // does not. Spread first and set here deliberately: a caller passing
          // `nodeAttribute: false` through `render` would silently disable
          // selection for the whole canvas.
          nodeAttribute
        />
      </BlockEnvironmentProvider>
    ),
    [drawnRender, drawable, sheet, environment, drawn]
  );
  return { drawn, page };
}

export function Canvas({
  document,
  rootRef,
  onRoot,
  forcedState,
  siteStyles,
  selectedId = null,
  selectedIds,
  onSelect,
  render,
  className,
  dragHandlers,
  drag,
  onDoubleClick,
  onListSortField,
  overlay,
  regions,
  conditionsUnchecked,
  conditionsApplied,
  composed,
}: CanvasProps): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  usePublishedRoot(root, rootRef, onRoot);
  useFrameGroundClick(root, onSelect);
  const hover = useCanvasHover(
    dragHandlers?.onPointerMove,
    drag?.draggingBlockName != null
  );

  const { marked, pointer, pointerDown } = useSelectionPointer({
    selectedIds,
    selectedId,
    onSelect,
    onDoubleClick,
    onListSortField,
    dragPointerDown: dragHandlers?.onPointerDown,
  });

  const surface = siteSurface(render, siteStyles);
  useSiteSurfaceMarks(root, surface?.opaqueGround === true);
  // The scale the page is painted at, for chrome drawn inside it to undo.
  const canvasScale = useCanvasFrame().scale;

  const environment = useCanvasEnvironment(root);
  // The page as the conditions leave it while they are applied for the
  // previewed entry (a hidden block as its marker), else the page itself.
  const shownDocument = conditionsApplied?.document ?? document;
  // A template draws its previewed entry's own blocks in its Entry content
  // block; only the drawn page carries them, never the document edited.
  // Composed once: by the host where it hands the page as drawn
  // (`composed`), else here.
  const entryDrawing = useEntryContentDrawing(document, render, composed);
  // The page as composed, before any conditions are applied: what its
  // conditioned blocks, the entry's among them, are badged on.
  const composedPage = entryDrawing.document;
  // Conditions applied, the page as they leave it, the entry composed into
  // it here unless the host handed the page as composed.
  const appliedDrawing = useAppliedDrawing(
    conditionsApplied?.document,
    composed,
    render
  );
  const { drawn, page } = useDrawnPage({
    regions,
    rendered: entryDrawing.render,
    sheet: siteStyles,
    document: appliedDrawing ?? composedPage,
    environment,
    applied: conditionsApplied,
  });

  /*
   * The locked nodes, collected in ONE traversal per document rather than asked
   * per element inside the marker walk, which re-runs on every change to the
   * rendered tree: `own` for a block locked itself, `inherited` for one inside
   * a locked block, which the lock covers too.
   */
  const lockedIds = useMemo(() => lockMarksOf(document), [document]);
  const conditionMarks = useMemo(
    () =>
      conditionMarksOf(
        composedPage,
        conditionsUnchecked,
        {
          ...(render?.definitions === undefined
            ? {}
            : { definitions: render.definitions }),
          ...(render?.limits === undefined ? {} : { limits: render.limits }),
        },
        conditionsApplied
      ),
    [
      composedPage,
      conditionsUnchecked,
      render?.definitions,
      render?.limits,
      conditionsApplied,
    ]
  );

  // Each Entry content block's words, named by the template's collection:
  // of the blocks drawn, so one the conditions hide, drawn as its marker,
  // says only that it is hidden, as a hidden block's badge does.
  const previewedCollection = usePreviewedCollection();
  const entryContentMarks = useMemo(
    () =>
      entryContentMarksOf(
        shownDocument,
        previewedCollection,
        render?.limits?.maxNodes
      ),
    [shownDocument, previewedCollection, render?.limits]
  );

  useCanvasMarkers(
    root,
    marked,
    selectedId,
    page,
    forcedState,
    drag,
    lockedIds,
    conditionMarks,
    entryContentMarks
  );

  // The refusal the cursor shows, asked of the same rule the notice draws by.
  const refusalDrawn = drawnRefusal(drag);

  return (
    <div
      ref={root}
      className={cn(CANVAS_ROOT_CLASS, className)}
      // On the canvas ROOT rather than an inner wrapper, because the overlays
      // are positioned in this element's own content coordinates: a box inside
      // it would size the page while leaving the drop indicator and the
      // selection chrome measuring the region instead.
      style={withCanvasScale(surface?.style, canvasScale)}
      // The id the canvas believes is current, for a caller that wants the
      // answer without walking the tree. Named apart from the per-element
      // marker deliberately: one carries an id and the other is a boolean, and
      // a single name meaning both is the kind of thing that reads correctly
      // right up until someone writes a selector against the wrong one.
      data-nx-selected-id={selectedId ?? undefined}
      /*
       * Whether the site's dark values include a dark ground. They apply with
       * the device, or under a dark marker, exactly as the site sheet applies
       * them, and the stylesheet pairs this with both to switch the SCHEME:
       * Canvas, CanvasText and native controls. Absent when the dark values
       * keep a light ground, or the host serves no site sheet.
       */
      data-nx-site-dark-ground={surface?.darkGround === true ? "" : undefined}
      /*
       * `data-nx-site-theme`, the mode the nearest theme marker above names,
       * is written onto this element by `useNearestThemeMarker` before paint,
       * not rendered here: see that hook.
       */
      /*
       * `data-nx-site-ground-opaque`, whether the site's ground is fully
       * opaque, is written onto this element by `useSiteSurfaceMarks` from the
       * colour it resolves to, not rendered here: see that hook.
       */
      /*
       * What the pointer means, for the cursor.
       *
       * On the ROOT rather than per block, because a cursor during a drag is a
       * property of the gesture and not of whatever happens to be under the
       * pointer — and pointer capture means the events keep arriving here
       * however far the hand travels.
       *
       * Absent when nothing is dragging, so the hover cursor on a block is not
       * competing with a state that does not exist.
       */
      data-nx-dragging={
        drag?.draggingBlockName == null
          ? undefined
          : refusalDrawn === null
            ? ""
            : "refused"
      }
      onClick={pointer.onClick}
      onDoubleClick={pointer.onDoubleClick}
      onContextMenu={pointer.onContextMenu}
      // Spread whole, because the set cannot be partially applied — then the
      // one member this component also has something to say about is composed
      // over the top, drag first so its behaviour is exactly what it was.
      {...dragHandlers}
      onPointerDown={pointerDown}
      onPointerMove={hover.onPointerMove}
      onPointerLeave={hover.onPointerLeave}
    >
      <RegionsAround
        drawn={drawn}
        rendered={render}
        environment={environment}
        selection={marked}
      >
        {page}
      </RegionsAround>
      {overlay}
    </div>
  );
}
