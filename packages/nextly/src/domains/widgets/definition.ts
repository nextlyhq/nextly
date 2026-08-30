/**
 * What a widget IS, as data the host can read without executing the plugin
 * that declared it.
 *
 * Validation lives at registration (the blocks-engine pattern): a malformed
 * definition fails at boot with a named error rather than rendering a broken
 * card later, when the declaration still looks correct.
 *
 * @module domains/widgets/definition
 */

import { NextlyError } from "../../errors/nextly-error";

import type { WidgetQuery } from "./query";

/** Column span at the large breakpoint, as a named step rather than a number. */
export const WIDGET_SIZES = ["sm", "md", "lg", "xl", "full"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

/** Vertical step. Two values, because ragged card bottoms are the tell of a cheap grid. */
export const WIDGET_HEIGHTS = ["short", "tall"] as const;
export type WidgetHeight = (typeof WIDGET_HEIGHTS)[number];

/**
 * How a widget renders. Every archetype but `custom` is drawn by core from the
 * query result, so it inherits the card anatomy, the loading and empty states,
 * the theme tokens and the accessibility work for free.
 */
export const WIDGET_ARCHETYPES = [
  "metric",
  "table",
  "list",
  "text",
  "actions",
  "custom",
] as const;
export type WidgetArchetype = (typeof WIDGET_ARCHETYPES)[number];

/** Archetypes whose content comes from a data query. */
const DATA_ARCHETYPES: ReadonlySet<WidgetArchetype> = new Set([
  "metric",
  "table",
  "list",
]);

export interface WidgetDefinition {
  /** `namespace/name`, e.g. "core/recent-entries". */
  id: string;
  title: string;
  description?: string;
  /** Lucide icon name, resolved by the admin. */
  icon?: string;
  /** Groups the widget in the "add widget" picker. */
  category?: string;
  archetype: WidgetArchetype;
  defaultSize: WidgetSize;
  /** Bounds what a user may resize to. Omitted means unconstrained. */
  minSize?: WidgetSize;
  maxSize?: WidgetSize;
  defaultHeight?: WidgetHeight;
  /**
   * Gates whether the CARD renders. It does NOT constrain the rows the query
   * returns -- that is `execute`'s job, and it is not optional there.
   */
  requiredPermission?: string;
  /** Required for every data archetype; forbidden for `text` and `actions`. */
  query?: WidgetQuery;
  /** Required for `custom`; forbidden otherwise. */
  component?: string;
  /** Where a "view all" footer link points. */
  link?: { label: string; href: string };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

function sizeRank(size: WidgetSize): number {
  return WIDGET_SIZES.indexOf(size);
}

// A malformed widget definition is a plugin author's mistake, not end-user
// input, so this uses `invalidInput` (message is developer-facing and safe to
// surface verbatim) rather than `validation` (structured, user-facing errors).
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget definition: ${message}`,
  });
}

/** Confirms `id` is present and shaped as `namespace/name`. */
function validateId(d: Partial<WidgetDefinition>): void {
  if (typeof d.id !== "string" || !ID_PATTERN.test(d.id)) {
    fail(
      `id must be namespace/name in lowercase slug form, got ${String(d.id)}`
    );
  }
}

/** Confirms `title` carries real, non-whitespace text. */
function validateTitle(d: Partial<WidgetDefinition>): void {
  if (typeof d.title !== "string" || d.title.trim() === "") {
    fail(`${d.id}: title is required`);
  }
}

/** Confirms `archetype` is one of the known values. */
function validateArchetype(d: Partial<WidgetDefinition>): void {
  if (!WIDGET_ARCHETYPES.includes(d.archetype as WidgetArchetype)) {
    fail(`${d.id}: archetype must be one of ${WIDGET_ARCHETYPES.join(", ")}`);
  }
}

/**
 * Confirms `defaultSize`, `minSize` and `maxSize` are each a real size and
 * that the bounds do not invert -- a min larger than its max would make every
 * resize the user attempts fail.
 */
function validateSizes(d: Partial<WidgetDefinition>): void {
  if (!WIDGET_SIZES.includes(d.defaultSize as WidgetSize)) {
    fail(`${d.id}: defaultSize must be one of ${WIDGET_SIZES.join(", ")}`);
  }
  for (const key of ["minSize", "maxSize"] as const) {
    const value = d[key];
    if (value !== undefined && !WIDGET_SIZES.includes(value)) {
      fail(`${d.id}: ${key} must be one of ${WIDGET_SIZES.join(", ")}`);
    }
  }
  if (d.minSize && d.maxSize && sizeRank(d.minSize) > sizeRank(d.maxSize)) {
    fail(`${d.id}: minSize (${d.minSize}) exceeds maxSize (${d.maxSize})`);
  }
}

/** Confirms `component` is present exactly when the archetype requires it. */
function validateComponent(d: Partial<WidgetDefinition>): void {
  const isCustom = d.archetype === "custom";
  if (isCustom && typeof d.component !== "string") {
    fail(`${d.id}: archetype "custom" requires a component path`);
  }
  if (!isCustom && d.component !== undefined) {
    fail(`${d.id}: component is only valid for archetype "custom"`);
  }
}

/** Confirms `query` is present for every archetype whose content comes from data. */
function validateQuery(d: Partial<WidgetDefinition>): void {
  if (DATA_ARCHETYPES.has(d.archetype as WidgetArchetype) && !d.query) {
    fail(`${d.id}: archetype "${d.archetype}" requires a query`);
  }
}

/** Throws with a named reason if `def` is not a usable definition. */
export function validateWidgetDefinition(
  def: unknown
): asserts def is WidgetDefinition {
  if (typeof def !== "object" || def === null) fail("expected an object");
  const d = def as Partial<WidgetDefinition>;

  validateId(d);
  validateTitle(d);
  validateArchetype(d);
  validateSizes(d);
  validateComponent(d);
  validateQuery(d);
}
