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

import { requiredPermissionSlugs } from "./gate";
import type { WidgetQuery } from "./query";

// The gate rule lives in a module with no imports so the BROWSER can read it
// too (`nextly/widget-gate`). Validation asks the same reader the gate asks,
// so a declaration this file admits is one the gate can actually use.

export {
  holdsWidgetPermission,
  requiredPermissionSlugs,
  widgetGateHolds,
} from "./gate";

/** Column span at the large breakpoint, as a named step rather than a number. */
export const WIDGET_SIZES = ["sm", "md", "lg", "xl", "full"] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

/**
 * The deprecated `size?: "full" | "half"` alias, as a real size.
 *
 * Contributed declarations still carry it, and `half` meant "6 of 12" -- which
 * is `lg` in the enum.
 *
 * 🔴 It lives HERE, beside the vocabulary it translates into, rather than in
 * the admin where it was first written. Both the admin's resolver and the
 * server's canonical summary have to read a legacy declaration, and the second
 * one did not: it read `defaultSize` only, so a contribution declaring the alias
 * produced a default placement with NO size while the grid rendered it at half
 * width. The first save then stored an arrangement whose geometry disagreed
 * with what the reader was looking at. One translation, asked by both.
 */
export function legacySizeToWidgetSize(
  size: "full" | "half" | undefined
): WidgetSize {
  return size === "half" ? "lg" : "full";
}

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
  // Several labelled, clickable numbers. Named "stats" rather than the obvious
  // "metrics", and the near-miss is the reason: `metric` and `metrics` differ by
  // one character, both are valid members of this union, and confusing them
  // draws ONE number where six were declared -- a card that looks finished and
  // answers a narrower question than it claims. A name that cannot be reached
  // by a typo from an existing one costs nothing and removes that.
  "stats",
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

/**
 * Archetypes drawn from MANY queries, declared as `cells`.
 *
 * 🔴 A third vocabulary rather than a member of either existing one, because
 * both would be a lie in a way that reaches real code. `DATA_ARCHETYPES` means
 * "requires the singular `query` field", and a `stats` card declaring one would
 * be refused. `QUERYLESS_ARCHETYPES` means "requires no data at all" -- the
 * admin derives its `DeclaredBody` dispatch from it, the kind of body that
 * never enters the batch and waits for no slot -- and a `stats` card placed
 * there would be drawn from its declaration with its numbers never fetched.
 *
 * The two names have agreed until now because no archetype needed data without
 * using `query`. `stats` is the first, so it gets its own name rather than
 * being filed under whichever existing one is closer.
 */
export const CELL_ARCHETYPES = ["stats"] as const;

/** An archetype core draws from several query results. */
export type CellWidgetArchetype = (typeof CELL_ARCHETYPES)[number];

const CELL_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  CELL_ARCHETYPES
);

/** An archetype core draws from a query result. */
export type DataWidgetArchetype = (typeof DATA_ARCHETYPES)[number];

const DATA_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  DATA_ARCHETYPES
);

/**
 * How many numbers one `stats` card may declare.
 *
 * A bound rather than a style note. Each cell is its OWN count query, so a card
 * declaring thirty would consume the entire batch (`MAX_QUERIES_PER_REQUEST`)
 * and leave every other widget on the dashboard without a slot -- one card
 * silently darkening the rest of the page. Eight also happens to be past the
 * point a row of numbers can be read at a glance, which is what the card is
 * for, so the readable limit and the affordable one agree.
 */
export const MAX_STAT_CELLS = 8;

/**
 * One number on a `stats` card.
 *
 * 🔴 Each cell carries its OWN query rather than the card carrying one query
 * that returns several numbers. The difference is access control: a cell is an
 * ordinary `count` against an ordinary source, so it is judged by the same rule
 * every other widget query is judged by, and a reader who may not read one of
 * the collections simply loses that number. A single composite query would need
 * a source that knows about every domain it counts -- and one authorization
 * decision covering all of them, which is the second implementation this domain
 * exists to avoid.
 *
 * `link` is per CELL, not per card. The point of the card is that every number
 * navigates: "14 drafts" goes to the drafts, not to the collection's front page.
 */
export interface WidgetStatCell {
  /** Identifies this cell's answer within the card. Unique across the card. */
  key: string;
  /** What the number is called, beneath it. */
  label: string;
  /**
   * 🔴 A COUNT, narrowed in the type and checked at registration. The card
   * draws one number per cell and refuses any other result shape, so a `list`
   * here would pass validation, reach the source, succeed, and then render a
   * muted dash forever -- a declaration mistake wearing the appearance of
   * unavailable data, which is the one reading nobody investigates.
   */
  query: WidgetQuery & { op: "count" };
  /** Where this number navigates. A cell without one draws as plain text. */
  link?: { label: string; href: string };
}

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
   *
   * 🔴 An ARRAY means ANY-OF, and it exists because a single slug cannot
   * describe the rule the services behind these cards actually apply. Release
   * authority is the worked example: `ReleasesService.authorize` treats `create`
   * or `publish` as satisfying `read` -- deliberately, so a role granted only
   * `create` can see the release it just made -- and the admin's
   * `canViewReleases` capability lists all three. A card gated on the read slug
   * alone is a THIRD encoding of that rule and the only one that disagrees, so
   * the reader can open the releases screen and never see its dashboard card.
   *
   * Any-of rather than all-of because that is the shape every consumer of this
   * vocabulary already has -- `requireAnyPermission` at the route layer, the
   * capability lists in the admin. A card needing all of several grants has no
   * consumer yet, and inventing the second form before something needs it is
   * how a declaration ends up with two meanings nobody can keep straight.
   *
   * `WidgetAction.requiredPermission` stays a single slug. It gates one
   * shortcut rather than a card, and nothing has asked it for more.
   */
  requiredPermission?: string | readonly string[];
  /** Required for every data archetype; forbidden for `text` and `actions`. */
  query?: WidgetQuery;
  /** Required for `custom`; forbidden otherwise. */
  component?: string;
  /** Required for `actions`; forbidden otherwise. */
  actions?: WidgetAction[];
  /** Required for `stats`; forbidden otherwise. */
  cells?: WidgetStatCell[];
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
/**
 * How this core should treat a declaration's `archetype`.
 *
 * FOUR states, not two. Gating rules on "is it a string this core knows" folded
 * the other three together and each one leaked a defect: an ABSENT archetype
 * became `custom` during resolution but skipped every rule that names one; a
 * NON-STRING skipped them too and reached the admin, which interpolates it into
 * a diagnostic; and an UNKNOWN string was exempted from shape rules when the
 * exemption it earns is only from vocabulary ones.
 */
type ArchetypeStanding =
  /** Not supplied. Resolution deterministically fills in `custom`. */
  | { kind: "resolved-custom" }
  /** A name this core knows, so every rule about it applies. */
  | { kind: "known"; name: WidgetArchetype }
  /** A name from a newer core. Exempt from VOCABULARY rules, not from shape. */
  | { kind: "newer" }
  /** Not a string at all, which no version of this contract permits. */
  | { kind: "invalid" };

function archetypeStanding(value: unknown): ArchetypeStanding {
  if (value === undefined) return { kind: "resolved-custom" };
  if (typeof value !== "string") return { kind: "invalid" };
  return WIDGET_ARCHETYPES.includes(value as WidgetArchetype)
    ? { kind: "known", name: value as WidgetArchetype }
    : { kind: "newer" };
}

/**
 * Why a widget's declared geometry is the wrong SHAPE, or `undefined`.
 *
 * `defaultSize` and `defaultHeight` are strings in every version, and a blank
 * one names nothing in any of them -- so this is a shape rule rather than a
 * vocabulary rule, shared by both declaration channels, and an unknown value
 * like `"xxl"` still passes. That is the distinction that lets it live outside
 * the registry: a contribution may come from a plugin built against a newer
 * core, and refusing an unfamiliar size would drop a card over a value the
 * admin already survives.
 *
 * Blank is REFUSED rather than read as absent, because the two channels
 * disagreed about which it was. The server's summary reader treats `""` as
 * unstated and falls back to the deprecated `size` alias; the admin's resolver
 * uses `??`, for which `""` is present, and keeps it -- so a declaration
 * carrying `defaultSize: ""` beside `size: "half"` was stored as `lg` and drawn
 * full width, and the card changed width when the arrangement arrived and
 * changed back when it was re-added. Refusing the declaration is the only place
 * that mistake is still visible to the author who made it.
 *
 * A non-string height is the same hole one field over: it reached the resolved
 * widget, and re-adding that card copied it into a placement the next write
 * refuses -- an ordinary edit turned into a draft that could never be saved.
 */
function geometryShapeProblem(
  widget: Record<string, unknown>
): string | undefined {
  for (const field of ["defaultSize", "defaultHeight"] as const) {
    const value = widget[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      return `${field}, when given, must be a string`;
    }
    if (value === "") return `${field}, when given, must not be empty`;
  }
  return undefined;
}

export function widgetValueProblem(
  widget: Record<string, unknown>
): string | undefined {
  // A title is a STRING in every version, so this is not a vocabulary rule.
  // Blank is permitted deliberately -- `resolveTitle` trims it and falls back
  // to the widget id -- but a non-string is a different case: that helper calls
  // `.trim()` on the value, so a number or object throws and takes widget
  // resolution down rather than rendering a differently-named card.
  if (widget.title !== undefined && typeof widget.title !== "string") {
    return "title, when given, must be a string";
  }

  // Chrome is a STRING in every version. Moving the closed-vocabulary check to
  // the registry took the shape check with it, so `chrome: 42` was published as
  // a `WidgetChrome` -- and the renderer treats anything but `"none"` as
  // `"card"`, so it renders and boot says nothing about a configuration its
  // author got wrong. Unknown STRING values still pass, which is the version
  // skew this boundary exists for.
  if (widget.chrome !== undefined && typeof widget.chrome !== "string") {
    return "chrome, when given, must be a string";
  }

  const geometry = geometryShapeProblem(widget);
  if (geometry !== undefined) return geometry;

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
  // shape here. Widening this to accept an any-of array added a second way for
  // a declaration to be unusable -- an empty array, or one member that is not a
  // slug -- and a validator that admitted a form the gate then refuses would
  // hide a card with no error anywhere.
  if (
    widget.requiredPermission !== undefined &&
    requiredPermissionSlugs(widget.requiredPermission) === undefined
  ) {
    return "requiredPermission, when given, must be a permission slug or a non-empty array of them";
  }

  // A query is an OBJECT in every version, so it belongs here rather than
  // beside the body checks. There it was reachable only when the query had to
  // establish a body, so a widget shipping a component skipped it -- and the
  // admin put the malformed value in the batched request regardless.
  if (
    widget.query !== undefined &&
    (typeof widget.query !== "object" || widget.query === null)
  ) {
    return "query must be an object";
  }

  const rangeProblem = sizeRangeProblem(widget);
  if (rangeProblem !== undefined) return rangeProblem;

  return archetypeRelatedProblem(widget);
}

/**
 * The rules that depend on what the archetype is, per its standing.
 *
 * The split that matters: a newer core's archetype is exempt from VOCABULARY
 * rules -- this core cannot judge where its payload belongs -- but not from
 * SHAPE. `resolveOne` calls `readableActions` for every archetype whatever its
 * name, and that immediately calls `.filter`, so a non-array `actions` throws
 * during resolution and takes the whole grid down before the unknown-card
 * fallback can draw. Container shape is version-independent; placement is not.
 */
function archetypeRelatedProblem(
  widget: Record<string, unknown>
): string | undefined {
  const standing = archetypeStanding(widget.archetype);

  if (standing.kind === "invalid") {
    return "archetype, when given, must be a string";
  }

  // Shape first, and for every standing including a newer core's -- one level
  // in, not just the container. `readableActions` runs for every archetype and
  // reads `action.requiredPermission` off each item, so a `null` or `undefined`
  // entry throws exactly as a non-array `actions` does. A newer core may add
  // FIELDS to an action; it cannot make an action stop being an object, so this
  // is version-independent while "must have a label and href" is not.
  if (widget.actions !== undefined) {
    if (!Array.isArray(widget.actions)) {
      return "actions, when given, must be an array";
    }
    const badIndex = widget.actions.findIndex(
      action => typeof action !== "object" || action === null
    );
    if (badIndex !== -1) {
      return `actions[${badIndex}] must be an object`;
    }
  }

  // Placement is a vocabulary judgement, so a newer core's archetype is exempt.
  // An ABSENT one is not: resolution supplies `custom`, which is a name this
  // core knows perfectly well, so the rule applies as it would to any other.
  if (standing.kind === "newer") return undefined;
  const effective =
    standing.kind === "resolved-custom" ? "custom" : standing.name;

  if (widget.actions !== undefined && effective !== "actions") {
    return 'actions are only valid for archetype "actions"';
  }

  return undefined;
}

/** The ordering rules between the three sizes, once each is known to be valid. */
/**
 * The three sizes as ranks, with an unrankable one reported as absent.
 *
 * A size this core does not know has no rank, and ordering it would be the
 * vocabulary check by another route -- which must not cross the contributions
 * boundary. Reporting it as `undefined` rather than poisoning the whole set
 * means each comparison skips only the operand it cannot rank: a widget whose
 * `maxSize` came from a newer core is still checked for a `defaultSize` below
 * its `minSize`, which are values this core reads perfectly well.
 */
function orderableRanks(widget: Record<string, unknown>): {
  min?: number;
  max?: number;
  dflt?: number;
} {
  const rank = (value: unknown): number | undefined =>
    typeof value === "string" && WIDGET_SIZES.includes(value as WidgetSize)
      ? sizeRank(value as WidgetSize)
      : undefined;

  return {
    min: rank(widget.minSize),
    max: rank(widget.maxSize),
    dflt: rank(widget.defaultSize),
  };
}

/** One ordering rule between the sizes, given their ranks. */
type SizeOrderRule = (
  ranks: { min?: number; max?: number; dflt?: number },
  widget: Record<string, unknown>
) => string | undefined;

/**
 * The orderings that must hold between the three sizes.
 *
 * A list rather than a ladder for the same reason `FIELD_RULES` is one: they
 * are independent, none depends on another's answer, and the shape stopped
 * saying what it was doing once there were three.
 */
const SIZE_ORDER_RULES: readonly SizeOrderRule[] = [
  ({ min, max }, w) =>
    min !== undefined && max !== undefined && min > max
      ? `minSize (${String(w.minSize)}) exceeds maxSize (${String(w.maxSize)})`
      : undefined,
  ({ min, dflt }, w) =>
    dflt !== undefined && min !== undefined && dflt < min
      ? `defaultSize (${String(w.defaultSize)}) is below minSize (${String(w.minSize)})`
      : undefined,
  ({ max, dflt }, w) =>
    dflt !== undefined && max !== undefined && dflt > max
      ? `defaultSize (${String(w.defaultSize)}) is above maxSize (${String(w.maxSize)})`
      : undefined,
];

function sizeRangeProblem(widget: Record<string, unknown>): string | undefined {
  const ranks = orderableRanks(widget);

  for (const rule of SIZE_ORDER_RULES) {
    const problem = rule(ranks, widget);
    if (problem !== undefined) return problem;
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

/** Confirms each of the three size fields names a real size. */
function validateSizeValues(d: Partial<WidgetDefinition>): void {
  // Registry-only, deliberately. A closed vocabulary states THIS core's
  // version: a plugin built against a newer one may name a size this core has
  // never heard of, and the admin already survives that by falling back to full
  // width -- `sizes.ts` calls that fallback expected input rather than
  // defensive decoration. Refusing it on the contributions side aborts a whole
  // plugin install over a card that renders.
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

/** Registry-only, for the same version reason as {@link validateSizeValues}. */
function validateHeight(d: Partial<WidgetDefinition>): void {
  if (
    d.defaultHeight !== undefined &&
    !WIDGET_HEIGHTS.includes(d.defaultHeight)
  ) {
    fail(`${d.id}: defaultHeight must be one of ${WIDGET_HEIGHTS.join(", ")}`);
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
 * Any archetype belonging to none of the four groups.
 *
 * `custom` is drawn by the plugin; the other three are drawn by core -- from one
 * query, from many (`cells`), and from none. Adding a name to `WIDGET_ARCHETYPES` and forgetting to
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
  | DataWidgetArchetype
  | QuerylessWidgetArchetype
  | CellWidgetArchetype
  | "custom"
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

  // The VOCABULARY check is not here, and that is the same version boundary the
  // sizes obey: a newer core may add a chrome value, and refusing it would
  // abort the install of a plugin whose card this admin would simply frame,
  // since anything that is not "none" already frames. `validateChrome` keeps
  // that check on the registry side.
  //
  // The archetype rule likewise only where this core KNOWS the archetype --
  // otherwise it judges a newer core's shape and refuses the whole install.
  // Through the same four-state reading as the placement rule, so the two
  // cannot drift into disagreeing about what an absent or newer archetype
  // means. An ABSENT one resolves to `custom`, which is exactly where `"none"`
  // is legal; a NEWER one is exempt, since this core cannot say whether its
  // body is composed into a card.
  const standing = archetypeStanding(archetype);
  const effective =
    standing.kind === "resolved-custom"
      ? "custom"
      : standing.kind === "known"
        ? standing.name
        : undefined;

  if (chrome === "none" && effective !== undefined && effective !== "custom") {
    return `chrome "none" is only valid for archetype "custom", not "${String(archetype)}" -- core draws that body into the card itself`;
  }

  return undefined;
}

function validateChrome(d: Partial<WidgetDefinition>): void {
  // Registry-only vocabulary, for the reason `chromeProblem` gives.
  if (d.chrome !== undefined && !WIDGET_CHROME.includes(d.chrome)) {
    fail(`${d.id}: chrome must be one of ${WIDGET_CHROME.join(", ")}`);
  }
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

/**
 * Confirms one cell of a `stats` card is usable, or names what is wrong.
 *
 * Every condition is a refusal rather than a fallback, for the reason the
 * source validator gives about its own fields: a card is registered ONCE and
 * read by every reader, so a malformed cell that is tolerated here becomes a
 * number that is blank, mislabelled or unclickable on every dashboard, arriving
 * per reader rather than at the point the mistake was made.
 */
/** Confirms one named part of a cell carries real, non-whitespace text. */
function blankCellText(
  value: unknown,
  at: string,
  field: string
): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return undefined;
  return `${at} requires a non-empty ${field}`;
}

/**
 * Confirms a cell's query is a count.
 *
 * Its own check, and its own reason: a missing query means there is no number
 * to draw at all, while a `list` one means the card asks for something it
 * refuses on arrival -- a declaration mistake that renders as unavailable data.
 */
function cellQueryProblem(query: unknown, at: string): string | undefined {
  if (typeof query !== "object" || query === null) {
    return `${at} requires a query object`;
  }
  // Checked at RUNTIME as well as in the type, for the callers a type does not
  // bind: a plugin compiled separately, JavaScript, and a cast.
  if ((query as WidgetQuery).op !== "count") {
    return `${at} must be a "count" query, because a stats cell draws one number`;
  }
  return undefined;
}

/**
 * Confirms a cell's optional link, when it has one, can actually be followed.
 *
 * A blank or non-string `href` reaches the admin's `Link`, whose
 * external-destination check calls `href.startsWith` -- so activating the number
 * throws instead of navigating, and the card that exists to navigate is the one
 * place that breaks. Refused here, where the mistake was made.
 */
function cellLinkProblem(
  link: WidgetStatCell["link"],
  at: string
): string | undefined {
  if (link === undefined) return undefined;
  if (typeof link !== "object" || link === null) {
    return `${at} link, when given, must be an object`;
  }
  return (
    blankCellText(link.label, `${at} link`, "label") ??
    blankCellText(link.href, `${at} link`, "href")
  );
}

export function statCellProblem(cell: unknown, at: string): string | undefined {
  if (typeof cell !== "object" || cell === null) {
    return `${at} must be an object`;
  }
  const c = cell as Partial<WidgetStatCell>;
  return (
    blankCellText(c.key, at, "key") ??
    blankCellText(c.label, at, "label") ??
    cellQueryProblem(c.query, at) ??
    cellLinkProblem(c.link, at)
  );
}

/**
 * Everything wrong with a `cells` list, or `undefined`.
 *
 * 🔴 Exported so the CONTRIBUTIONS channel asks the same question rather than a
 * similar one. `validateWidgetDefinition` refuses a malformed cell and the
 * plugin path checked only that the array was non-empty, so a contribution
 * carrying a `list` query, a missing query or two cells under one key was
 * published -- the exact values the registry refuses, arriving by the other
 * door and rendering as silent dashes or one answer drawn twice.
 */
export function cellsProblem(
  cells: unknown,
  max: number = MAX_STAT_CELLS
): string | undefined {
  if (!Array.isArray(cells) || cells.length === 0) {
    return 'archetype "stats" requires a non-empty cells array';
  }
  if (cells.length > max) {
    return `a stats card may declare at most ${max} cells, got ${cells.length}`;
  }
  const seen = new Set<string>();
  for (const [index, cell] of cells.entries()) {
    const problem = statCellProblem(cell, `cells[${index}]`);
    if (problem !== undefined) return problem;
    const key = (cell as WidgetStatCell).key;
    if (seen.has(key)) return `cells declare the key "${key}" more than once`;
    seen.add(key);
  }
  return undefined;
}

/**
 * Confirms `cells` is present exactly for `stats`, and well formed.
 *
 * The duplicate-key check matters more than it looks: the card keys each
 * answer back by `key`, so two cells sharing one would collapse into a single
 * answer and the card would draw the same number twice under two different
 * labels -- which is not wrong-looking in any way a reader could detect.
 */
function validateCells(d: Partial<WidgetDefinition>): void {
  if (d.archetype !== "stats") {
    if (d.cells !== undefined) {
      fail(`${d.id}: cells are only valid for archetype "stats"`);
    }
    return;
  }
  const problem = cellsProblem(d.cells);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

function validateQuery(d: Partial<WidgetDefinition>): void {
  const archetype = d.archetype as WidgetArchetype;
  if (DATA_ARCHETYPE_SET.has(archetype) && !d.query) {
    fail(`${d.id}: archetype "${d.archetype}" requires a query`);
  }
  // Refused with its OWN reason rather than the queryless one, which would say
  // this archetype takes no data -- the opposite of true. Its numbers come from
  // `cells`, and an author who wrote `query` needs to be told where to move it.
  if (CELL_ARCHETYPE_SET.has(archetype) && d.query !== undefined) {
    fail(
      `${d.id}: archetype "${d.archetype}" draws from cells, so it takes no top-level query`
    );
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
  validateHeight(d);
  validateComponent(d);
  validateActions(d);
  validateQuery(d);
  validateCells(d);
  validateDefaultOrder(d);
  validateChrome(d);
}
