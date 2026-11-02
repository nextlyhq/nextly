/**
 * A widget as the registry publishes it to the admin: the data core makes of
 * a `defineWidget` declaration (`toDefinition`), with no code in it.
 *
 * Every widget is declared, so every one is answered on the server by its
 * declaration's `load` and asked for by its card: nothing here carries a
 * query, and no archetype is drawn from one the browser holds. Validation
 * still runs where the registry stores one, so a published shape core itself
 * got wrong stops startup with a named error rather than drawing a broken card.
 *
 * @module domains/widgets/definition
 */

import { NextlyError } from "../../errors/nextly-error";

import type { WidgetAccessGate } from "./declaration/define-widget";
import { requiredPermissionSlugs } from "./gate";
import {
  sizeDeclarationProblems,
  type WidgetSizeDeclaration,
} from "./grid-size";
import {
  lifecycleProblem,
  type WidgetCondition,
  type WidgetLifecycle,
} from "./lifecycle";
import { validateWidgetSettings, type AnyWidgetSetting } from "./settings";
import type { WidgetOp } from "./sources";

/*
 * Re-exported from the contract's home so a caller reading a definition finds
 * the type of one of its fields in the same place, rather than having to know
 * which module the validation happens to live in.
 */
export type { WidgetSetting } from "./settings";

// The gate rule lives in a module with no imports so the BROWSER can read it
// too (`nextly/widget-gate`). Validation asks the same reader the gate asks,
// so a declaration this file admits is one the gate can actually use.

export {
  holdsWidgetPermission,
  requiredPermissionGroups,
  requiredPermissionSlugs,
  widgetGateHolds,
} from "./gate";

/**
 * How a widget renders: one of core's displays, drawn by core from the card's
 * answer, or `custom`, a component of the widget's own handed that answer.
 * The displays are exactly what a declared view maps onto (`CORE_VIEWS`), so
 * no archetype is published that no declaration can name.
 */
const WIDGET_ARCHETYPES = [
  "metric",
  "table",
  "list",
  // A categorical comparison, drawn as bars. Named for the SHAPE rather than
  // for `groupBy`, the op behind it: an archetype is a way of drawing, and a
  // name taken from the query would have to change if the same picture were
  // ever drawn from a different one.
  "bars",
  // A count per interval, drawn as a line, named once for the picture and its
  // op alike.
  "timeseries",
  "custom",
] as const;
export type WidgetArchetype = (typeof WIDGET_ARCHETYPES)[number];

/**
 * The archetypes core draws itself, from a card's answer: every one but
 * `custom`. Exported so core's displays (`declaration/displays.ts`) are this
 * list rather than a second one beside it.
 */
export const DATA_ARCHETYPES = [
  "metric",
  "table",
  "list",
  "bars",
  "timeseries",
] as const;

/** An archetype core draws from a card's answer. */
export type DataWidgetArchetype = (typeof DATA_ARCHETYPES)[number];

const DATA_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  DATA_ARCHETYPES
);

/**
 * The result each data archetype knows how to draw.
 *
 * Declared rather than left to the renderer, because the renderer discovers a
 * mismatch too late to say anything useful: a `metric` handed buckets returns
 * an "expected a count" body, so the card is drawn as an error on every load
 * while the declaration that caused it looks fine. Registration is where an
 * author can still be told which archetype takes which result.
 *
 * `custom` is deliberately absent. Its component receives the result whole and
 * decides what to draw, so constraining it here would be this file guessing at
 * a plugin's intent -- and the flexibility to draw something new from a new op
 * is the reason that archetype exists.
 */
export const ARCHETYPE_OPS = {
  metric: ["count"],
  table: ["list"],
  list: ["list"],
  bars: ["groupBy"],
  timeseries: ["timeseries"],
} as const satisfies Record<DataWidgetArchetype, readonly WidgetOp[]>;

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
  /**
   * What a reader may change about THIS card, per placement.
   *
   * Declared as field configs so the admin draws them with the renderer it
   * already has and a plugin author needs no new vocabulary. The stored values
   * live on the placement, not here: this is the offer, and the placement is
   * one reader's answer to it.
   *
   * Any of the eight setting types: every one reaches the declaration's `load`,
   * which reads it as it chooses.
   */
  settings?: AnyWidgetSetting[];
  /**
   * How big a card of this widget is, in grid units: the size a new card
   * starts at, and the smallest and largest a reader may resize it to.
   *
   * 🔴 The only way a widget states its size. The minimum defaults to the
   * default and the maximum to the full width at the default's height, and
   * every reader fills them through `sizeBounds`, so the registry, the layout
   * and the admin agree about a declaration that leaves an end out.
   */
  size: WidgetSizeDeclaration;
  /** Whether one dashboard may hold more than one card of this widget. */
  allowsSeveral?: boolean;
  /**
   * Which of core's displays the add panel sketches this widget's row with,
   * when it is not its archetype: a widget drawn by its own component says
   * what it most looks like.
   */
  sketch?: DataWidgetArchetype;
  /**
   * What a declared widget's empty state says and offers in place of the
   * frame's own: one line, and one action: a path relative to the admin,
   * offered only to a reader holding its `requiredPermission`, or the card's
   * own settings (`opens: "settings"`), offered where the reader can change
   * them.
   *
   * 🔴 Published by core from a declaration startup already held to the empty
   * state's rules. Whether
   * the card is empty is decided on the server, so no test travels here.
   */
  empty?: {
    message?: string;
    action?:
      | { label: string; link: string; requiredPermission?: string }
      | { label: string; opens: "settings" };
  };
  /**
   * Where this widget sits, ascending, among the declared cards the admin
   * draws while no arrangement could be read. Omitted means "after everything
   * that states one". It places nothing on the default dashboard, which is only
   * what its `defaultLayout` names; core's own widgets state none.
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
   * How long this widget stays on the dashboard. Defaults to `"always"`.
   *
   * A `conditional` widget is transient: it shows only while `visibleWhen`
   * holds, and is neither placed nor offered otherwise. Declaring it here
   * rather than deciding in the component is what stops the grid reserving a
   * slot, and an order, for a card that renders nothing.
   */
  lifecycle?: WidgetLifecycle;
  /**
   * The named condition this widget shows under. Required when conditional.
   *
   * A NAME the host evaluates, never a predicate the widget supplies. The
   * closed set lives in `lifecycle.ts` with the reasoning; the short version is
   * that a vocabulary cannot be spammed and an arbitrary hook can.
   */
  visibleWhen?: WidgetCondition | readonly WidgetCondition[];
  /**
   * Whether the dashboard takes this widget's card out of the grid while its
   * answer is empty, rather than drawing the empty state. Judged after the
   * answer arrives; a card that failed, or whose source is not available to
   * the reader, is never hidden. Customise mode still shows it, marked.
   *
   * @experimental
   */
  hidesWhenEmpty?: boolean;
  /**
   * Gates whether the CARD renders. It does NOT constrain the rows the card's
   * `load` reads -- that is the read's own job, and it is not optional there.
   *
   * A `PermissionSlug` spelling (`read-posts`), the same vocabulary
   * `WidgetSource.requiredPermission` carries.
   *
   * Spelled as a declaration's `access` gate (`WidgetAccessGate`): one slug,
   * `{ anyOf }` of several, or `{ allOf }`, whose entries are each a slug or
   * `{ anyOf }`. A list is never a gate on its own, so no gate reads as both
   * "any" and "all".
   *
   * 🔴 `{ anyOf }` exists because a single slug cannot describe the rule the
   * services behind these cards actually apply. Release authority is the
   * worked example: `ReleasesService.authorize` treats `create` or `publish` as
   * satisfying `read` -- deliberately, so a role granted only `create` can see
   * the release it just made -- and the admin's `canViewReleases` capability
   * lists all three. A card gated on the read slug alone is a THIRD encoding of
   * that rule and the only one that disagrees. `{ allOf }` is how a card needs
   * several grants together: the Team card needs a reader who may read people
   * AND may add or change them.
   */
  requiredPermission?: WidgetAccessGate;
  /**
   * Where the add panel offers this widget, when not as one card for the
   * whole dashboard.
   *
   * - Absent: placed on the default dashboard, and offered as one card.
   * - `"per-collection"`: offered only inside each collection's group of the
   *   add panel, one row per collection, a card starting with that collection
   *   as its Collection setting.
   * - `"on-request"`: offered only from the add panel, as a card a reader asks
   *   for, such as a note; nothing to show until they set it up.
   *
   * Either value keeps the widget off the default dashboard and allows any
   * number of cards, unless it says otherwise (`allowsSeveral`). One fact, so
   * the placement, the panel and the count cannot disagree.
   *
   * @experimental While the content widgets are being built.
   */
  offered?: "per-collection" | "on-request";
  /** Required for `custom`; forbidden otherwise. */
  component?: string;
  /**
   * Who declared a widget drawn by its own component, as faults name an owner (`plugin "name"`),
   * so its card can say whose component is missing in development.
   *
   * 🔴 Published by core from who declared the widget, never stated by an author.
   */
  owner?: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

// A malformed widget definition is a plugin author's mistake, not end-user
// input, so this uses `invalidInput` (message is developer-facing and safe to
// surface verbatim) rather than `validation` (structured, user-facing errors).
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget definition: ${message}`,
  });
}

/** Confirms `id` is present and shaped as `namespace/name`. */
/**
 * Whether `id` is a widget id this registry would accept.
 *
 * Exported so a caller that DERIVES an id can ask before minting one, rather
 * than restating the pattern. The dashboard generates a card per collection, and
 * a slug that cannot produce a valid id has to be skipped — a second copy of
 * this rule there would accept ids the registry refuses, or refuse ids it
 * accepts, and either way the two would drift apart silently.
 */
export function isValidWidgetId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function validateId(d: Partial<WidgetDefinition>): void {
  if (!isValidWidgetId(d.id)) {
    fail(
      `id must be namespace/name in lowercase slug form, got ${String(d.id)}`
    );
  }
}

/** The fields read as booleans, which a truthy non-boolean must not stand in for. */
const BOOLEAN_FIELDS = ["hidesWhenEmpty"] as const;

/**
 * Why a widget's title, frame or boolean fields are unusable, or `undefined`.
 *
 * A title is a STRING in every version, so this is not a vocabulary rule. Blank is permitted
 * deliberately -- `resolveTitle` trims it and falls back to the widget id -- but a non-string is a
 * different case: that helper calls `.trim()` on the value, so a number or object throws and takes
 * widget resolution down rather than rendering a differently-named card.
 *
 * The booleans are BOOLEANS in every version: there is no vocabulary here that a newer core could
 * extend, so anything else is a mistake rather than version skew. Each decides whether the admin
 * hides a card, and the admin copies a registration's fields verbatim, so a truthy non-boolean
 * such as `hidesWhenEmpty: "false"` would act on a card whose author declared the opposite. Refusing
 * the declaration is the only place that mistake is visible to the person who made it.
 */
function presentationProblem(
  widget: Record<string, unknown>
): string | undefined {
  if (widget.title !== undefined && typeof widget.title !== "string") {
    return "title, when given, must be a string";
  }
  const field = BOOLEAN_FIELDS.find(
    name => widget[name] !== undefined && typeof widget[name] !== "boolean"
  );
  return field === undefined
    ? undefined
    : `${field}, when given, must be a boolean`;
}

/**
 * Why a widget's stated size cannot be used, or `undefined`.
 *
 * The same rule on both declaration channels, through the grid size module's
 * one check: a size is whole grid units in every version, so there is no
 * newer vocabulary for a contribution to be excused for. A default outside its
 * own bounds is refused rather than drawn, since a card that starts at a size
 * its reader may not return it to has bounds that mean nothing. Only a stated
 * size is judged here; whether one is required is each channel's own rule.
 */
function sizeProblem(widget: Record<string, unknown>): string | undefined {
  if (widget.size === undefined) return undefined;
  const problems = sizeDeclarationProblems(widget.size);
  return problems.length === 0 ? undefined : problems.join("; ");
}

export function widgetValueProblem(
  widget: Record<string, unknown>
): string | undefined {
  const presented = presentationProblem(widget);
  if (presented !== undefined) return presented;

  const size = sizeProblem(widget);
  if (size !== undefined) return size;

  // Asked HERE rather than in the registration validator, because both channels
  // must answer it the same way. Left on the registration side, a plugin using
  // the contributed channel could declare a lifecycle nothing validated: the
  // summary carried the fields through and the layout server treated the card
  // as permanent, so a transient card shipped by the documented route would
  // simply never lapse -- and the author would have no refusal to read.
  const lifecycle = lifecycleProblem(widget);
  if (lifecycle !== undefined) return lifecycle;

  // A permission slug is a STRING in every version -- a newer core may mint new
  // slugs, but it cannot make a slug stop being a string -- so this is shape
  // rather than vocabulary, and it is shared by both channels. The field was
  // declared and never checked, and the gap failed OPEN: the dashboard's server
  // filter reads "not a string" as "no permission declared", so a widget whose
  // author wrote `requiredPermission: { read: true }` was gated for nobody and
  // returned to every authenticated caller. Refusing the declaration is the
  // only place the mistake is still visible to the person who made it.
  //
  // Asked through the same reader the GATE uses, rather than by restating the
  // shape here. An any-of group is a second way for a declaration to be
  // unusable -- an empty list, or one member that is not a slug -- and a
  // validator that admitted a form the gate then refuses would hide a card
  // with no error anywhere.
  if (
    widget.requiredPermission !== undefined &&
    requiredPermissionSlugs(widget.requiredPermission) === undefined
  ) {
    return "requiredPermission, when given, must be a permission slug, { anyOf: [...] } of a non-empty list of them, or { allOf: [...] } whose entries are each a slug or { anyOf: [...] }";
  }

  // An archetype is a STRING in every version; which ones this core knows is
  // `validateArchetype`'s question, asked after this.
  if (widget.archetype !== undefined && typeof widget.archetype !== "string") {
    return "archetype, when given, must be a string";
  }
  return undefined;
}

function validateTitle(d: Partial<WidgetDefinition>): void {
  // Channel-specific, and deliberately not shared. This is the RESOLVED widget,
  // so a blank title is a card labelled with whitespace. A contribution is a
  // declaration: `resolveTitle` trims it and falls back to the id, so the same
  // value renders a correctly named card there and refusing it would turn a
  // working card into a failed plugin install.
  // REQUIRED and non-blank here, because this is the RESOLVED widget and a
  // blank title is a card labelled with whitespace. That a supplied value is a
  // string is the shared rule's, since it holds on both sides.
  if (
    d.title === undefined ||
    (typeof d.title === "string" && d.title.trim() === "")
  ) {
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
 * Confirms the widget states a size.
 *
 * Registry-only: this is the resolved widget, and a card with no size has
 * nowhere on the grid to start. A contribution may leave it out, and its
 * summary reads that as the default every reader shares. What a stated size
 * must be is the shared rule's (`sizeProblem`), asked before this.
 */
function validateSize(d: Partial<WidgetDefinition>): void {
  if (d.size === undefined) {
    fail(`${d.id}: size is required, as { default: { w, h }, min?, max? }`);
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
 * Any archetype that is neither one of core's displays nor `custom`.
 *
 * `custom` is drawn by the widget's own component and every other archetype by
 * core, from the card's answer. Adding a name to `WIDGET_ARCHETYPES` that no
 * display draws would publish an archetype no declared view maps onto, and no
 * card could ever be drawn by it.
 *
 * Asserted to be `never` in `__tests__/archetype-classification.test-d.ts`,
 * where this repo keeps its compile-time assertions, so adding an unclassified
 * archetype fails the typecheck naming it.
 */
export type UnclassifiedArchetype = Exclude<
  WidgetArchetype,
  DataWidgetArchetype | "custom"
>;

/**
 * Why this value cannot serve as a `defaultOrder`, or `undefined`.
 *
 * A JavaScript author could otherwise publish `defaultOrder: "soon"`, and the admin's
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
function defaultOrderProblem(value: unknown): string | undefined {
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

/** Why an optional value is outside its closed set, or nothing when it is absent or inside. */
function closedValueProblem(
  name: string,
  value: unknown,
  allowed: readonly string[]
): string | undefined {
  if (value === undefined || allowed.includes(value as string))
    return undefined;
  return `has ${name} ${JSON.stringify(value)}, which is not one of ${allowed.join(", ")}`;
}

/**
 * Confirms `allowsSeveral` and `sketch`, when stated, are values the add panel
 * can act on: a boolean, and one of the displays core draws.
 */
function validateOfferTerms(d: Partial<WidgetDefinition>): void {
  if (d.allowsSeveral !== undefined && typeof d.allowsSeveral !== "boolean") {
    fail(`${d.id}: allowsSeveral must be true or false`);
  }
  if (d.sketch !== undefined && !DATA_ARCHETYPE_SET.has(d.sketch)) {
    fail(`${d.id}: sketch must be one of ${DATA_ARCHETYPES.join(", ")}`);
  }
}

/**
 * Confirms `empty`, when stated, has its shape.
 *
 * Its words and link were judged at startup by the empty state's own rules;
 * the shape is checked again here as a guard over values already in hand.
 */
function validateEmpty(d: Partial<WidgetDefinition>): void {
  const empty: unknown = d.empty;
  if (empty === undefined) return;
  const { message, action } = empty as { message?: unknown; action?: unknown };
  if (
    (message !== undefined && !isText(message)) ||
    !emptyActionIsText(action)
  ) {
    fail(`${d.id}: empty has a message or an action that is not text`);
  }
}

/** Words a person reads: a string with something in it. */
const isText = (value: unknown) =>
  typeof value === "string" && value.trim() !== "";

/**
 * An empty state's action, when stated: a label, each of them text, and either a link that is
 * text or `opens: "settings"`.
 */
function emptyActionIsText(action: unknown): boolean {
  if (action === undefined) return true;
  if (typeof action !== "object" || action === null) return false;
  const { label, link, opens } = action as {
    label?: unknown;
    link?: unknown;
    opens?: unknown;
  };
  return isText(label) && (opens === "settings" || isText(link));
}

/**
 * Whether a definition declares a Collection setting. Read defensively:
 * malformed settings are the settings rule's to refuse by name, so here they
 * simply declare none.
 */
function declaresCollectionSetting(settings: unknown): boolean {
  return (
    Array.isArray(settings) &&
    settings.some(
      (setting: unknown) =>
        typeof setting === "object" &&
        setting !== null &&
        (setting as { type?: unknown }).type === "collection"
    )
  );
}

/** The modes `offered` may name, the closed list its type spells. */
const OFFERED_MODES = [
  "per-collection",
  "on-request",
] as const satisfies readonly NonNullable<WidgetDefinition["offered"]>[];

/**
 * Why an `offered` mode cannot work, or `undefined`: a mode outside its closed
 * list, or a widget offered per collection that declares no Collection
 * setting: its add-panel rows each start a card set to a collection, so
 * without one the widget could be added nowhere.
 *
 * Exported so a declared widget is judged at startup by this same rule, before
 * any widget is kept, rather than refused half way through registering.
 */
export function offeredProblem(d: {
  offered?: unknown;
  settings?: unknown;
}): string | undefined {
  // An untyped registration with a misspelt mode would otherwise be read as an
  // ordinary widget: placed by default, perhaps with no collection to read.
  const outside = closedValueProblem("offered", d.offered, OFFERED_MODES);
  if (outside !== undefined) return outside;
  if (
    d.offered === "per-collection" &&
    !declaresCollectionSetting(d.settings)
  ) {
    return "a widget offered per collection needs a Collection setting, which each card starts set to";
  }
  return undefined;
}

/** Refuses a definition whose `offered` mode cannot work (`offeredProblem`). */
function validateOffered(d: Partial<WidgetDefinition>): void {
  const problem = offeredProblem(d);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/** Throws with a named reason if `def` is not a usable definition. */
export function validateWidgetDefinition(
  def: unknown
): asserts def is WidgetDefinition {
  if (typeof def !== "object" || def === null) fail("expected an object");
  const d = def as Partial<WidgetDefinition>;

  validateId(d);
  // The rules on a field's value, asked once before the shape rules.
  const valueProblem = widgetValueProblem(d);
  if (valueProblem !== undefined) fail(`${d.id}: ${valueProblem}`);

  validateTitle(d);
  validateArchetype(d);
  validateSize(d);
  validateComponent(d);
  validateOfferTerms(d);
  validateEmpty(d);
  validateOffered(d);
  validateDefaultOrder(d);
  // Every published widget's settings reach its declaration's `load`, which
  // reads them as it chooses, so each is judged as one core's own query reads.
  validateWidgetSettings(d.settings, d.id ?? "widget", true);
}
