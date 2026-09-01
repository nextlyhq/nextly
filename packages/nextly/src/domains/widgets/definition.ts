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

/**
 * Archetypes whose content comes from a data query.
 *
 * Exported, and this is the reason: the contributions channel has to make the
 * same distinction, and it got it WRONG by restating it -- requiring a query
 * for every non-`custom` archetype, which made `text` and `actions` undeclarable
 * and contradicted the rule below for the same two names. One question, one
 * implementation; a narrower view is derived from this rather than computed
 * beside it.
 */
export const DATA_ARCHETYPES = ["metric", "table", "list"] as const;

/** An archetype core draws from a query result. */
export type DataWidgetArchetype = (typeof DATA_ARCHETYPES)[number];

const DATA_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  DATA_ARCHETYPES
);

/**
 * One shortcut on an `actions` widget.
 *
 * `requiredPermission` gates the ITEM, not the card. A shortcut to something
 * the reader may not do is worse than no shortcut: it advertises a capability,
 * costs a click, and answers with a refusal screen. The card's own
 * `requiredPermission` decides whether the widget appears at all, which is a
 * different question -- a card of five shortcuts where the reader may use two
 * should show two, not disappear.
 *
 * `external` marks a destination outside the admin, which the renderer opens in
 * a new tab and marks for a screen reader. Declared rather than sniffed from
 * the href, because "is this my origin" is a question the browser answers
 * differently than the author meant -- a relative path served behind a proxy is
 * internal, and an absolute URL to the same host is still a full page load.
 */
export interface WidgetAction {
  label: string;
  href: string;
  /** Lucide icon name, resolved by the admin. */
  icon?: string;
  /** Hides this ITEM from a reader without the grant. */
  requiredPermission?: string;
  /** Opens in a new tab, and says so. */
  external?: boolean;
}

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
   *
   * A `PermissionSlug` spelling (`read-posts`), the same vocabulary
   * `WidgetSource.requiredPermission` and `PluginAdminWidget` carry.
   */
  requiredPermission?: string;
  /** Required for every data archetype; forbidden for `text` and `actions`. */
  query?: WidgetQuery;
  /** Required for `custom`; forbidden otherwise. */
  component?: string;
  /** Required for `actions`; forbidden otherwise. */
  actions?: WidgetAction[];
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

/** Confirms each of the three size fields names a real size. */
function validateSizeValues(d: Partial<WidgetDefinition>): void {
  if (!WIDGET_SIZES.includes(d.defaultSize as WidgetSize)) {
    fail(`${d.id}: defaultSize must be one of ${WIDGET_SIZES.join(", ")}`);
  }
  for (const key of ["minSize", "maxSize"] as const) {
    const value = d[key];
    if (value !== undefined && !WIDGET_SIZES.includes(value)) {
      fail(`${d.id}: ${key} must be one of ${WIDGET_SIZES.join(", ")}`);
    }
  }
}

/**
 * Confirms the size fields describe a range the widget can actually occupy.
 *
 * Two properties, not one. The bounds must not invert -- a min larger than its
 * max leaves no size at all, so every resize the user attempts fails. And the
 * DEFAULT must sit inside them: comparing only the bounds against each other
 * accepts a widget that renders at a size the user is then forbidden to return
 * it to, because `defaultSize` is where the card starts and `minSize`/`maxSize`
 * are what a resize is clamped to. Both bounds are inclusive, so a default
 * equal to either is in range.
 */
function validateSizeRange(d: Partial<WidgetDefinition>): void {
  if (d.minSize && d.maxSize && sizeRank(d.minSize) > sizeRank(d.maxSize)) {
    fail(`${d.id}: minSize (${d.minSize}) exceeds maxSize (${d.maxSize})`);
  }
  const defaultRank = sizeRank(d.defaultSize as WidgetSize);
  if (d.minSize && defaultRank < sizeRank(d.minSize)) {
    fail(
      `${d.id}: defaultSize (${d.defaultSize}) is below minSize (${d.minSize})`
    );
  }
  if (d.maxSize && defaultRank > sizeRank(d.maxSize)) {
    fail(
      `${d.id}: defaultSize (${d.defaultSize}) is above maxSize (${d.maxSize})`
    );
  }
}

/**
 * Confirms `defaultHeight`, when present, names a real height.
 *
 * `WIDGET_HEIGHTS` was enforced by the TYPE alone, which reaches a TypeScript
 * caller and nothing else -- a plugin authored in JavaScript, or one whose
 * definition arrives as parsed JSON, registered `"medium"` at boot and left the
 * grid resolving a height that does not exist. The two size fields are checked
 * against their vocabulary here; this is the third field of the same kind.
 */
function validateHeight(d: Partial<WidgetDefinition>): void {
  if (
    d.defaultHeight !== undefined &&
    !WIDGET_HEIGHTS.includes(d.defaultHeight)
  ) {
    fail(`${d.id}: defaultHeight must be one of ${WIDGET_HEIGHTS.join(", ")}`);
  }
}

/**
 * Confirms `component` is present exactly when the archetype requires it, and
 * that what is present can actually resolve.
 *
 * A `typeof` check alone accepts `""` and `"   "`, so the archetype that
 * REQUIRES a component registered without a usable one -- the broken card
 * requiring the field exists to prevent, arriving through the check meant to
 * prevent it. Trimmed rather than merely length-checked, because a path made of
 * spaces resolves no better than an empty one.
 */
function validateComponent(d: Partial<WidgetDefinition>): void {
  const isCustom = d.archetype === "custom";
  if (
    isCustom &&
    (typeof d.component !== "string" || d.component.trim() === "")
  ) {
    fail(`${d.id}: archetype "custom" requires a component path`);
  }
  if (!isCustom && d.component !== undefined) {
    fail(`${d.id}: component is only valid for archetype "custom"`);
  }
}

/**
 * Confirms `query` is present exactly where the archetype calls for one.
 *
 * BOTH directions, the way `validateComponent` above checks both. The
 * interface says "Required for every data archetype; forbidden for `text` and
 * `actions`", and enforcing only the first half let a `text` widget carry a
 * query its renderer never asks for -- accepted at registration and silently
 * inert afterwards, which is the class of mistake this validator exists to
 * catch at boot.
 *
 * `custom` is in neither set on purpose: it draws itself and may legitimately
 * want core to run its query, so the forbidden set is NAMED rather than
 * derived as "everything that is not a data archetype".
 */
/**
 * Archetypes core draws with NO query at all, exported for the same reason as
 * `DATA_ARCHETYPES` above.
 */
export const QUERYLESS_ARCHETYPES = ["text", "actions"] as const;

/** An archetype core draws without asking for data. */
export type QuerylessWidgetArchetype = (typeof QUERYLESS_ARCHETYPES)[number];

const QUERYLESS_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  QUERYLESS_ARCHETYPES
);

/**
 * Any archetype belonging to none of the three groups.
 *
 * `custom` is drawn by the plugin; the other two sets are drawn by core with
 * and without a query. Adding a name to `WIDGET_ARCHETYPES` and forgetting to
 * classify it would otherwise leave it silently outside every rule below --
 * accepted with or without a query, and undeclarable through the contributions
 * union that derives from these names.
 *
 * Asserted to be `never` in `__tests__/archetype-classification.test-d.ts`,
 * where this repo keeps its compile-time assertions, so adding an unclassified
 * archetype fails the typecheck naming it.
 */
export type UnclassifiedArchetype = Exclude<
  WidgetArchetype,
  DataWidgetArchetype | QuerylessWidgetArchetype | "custom"
>;

/**
 * An `actions` widget is its list of shortcuts, so it must have one.
 *
 * Both directions, the same reading `validateComponent` takes: an `actions`
 * widget without them describes an empty card, and any other archetype carrying
 * them describes shortcuts nothing will draw -- accepted at every layer,
 * rendering nothing, reporting nothing.
 *
 * Each item is checked for the two fields that make it a link. A label is what
 * the reader clicks and an href is where it goes; neither has a sensible
 * default, and a blank one is a shortcut that looks broken rather than absent.
 */
function validateActions(d: Partial<WidgetDefinition>): void {
  const isActions = d.archetype === "actions";

  if (!isActions) {
    if (d.actions !== undefined) {
      fail(`${d.id}: actions are only valid for archetype "actions"`);
    }
    return;
  }

  if (!Array.isArray(d.actions) || d.actions.length === 0) {
    fail(`${d.id}: archetype "actions" requires a non-empty actions array`);
  }

  d.actions.forEach((action, index) =>
    validateAction(action, `${d.id}: action #${index}`)
  );
}

/**
 * One shortcut, checked for the two fields that make it a link.
 *
 * Separate from the archetype rule above because they are different questions:
 * whether this widget should have actions at all, and whether a given action is
 * usable. A label is what the reader clicks and an href is where it goes;
 * neither has a sensible default, and a blank one is a shortcut that looks
 * broken rather than absent.
 */
function validateAction(action: WidgetAction | undefined, at: string): void {
  const problem = actionProblem(action);
  if (problem) fail(`${at} ${problem}`);
}

/**
 * What is wrong with one shortcut, or `undefined` when nothing is.
 *
 * A PREDICATE beside the throwing check, because both channels into the grid
 * need this rule and only one of them throws. `assertAdminWidgets` refuses a
 * contributed widget with its own error shape and its own message, so it cannot
 * call `validateAction` -- and restating the rule there is how the two came to
 * disagree: the registry rejected a blank label while a contributed
 * `actions: [{}]` was published and drew a link with an undefined destination.
 */
export function actionProblem(action: unknown): string | undefined {
  const candidate = action as Partial<WidgetAction> | null | undefined;
  if (typeof candidate?.label !== "string" || candidate.label.trim() === "") {
    return "requires a non-empty label";
  }
  if (typeof candidate.href !== "string" || candidate.href.trim() === "") {
    return "requires a non-empty href";
  }
  return undefined;
}

function validateQuery(d: Partial<WidgetDefinition>): void {
  const archetype = d.archetype as WidgetArchetype;
  if (DATA_ARCHETYPE_SET.has(archetype) && !d.query) {
    fail(`${d.id}: archetype "${d.archetype}" requires a query`);
  }
  if (QUERYLESS_ARCHETYPE_SET.has(archetype) && d.query !== undefined) {
    fail(
      `${d.id}: query is only valid for a data archetype or "custom", not "${d.archetype}"`
    );
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
  validateSizeValues(d);
  validateSizeRange(d);
  validateHeight(d);
  validateComponent(d);
  validateActions(d);
  validateQuery(d);
}
