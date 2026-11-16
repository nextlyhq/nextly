/**
 * Whether a style property has an effect on a block, judged by what the block
 * is: its own arrangement, its parent's, and what it renders.
 *
 * **One answer for every reader.** The catalog records when each property has
 * an effect (`appliesWhen`); this function reads that record against a block.
 * An editor's Style tab, a property picker, a note about values that no longer
 * do anything, the reference docs and any tool all ask here, so none of them
 * keeps a second list of which properties belong to flex or grid.
 *
 * **What it cannot read answers true.** A context field left `undefined` (or
 * holding a CSS-wide keyword such as `inherit`, which names no layout of its
 * own) says nothing about the block, and every condition that depends on it
 * then holds. Listing a property that turns out to do nothing costs an author a
 * glance; hiding one that works costs them the setting.
 *
 * Pure: no document, no DOM, no registry.
 *
 * @module style/applies
 */
import { getStyleProperty } from "./catalog";
import type { AppliesWhen, StyleProperty } from "./catalog-types";
import { CSS_WIDE_KEYWORDS } from "./css-value-vocabulary";

/**
 * What a block is, as far as whether a property has an effect depends on it.
 *
 * Each field is the keyword in force on the block (or its parent), as the
 * page's cascade resolves it. `undefined` means it could not be read. A block
 * known to set nothing takes the CSS initial value: `display` in flow (`block`
 * or `inline`), `position: static`, `flex-wrap: nowrap`.
 */
export interface AppliesContext {
  /** The block's own `display`. */
  readonly display?: string | undefined;
  /** The block's own `flex-wrap`. */
  readonly flexWrap?: string | undefined;
  /** The block's own `position` type. */
  readonly position?: string | undefined;
  /**
   * The `display` of the box that lays this block out: its parent's, or, where
   * the parent is `display: contents`, the nearest ancestor that draws a box.
   */
  readonly parentDisplay?: string | undefined;
  /** Whether the block renders a replaced element: an image, a video, an embed. */
  readonly replaced?: boolean | undefined;
}

/**
 * Whether a property has an effect on a block in this context.
 *
 * `field` names one field of an object property (`"inset"` of `position`),
 * for the rows that answer per field; without it, the property's own answer.
 * A key the catalog does not define answers true: nothing is known about it,
 * and a value stored under it must stay reachable.
 */
export function applies(
  property: string,
  context: AppliesContext,
  field?: string
): boolean {
  const entry = getStyleProperty(property);
  if (entry === undefined) return true;
  return appliesWhenAny(answerFor(entry, field), context);
}

/** The answer a property (or one of its fields) records, `always` when none. */
function answerFor(
  entry: StyleProperty,
  field: string | undefined
): readonly AppliesWhen[] {
  const own = field === undefined ? undefined : entry.fieldAppliesWhen?.[field];
  return own ?? entry.appliesWhen ?? ["always"];
}

/** True when any one of the conditions holds: the record is "any of". */
function appliesWhenAny(
  conditions: readonly AppliesWhen[],
  context: AppliesContext
): boolean {
  // An empty record would hide the property everywhere, which no CSS
  // property does; it is read as no record at all.
  if (conditions.length === 0) return true;
  const reading = readingOf(context);
  return conditions.some(condition => CONDITIONS[condition](reading));
}

/** How a box lays out its children. */
type Layout = "flex" | "grid" | "flow";

/** The context, read once: each field `undefined` where it names nothing. */
interface Reading {
  readonly own: Layout | undefined;
  readonly parent: Layout | undefined;
  readonly wrap: string | undefined;
  readonly position: string | undefined;
  readonly replaced: boolean | undefined;
}

function readingOf(context: AppliesContext): Reading {
  return {
    own: layoutOf(context.display),
    parent: layoutOf(context.parentDisplay),
    wrap: readable(context.flexWrap),
    position: readable(context.position),
    replaced: context.replaced,
  };
}

/** Whether a layout is one of these, holding where it could not be read. */
function either(layout: Layout | undefined, kinds: readonly Layout[]): boolean {
  return layout === undefined || kinds.includes(layout);
}

/**
 * Each condition, against the reading. A total record, so a condition added
 * to {@link AppliesWhen} fails to compile here until it is answered.
 */
const CONDITIONS: Readonly<Record<AppliesWhen, (reading: Reading) => boolean>> =
  {
    always: () => true,
    "flex-container": ({ own }) => either(own, ["flex"]),
    "grid-container": ({ own }) => either(own, ["grid"]),
    "flex-or-grid-container": ({ own }) => either(own, ["flex", "grid"]),
    // A grid always has tracks to distribute; a flex container only once its
    // children wrap onto more than one line.
    "wrapping-flex-or-grid": ({ own, wrap }) =>
      either(own, ["grid"]) || (own === "flex" && wrap !== "nowrap"),
    "flex-child": ({ parent }) => either(parent, ["flex"]),
    "grid-child": ({ parent }) => either(parent, ["grid"]),
    "flex-or-grid-child": ({ parent }) => either(parent, ["flex", "grid"]),
    positioned: ({ position }) => position !== "static",
    replaced: ({ replaced }) => replaced !== false,
  };

/** How a `display` value lays out children, or `undefined` when unreadable. */
function layoutOf(display: string | undefined): Layout | undefined {
  const value = readable(display);
  if (value === undefined) return undefined;
  // By keyword, so the inline and multi-keyword forms (`inline-flex`,
  // `inline grid`) count as the container they are.
  const keywords = value.split(/\s+/);
  if (keywords.some(word => word === "flex" || word === "inline-flex")) {
    return "flex";
  }
  if (keywords.some(word => word === "grid" || word === "inline-grid")) {
    return "grid";
  }
  return "flow";
}

/** A keyword trimmed and lowercased, or `undefined` when it names nothing. */
function readable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const keyword = value.trim().toLowerCase();
  if (keyword === "" || CSS_WIDE_KEYWORDS.has(keyword)) return undefined;
  return keyword;
}
