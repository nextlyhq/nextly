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
  /**
   * Where this widget sits by default, ascending. Omitted means "after
   * everything that states one".
   *
   * The DECLARED default, not the reader's own arrangement -- a stored layout
   * carries its own order per placement and wins over this. It exists because
   * position was otherwise an accident of which CHANNEL a widget arrived
   * through: the resolver reads contributions before registrations, so a card
   * moved across the grid when its author switched from one to the other
   * without changing anything about the card.
   *
   * A number rather than an index, so inserting between two neighbours does not
   * renumber them. Any finite value is legal, negatives and fractions included.
   */
  defaultOrder?: number;
  /**
   * Whether the host frames this widget. Defaults to `"card"`.
   *
   * Only a `custom` widget may decline the frame, because only a `custom`
   * widget supplies the component that would replace it. For every archetype
   * core draws, the card IS the surface the body is composed against -- it owns
   * the title, the footer and the busy state -- so an unframed one would render
   * content with no heading and nothing to report its own loading.
   */
  chrome?: WidgetChrome;
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
/**
 * Why a widget's field VALUES are unusable, or `undefined`.
 *
 * The rules that hold identically whichever channel a widget arrives by, in one
 * place because they kept being written in two. Four fields have already
 * drifted this way -- the shortcut rule, the queryless no-query rule,
 * `defaultOrder` and `chrome` -- each added to one validator, missed by the
 * other, and each time the contributed side was the more permissive, which is
 * the direction that ships.
 *
 * SHAPE is deliberately not here, because the two channels genuinely disagree
 * about it: a contribution may omit `title` and `defaultSize`, which resolution
 * fills in, while a `WidgetDefinition` is the resolved widget and requires
 * both. Those differences belong to their own validators and are listed by name
 * in `plugins/__tests__/channel-divergence.test.ts`. What is here is only what
 * neither channel has a reason to read differently.
 *
 * Takes a loose record rather than a `Partial<WidgetDefinition>`, so a decoded
 * JSON object can ask it without either side casting to the other's shape.
 */
export function widgetValueProblem(
  widget: Record<string, unknown>
): string | undefined {
  // An unknown size is the sharpest of these: `widgetSpanClass` falls back to
  // full width, so the card silently spans the grid rather than reporting
  // anything an author could search for.
  for (const key of ["defaultSize", "minSize", "maxSize"] as const) {
    const value = widget[key];
    if (value !== undefined && !WIDGET_SIZES.includes(value as WidgetSize)) {
      return `${key} must be one of ${WIDGET_SIZES.join(", ")}`;
    }
  }

  const rangeProblem = sizeRangeProblem(widget);
  if (rangeProblem !== undefined) return rangeProblem;

  if (
    widget.defaultHeight !== undefined &&
    !WIDGET_HEIGHTS.includes(widget.defaultHeight as WidgetHeight)
  ) {
    return `defaultHeight must be one of ${WIDGET_HEIGHTS.join(", ")}`;
  }

  // `actions` belongs to the archetype named for it. Elsewhere the admin never
  // reads the array, so declaring one is a shortcut list the author believes
  // they published and nobody can reach.
  //
  // Only when this core RECOGNISES the archetype. The rule is a statement about
  // a vocabulary, so applying it to a name from a newer core judges a shape
  // this core has never seen -- and refusing there aborts the whole plugin
  // install in exactly the version-skew case unknown archetypes are tolerated
  // for. The registry never meets one, because it refuses unknown archetypes
  // outright; the contributions channel does, deliberately.
  if (
    widget.actions !== undefined &&
    typeof widget.archetype === "string" &&
    WIDGET_ARCHETYPES.includes(widget.archetype as WidgetArchetype) &&
    widget.archetype !== "actions"
  ) {
    return 'actions are only valid for archetype "actions"';
  }

  return undefined;
}

/** The ordering rules between the three sizes, once each is known to be valid. */
function sizeRangeProblem(widget: Record<string, unknown>): string | undefined {
  const min = widget.minSize as WidgetSize | undefined;
  const max = widget.maxSize as WidgetSize | undefined;
  const dflt = widget.defaultSize as WidgetSize | undefined;

  if (min && max && sizeRank(min) > sizeRank(max)) {
    return `minSize (${min}) exceeds maxSize (${max})`;
  }
  // Only when a default is present. A contribution may omit it, and comparing
  // an absent size against a bound would refuse a declaration that is complete
  // by its own contract.
  if (dflt === undefined) return undefined;
  if (min && sizeRank(dflt) < sizeRank(min)) {
    return `defaultSize (${dflt}) is below minSize (${min})`;
  }
  if (max && sizeRank(dflt) > sizeRank(max)) {
    return `defaultSize (${dflt}) is above maxSize (${max})`;
  }
  return undefined;
}

function validateTitle(d: Partial<WidgetDefinition>): void {
  // Channel-specific, and deliberately not shared. This is the RESOLVED widget,
  // so a blank title is a card labelled with whitespace. A contribution is a
  // declaration: `resolveTitle` trims it and falls back to the id, so the same
  // value renders a correctly named card there and refusing it would turn a
  // working card into a failed plugin install.
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
  // REQUIRED here; the vocabulary check for all three is the shared rule's.
  if (d.defaultSize === undefined) {
    fail(`${d.id}: defaultSize must be one of ${WIDGET_SIZES.join(", ")}`);
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

/**
 * Confirms `defaultHeight`, when present, names a real height.
 *
 * `WIDGET_HEIGHTS` was enforced by the TYPE alone, which reaches a TypeScript
 * caller and nothing else -- a plugin authored in JavaScript, or one whose
 * definition arrives as parsed JSON, registered `"medium"` at boot and left the
 * grid resolving a height that does not exist. The two size fields are checked
 * against their vocabulary here; this is the third field of the same kind.
 */

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

/**
 * Whether the HOST frames a widget, or the widget draws its own surface.
 *
 * `"card"` is the default and the only value most widgets want: the host draws
 * the standard card and the widget supplies a body, so every card on the
 * dashboard shares one anatomy, one busy state and one place its title lives.
 *
 * `"none"` is for a widget that IS already a designed surface -- core's own
 * dashboard sections carry their own heading and rules, and framing one draws a
 * second heading around the first. The distinction Backstage draws between a
 * framed `InfoCard` and bare `Content`.
 */
export const WIDGET_CHROME = ["card", "none"] as const;

/** How a widget is framed. See {@link WIDGET_CHROME}. */
export type WidgetChrome = (typeof WIDGET_CHROME)[number];

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

  // The misplacement case is the shared rule's; what is left here is the
  // requirement that an `actions` widget actually carries some.
  if (!isActions) return;

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

/**
 * Why a queryless archetype may not carry this `query`, or `undefined`.
 *
 * The non-throwing half of a rule {@link validateQuery} also enforces, exported
 * for the same reason {@link actionProblem} is: the CONTRIBUTIONS channel needs
 * the identical answer without a throw, and one rule spelled twice is exactly
 * how the two channels came to disagree. The registry refused a query on an
 * `actions` widget while a contributed one carrying the same query passed boot
 * -- and since core draws `actions` from the declaration, the admin then issued
 * a batched read on every mount and refetch whose result the declared renderer
 * never looks at.
 *
 * Takes the two values rather than a definition, so both a validated
 * `WidgetDefinition` and a decoded JSON object can ask it without either side
 * casting to the other's shape.
 */
export function querylessQueryProblem(
  archetype: unknown,
  query: unknown
): string | undefined {
  if (typeof archetype !== "string") return undefined;
  if (!QUERYLESS_ARCHETYPE_SET.has(archetype as WidgetArchetype)) {
    return undefined;
  }
  if (query === undefined) return undefined;
  return `query is only valid for a data archetype or "custom", not "${archetype}"`;
}

/**
 * `defaultOrder`, when stated, must be a finite number.
 *
 * `Number.isFinite` rather than a `typeof` check alone, and it is reachable
 * rather than defensive: `1e400` is valid JSON that parses to `Infinity`, so a
 * decoded plugin manifest can carry one without any code having written it. An
 * infinite sort key cannot be diagnosed from the grid -- it pins the card to one
 * end and compares equal to every other infinity, so two of them order
 * arbitrarily against each other.
 */
/**
 * `chrome`, when stated, must be in the vocabulary -- and `"none"` only on
 * `custom`.
 *
 * The archetype restriction is the load-bearing half. Accepting `"none"` on an
 * archetype core draws would be a validated option that produces a broken card
 * rather than a refusal: the body renders with no heading and no owner for its
 * loading and error states, and nothing anywhere says why.
 */
/**
 * Why this `chrome` cannot stand beside this `archetype`, or `undefined`.
 *
 * Non-throwing and exported, like {@link actionProblem},
 * {@link querylessQueryProblem} and {@link defaultOrderProblem}: the
 * CONTRIBUTIONS channel needs the same answer without a throw. Every one of
 * those four was added to one validator and missed by the other, and each time
 * the contributed value was the more permissive of the two.
 *
 * The archetype half is the load-bearing one. Accepting `"none"` on an
 * archetype core draws would be a validated option producing a broken card
 * rather than a refusal: the body renders with no heading and nothing owning
 * its loading and error states, and nothing anywhere says why.
 */
export function chromeProblem(
  chrome: unknown,
  archetype: unknown
): string | undefined {
  if (chrome === undefined) return undefined;

  if (!WIDGET_CHROME.includes(chrome as WidgetChrome)) {
    return `chrome must be one of ${WIDGET_CHROME.join(", ")}`;
  }

  if (chrome === "none" && archetype !== "custom") {
    return `chrome "none" is only valid for archetype "custom", not "${String(archetype)}" -- core draws that body into the card itself`;
  }

  return undefined;
}

function validateChrome(d: Partial<WidgetDefinition>): void {
  const problem = chromeProblem(d.chrome, d.archetype);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/**
 * Why this value cannot serve as a `defaultOrder`, or `undefined`.
 *
 * Non-throwing and exported for the same reason {@link actionProblem} and
 * {@link querylessQueryProblem} are: the CONTRIBUTIONS channel needs the same
 * answer without a throw. That channel had no order check at all, so a
 * JavaScript plugin could publish `defaultOrder: "soon"`, and the admin's
 * comparator turned it into `NaN` -- which compares false against everything,
 * so the widget sorted as equal to whatever it met and every explicit order
 * around it stopped meaning anything. Silently, and only sometimes, depending
 * on the order the array happened to arrive in.
 *
 * `Number.isFinite` rather than a `typeof` check alone, and it is reachable
 * rather than defensive: `1e400` is valid JSON that parses to `Infinity`, so a
 * decoded manifest carries one without any code having written it. The sort
 * uses infinity as its "stated nothing" sentinel, so an infinite ORDER would
 * tie with every widget that declared none.
 */
export function defaultOrderProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "defaultOrder must be a finite number";
  }
  return undefined;
}

function validateDefaultOrder(d: Partial<WidgetDefinition>): void {
  const problem = defaultOrderProblem(d.defaultOrder);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

function validateQuery(d: Partial<WidgetDefinition>): void {
  const archetype = d.archetype as WidgetArchetype;
  if (DATA_ARCHETYPE_SET.has(archetype) && !d.query) {
    fail(`${d.id}: archetype "${d.archetype}" requires a query`);
  }
  const problem = querylessQueryProblem(archetype, d.query);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/** Throws with a named reason if `def` is not a usable definition. */
export function validateWidgetDefinition(
  def: unknown
): asserts def is WidgetDefinition {
  if (typeof def !== "object" || def === null) fail("expected an object");
  const d = def as Partial<WidgetDefinition>;

  validateId(d);
  // The rules neither channel reads differently, asked once.
  const valueProblem = widgetValueProblem(d);
  if (valueProblem !== undefined) fail(`${d.id}: ${valueProblem}`);

  validateTitle(d);
  validateArchetype(d);
  validateSizeValues(d);
  validateComponent(d);
  validateActions(d);
  validateQuery(d);
  validateDefaultOrder(d);
  validateChrome(d);
}
