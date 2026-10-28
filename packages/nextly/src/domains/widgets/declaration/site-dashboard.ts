/**
 * The site config's `admin.dashboard`, checked at startup against every widget
 * the install has: core's, the plugins' and the site's own.
 *
 * Every fault is gathered and refused together with the widget declarations'
 * own, each naming "the site config" and the entry, so one restart shows the
 * author everything to fix. `defaultLayout` and `suggestions` are applied
 * through `siteDefaultLayoutPlan`; which keys are not applied yet is
 * `siteDashboardKeysNotApplied`'s to say.
 *
 * @module domains/widgets/declaration/site-dashboard
 */

import { allWidgets, sizeFacts } from "../canonical";
// Core's ids and default alone, not the widgets: this check runs wherever a config is read.
import { CORE_DEFAULT_LAYOUT } from "../core-widgets/ids";
import type { DefaultLayoutPlan } from "../default-layout";
import type { WidgetDefinition } from "../definition";
import {
  GRID_COLUMNS,
  isGridSize,
  MAX_GRID_ROWS,
  MIN_GRID_ROWS,
  narrowedSizeBounds,
  sizeBounds,
  type GridSize,
  type WidgetSizeBounds,
  type WidgetSizeDeclaration,
} from "../grid-size";
import { MAX_PLACEMENTS } from "../layout-limits";
import { getWidget } from "../registry";
import { startingValueProblem, type AnyWidgetSetting } from "../settings";

import type { DefaultLayoutCard } from "./dashboard";
import { quote } from "./quote";
import {
  descriptionProblem,
  requiredTextProblem,
  sparseListProblem,
  type WidgetDeclarationFault,
} from "./validate";

/** Who a site config fault names as its owner. */
export const SITE_CONFIG = "the site config";

/** What the check needs to know of one widget. */
export interface SiteWidgetFacts {
  /**
   * The sizes its cards may take, every end filled in. Absent for a generated
   * card not derived yet, whose sizes the check cannot see: then only that a
   * size is one the grid can draw is checked.
   */
  size?: WidgetSizeBounds;
  allowsSeveral: boolean;
  /** Its declared settings, or `undefined` where its declaration is not seen. */
  settings?: readonly AnyWidgetSetting[];
}

/** The install's widgets, as the check reads them. */
export interface SiteDashboardContext {
  /** Every widget id the install has, for a misspelt id's nearest match. */
  ids: readonly string[];
  factsOf(id: string): SiteWidgetFacts | undefined;
  /** Core's own widget ids, the only ones `replace` may name as keys. */
  coreIds: ReadonlySet<string>;
  /** Each alternative a plugin offers, by its id, with the built-in it replaces. */
  alternatives: ReadonlyMap<string, string>;
  /** The most cards a dashboard may hold. */
  maxPlacements: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A fault of the site config, about `entry`. */
function fault(entry: string, problem: string): WidgetDeclarationFault {
  return { owner: SITE_CONFIG, widget: entry, problem };
}

/** The known id nearest `id`, when one is close enough to be a misspelling. */
function nearest(id: string, ids: readonly string[]): string | undefined {
  let best: { id: string; distance: number } | undefined;
  for (const candidate of ids) {
    const distance = editDistance(id, candidate);
    if (distance <= 3 && (best === undefined || distance < best.distance)) {
      best = { id: candidate, distance };
    }
  }
  return best?.id;
}

/** The keys `admin.dashboard` takes. */
const DASHBOARD_KEYS = [
  "widgets",
  "hide",
  "overrides",
  "defaultLayout",
  "suggestions",
  "replace",
] as const;

/** The keys an `overrides` entry takes. */
const OVERRIDE_KEYS = ["title", "description", "size", "settings"] as const;

/** The keys an override's `size` takes. */
const SIZE_KEYS = ["default", "min", "max"] as const;

/** The keys a `defaultLayout` card takes. */
const CARD_KEYS = ["widget", "id", "w", "h", "settings", "optional"] as const;

/**
 * Each key of `value` that `where` does not take, with the known key it most
 * likely meant: a misspelt key would otherwise be accepted and do nothing.
 */
export function unknownKeyProblems(
  where: string,
  value: Record<string, unknown>,
  known: readonly string[]
): string[] {
  return Object.keys(value)
    .filter(key => !known.includes(key))
    .map(key => {
      const meant =
        known.find(
          candidate => candidate.toLowerCase() === key.toLowerCase()
        ) ?? nearest(key, known);
      return `${where} has "${key}", which it does not take${meant === undefined ? "" : `; did you mean "${meant}"?`}`;
    });
}

/** Levenshtein distance between two ids. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution =
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        substitution
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * The namespaces of the cards core generates from the content itself, one per
 * collection or Single. They are derived when the dashboard is first read, after
 * startup checks the site config, so at startup an id in them may name a card
 * that does not exist yet without being a mistake.
 */
const GENERATED_NAMESPACES = ["collection/", "single/"] as const;

/**
 * What the check assumes of a generated card it cannot see yet: no sizes and
 * no settings it can judge, so only the config's own shape is checked.
 */
const NOT_YET_GENERATED: SiteWidgetFacts = {
  allowsSeveral: true,
};

/**
 * What the check knows of `id`: the install's widget, or, for an id in a
 * generated namespace not derived yet, `NOT_YET_GENERATED`.
 */
function factsFor(
  id: string,
  ctx: SiteDashboardContext
): SiteWidgetFacts | undefined {
  const facts = ctx.factsOf(id);
  if (facts !== undefined) return facts;
  return GENERATED_NAMESPACES.some(namespace => id.startsWith(namespace))
    ? NOT_YET_GENERATED
    : undefined;
}

/** Why `id` names no widget, with its nearest match, or `undefined`. */
function unknownWidget(
  where: string,
  id: unknown,
  ctx: SiteDashboardContext
): string | undefined {
  if (typeof id !== "string") {
    return `${where} must name a widget by its id, got ${quote(id)}`;
  }
  if (factsFor(id, ctx) !== undefined) return undefined;
  const near = nearest(id, ctx.ids);
  return `${where} names "${id}", which no widget declares${near === undefined ? "" : `; did you mean "${near}"?`}`;
}

/** A size as an author writes it, `{ w: 6, h: 4 }`. */
const sized = (size: GridSize): string => `{ w: ${size.w}, h: ${size.h} }`;

/** Whether `a` is at most `b` in both directions. */
const fitsWithin = (a: GridSize, b: GridSize): boolean =>
  a.w <= b.w && a.h <= b.h;

/**
 * Why a default card's `w` and `h` are not a size the widget allows, one
 * problem per direction.
 *
 * Each is judged on its own, against the widget's bounds once the site's own
 * override narrows them: a card stating only `w` keeps the widget's starting
 * height, so only the direction it states can be wrong.
 */
function cardSizeProblems(
  card: Record<string, unknown>,
  bounds: WidgetSizeBounds | undefined
): string[] {
  const direction = (key: "w" | "h"): string | undefined => {
    const value = card[key];
    if (value === undefined) return undefined;
    return (
      gridDirectionProblem(key, value) ??
      boundsDirectionProblem(key, value as number, bounds)
    );
  };
  return [direction("w"), direction("h")].filter(
    (problem): problem is string => problem !== undefined
  );
}

/**
 * Why one stated direction of a default card is no size the grid can draw:
 * one to twelve columns, and from the fewest to the most rows a card may span.
 */
function gridDirectionProblem(
  key: "w" | "h",
  value: unknown
): string | undefined {
  const lowest = key === "w" ? 1 : MIN_GRID_ROWS;
  const highest = key === "w" ? GRID_COLUMNS : MAX_GRID_ROWS;
  const drawable =
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= lowest &&
    value <= highest;
  if (drawable) return undefined;
  const shape = `a whole number from ${lowest} to ${highest}`;
  return `defaultLayout ${key} must be ${shape}, got ${quote(value)}`;
}

/** Why a drawable direction of a default card lies outside the widget's bounds. */
function boundsDirectionProblem(
  key: "w" | "h",
  value: number,
  bounds: WidgetSizeBounds | undefined
): string | undefined {
  if (bounds === undefined) return undefined;
  const low = bounds.min[key];
  const high = bounds.max[key];
  return value >= low && value <= high
    ? undefined
    : `defaultLayout ${key} is ${value}, which the widget does not allow (from ${low} to ${high})`;
}

/** Why each starting value cannot be used, one problem per setting. */
function settingsProblems(
  where: string,
  settings: unknown,
  facts: SiteWidgetFacts
): string[] {
  if (settings === undefined) return [];
  if (!isRecord(settings))
    return [`${where} must be an object of setting values`];
  // A widget whose declaration is not seen here (an older-shape plugin's) has
  // its values judged when a card reads them.
  if (facts.settings === undefined) return [];
  const declared = facts.settings;
  return Object.entries(settings).flatMap(([name, value]) => {
    const setting = declared.find(candidate => candidate.name === name);
    if (setting === undefined) {
      return [`${where} sets "${name}", which the widget does not declare`];
    }
    const problem = startingValueProblem(setting, value);
    return problem === undefined ? [] : [`${where}: ${problem}`];
  });
}

/**
 * An override's `size` as the grid reads it, or `undefined` when it is not one:
 * an object whose every stated end is a size the grid can draw.
 */
function overrideSize(
  size: unknown
): Partial<WidgetSizeDeclaration> | undefined {
  if (!isRecord(size)) return undefined;
  const ends: Partial<WidgetSizeDeclaration> = {};
  for (const key of SIZE_KEYS) {
    const end = size[key];
    if (end === undefined) continue;
    if (!isGridSize(end)) return undefined;
    ends[key] = end;
  }
  return ends;
}

/**
 * The sizes a widget allows once the site's own override narrows them.
 *
 * An override that cannot be read, or would widen the widget's bounds, leaves
 * them as the widget declares them: that override is reported as a fault of
 * its own, so a default card is not also refused for it.
 */
function narrowedBounds(
  id: string,
  site: Record<string, unknown>,
  facts: SiteWidgetFacts
): WidgetSizeBounds | undefined {
  if (facts.size === undefined) return undefined;
  const overrides = isRecord(site.overrides) ? site.overrides : {};
  const override = overrides[id];
  const size = isRecord(override) ? overrideSize(override.size) : undefined;
  if (size === undefined) return facts.size;
  return narrowedSizeBounds(facts.size, size) ?? facts.size;
}

/** The ids `hide` names, whatever else it holds. */
function hiddenIds(site: Record<string, unknown>): ReadonlySet<string> {
  return new Set(
    Array.isArray(site.hide)
      ? site.hide.filter((id): id is string => typeof id === "string")
      : []
  );
}

function hideFaults(
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (site.hide === undefined) return [];
  if (!Array.isArray(site.hide)) {
    return [fault("(hide)", "hide must be a list of widget ids")];
  }
  const sparse = sparseListProblem(site.hide, "hide");
  if (sparse !== undefined) return [fault("(hide)", sparse)];
  return site.hide.flatMap(id => {
    const problem = unknownWidget("hide", id, ctx);
    return problem === undefined
      ? []
      : [fault(typeof id === "string" ? id : quote(id), problem)];
  });
}

/**
 * Why an override's `size` cannot narrow the widget's, one problem each.
 *
 * 🔴 An override narrows and never widens: a widget is never drawn at a size
 * its author did not allow. `narrowedSizeBounds` is the verdict, the same one
 * the bounds a default card is checked against come from; what follows it
 * only names which end is wrong.
 */
function sizeOverrideProblems(size: unknown, facts: SiteWidgetFacts): string[] {
  if (size === undefined) return [];
  if (!isRecord(size)) {
    return ["overrides.size must be { default?, min?, max? }, each { w, h }"];
  }
  const unknownKeys = unknownKeyProblems("overrides.size", size, SIZE_KEYS);
  const shapes = SIZE_KEYS.filter(
    key => size[key] !== undefined && !isGridSize(size[key])
  ).map(
    key =>
      `overrides.size.${key} must be { w, h } with w a whole number from 1 to ${GRID_COLUMNS} and h a whole number from ${MIN_GRID_ROWS} to ${MAX_GRID_ROWS}, got ${quote(size[key])}`
  );
  const read = overrideSize(size);
  if (read === undefined || facts.size === undefined) {
    return [...unknownKeys, ...shapes];
  }
  if (narrowedSizeBounds(facts.size, read) !== undefined) return unknownKeys;
  return [...unknownKeys, ...wideningProblems(facts.size, read)];
}

/**
 * Which ends of an override `narrowedSizeBounds` refused leave the widget's
 * bounds or meet no size between them. Never empty for an override it refused.
 */
function wideningProblems(
  own: WidgetSizeBounds,
  override: Partial<WidgetSizeDeclaration>
): string[] {
  const allowed = `the widget allows from ${sized(own.min)} to ${sized(own.max)}, and an override may only narrow that`;
  const widened = widenedEnds(own, override, allowed);
  if (widened.length > 0) return widened;
  const min = override.min ?? own.min;
  const max = override.max ?? own.max;
  if (!fitsWithin(min, max)) {
    return [
      `overrides.size leaves no size between its smallest ${sized(min)} and its largest ${sized(max)}`,
    ];
  }
  if (override.default !== undefined) {
    return [
      `overrides.size.default ${sized(override.default)} is not between the smallest size ${sized(min)} and the largest ${sized(max)}`,
    ];
  }
  return [`overrides.size cannot narrow the widget's sizes; ${allowed}`];
}

/** Each end of an override that reaches past the widget's own bounds. */
function widenedEnds(
  own: WidgetSizeBounds,
  override: Partial<WidgetSizeDeclaration>,
  allowed: string
): string[] {
  const ends = [
    {
      key: "min",
      given: override.min,
      widens: (given: GridSize) => !fitsWithin(own.min, given),
      what: "smallest",
    },
    {
      key: "max",
      given: override.max,
      widens: (given: GridSize) => !fitsWithin(given, own.max),
      what: "largest",
    },
  ] as const;
  return ends.flatMap(({ key, given, widens, what }) =>
    given !== undefined && widens(given)
      ? [
          `overrides.size.${key} ${sized(given)} widens the ${what} size; ${allowed}`,
        ]
      : []
  );
}

function overrideProblems(override: unknown, facts: SiteWidgetFacts): string[] {
  if (!isRecord(override)) return ["overrides entry must be an object"];
  const unknownKeys = unknownKeyProblems(
    "overrides entry",
    override,
    OVERRIDE_KEYS
  );
  const title =
    override.title === undefined
      ? undefined
      : requiredTextProblem("overrides.title", override.title);
  const description =
    override.description === undefined
      ? undefined
      : descriptionProblem(override.description)?.replace(
          "description",
          "overrides.description"
        );
  return [
    ...unknownKeys,
    ...(title === undefined ? [] : [title]),
    ...(description === undefined ? [] : [description]),
    ...sizeOverrideProblems(override.size, facts),
    ...settingsProblems("overrides.settings", override.settings, facts),
  ];
}

function overridesFaults(
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (site.overrides === undefined) return [];
  if (!isRecord(site.overrides)) {
    return [
      fault("(overrides)", "overrides must be an object keyed by widget id"),
    ];
  }
  return Object.entries(site.overrides).flatMap(([id, override]) => {
    const unknown = unknownWidget("overrides", id, ctx);
    if (unknown !== undefined) return [fault(id, unknown)];
    const facts = factsFor(id, ctx) as SiteWidgetFacts;
    return overrideProblems(override, facts).map(problem => fault(id, problem));
  });
}

/** One default card as `{ widget, w, h, settings }`, whichever way it is written. */
function asCard(entry: unknown): Record<string, unknown> | undefined {
  if (typeof entry === "string") return { widget: entry };
  return isRecord(entry) ? entry : undefined;
}

function defaultCardProblems(
  card: Record<string, unknown>,
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): string[] {
  const id = card.widget;
  const unknownKeys = [
    ...unknownKeyProblems("defaultLayout card", card, CARD_KEYS),
    ...(card.optional === undefined || typeof card.optional === "boolean"
      ? []
      : [
          `defaultLayout optional must be true or false, got ${quote(card.optional)}`,
        ]),
  ];
  const unknown = unknownWidget("defaultLayout", id, ctx);
  // An optional card names a widget the install may not have, such as a
  // plugin's on a site without the plugin: left out of the default, no fault.
  if (
    unknown !== undefined &&
    card.optional === true &&
    typeof id === "string"
  ) {
    return unknownKeys;
  }
  if (unknown !== undefined) return [...unknownKeys, unknown];
  const widget = id as string;
  const facts = factsFor(widget, ctx) as SiteWidgetFacts;
  return [
    ...unknownKeys,
    ...(hiddenIds(site).has(widget)
      ? [`defaultLayout places "${widget}", which hide hides`]
      : []),
    ...cardSizeProblems(card, narrowedBounds(widget, site, facts)),
    ...settingsProblems("defaultLayout settings", card.settings, facts),
  ];
}

/** Each widget listed more often than it allows cards, once. */
function repeatedFaults(
  cards: readonly Record<string, unknown>[],
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const faults: WidgetDeclarationFault[] = [];
  for (const { widget } of cards) {
    if (typeof widget !== "string") continue;
    const facts = ctx.factsOf(widget);
    if (
      seen.has(widget) &&
      facts !== undefined &&
      !facts.allowsSeveral &&
      !reported.has(widget)
    ) {
      reported.add(widget);
      faults.push(
        fault(
          widget,
          `defaultLayout lists "${widget}" more than once, and it allows one card`
        )
      );
    }
    seen.add(widget);
  }
  return faults;
}

/**
 * Each fault in the ids the default's cards are kept under. A card's id is the
 * one its entry names, or its widget's: so a widget placed more than once names
 * an id for each further card, which no other card and no widget may share. The
 * id never depends on another card, or on which a reader may see.
 */
function cardIdFaults(
  cards: readonly Record<string, unknown>[],
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  const widgetIds = new Set(ctx.ids);
  const taken = new Set<string>();
  return cards.flatMap((card, index) => {
    const found = cardIdFault(card, index, { widgetIds, taken, ctx });
    return found === undefined ? [] : [found];
  });
}

/** What one card's id is checked against: the install's widgets, and the ids the cards before it took. */
interface CardIdContext {
  readonly widgetIds: ReadonlySet<string>;
  /** Grows as each card takes its id. */
  readonly taken: Set<string>;
  readonly ctx: SiteDashboardContext;
}

/** The fault in one card's id, if it has one; a card whose id is free takes it. */
function cardIdFault(
  card: Record<string, unknown>,
  index: number,
  { widgetIds, taken, ctx }: CardIdContext
): WidgetDeclarationFault | undefined {
  const { widget, id } = card;
  if (typeof widget !== "string") return undefined;
  const problem =
    cardIdShapeProblem(id, widgetIds) ??
    takenIdProblem(widget, id, index, taken, ctx);
  if (problem === undefined) return undefined;
  return fault(id === undefined ? widget : `${widget} (${quote(id)})`, problem);
}

/**
 * Whether a card's id is one a card before it took: a further card of its
 * widget with no id of its own, or two cards under one id. An id still free is
 * taken here.
 */
function takenIdProblem(
  widget: string,
  id: unknown,
  index: number,
  taken: Set<string>,
  ctx: SiteDashboardContext
): string | undefined {
  const own = typeof id === "string" ? id : widget;
  if (!taken.has(own)) {
    taken.add(own);
    return undefined;
  }
  if (typeof id === "string") {
    return `defaultLayout names two cards "${own}": each card needs an id of its own`;
  }
  // A widget that allows one card is named once, by `repeatedFaults`.
  return ctx.factsOf(widget)?.allowsSeveral === false
    ? undefined
    : `defaultLayout places "${widget}" again (entry ${index + 1}) with no id of its own: name the card, as { widget: "${widget}", id: "${suggestedCardId(widget, taken)}" }`;
}

/** What is wrong with an id as written, whatever the other cards: not a non-empty string, or a widget's. */
function cardIdShapeProblem(
  id: unknown,
  widgetIds: ReadonlySet<string>
): string | undefined {
  if (id === undefined) return undefined;
  if (typeof id !== "string" || id === "") {
    return `defaultLayout id must be a non-empty string, got ${quote(id)}`;
  }
  return widgetIds.has(id)
    ? `defaultLayout names a card "${id}", which is a widget's id; give it a name no widget has`
    : undefined;
}

/** An id for a further card of `widget` that no card has taken, for a fault to suggest. */
function suggestedCardId(widget: string, taken: ReadonlySet<string>): string {
  const name = widget.slice(widget.lastIndexOf("/") + 1);
  let ordinal = 2;
  while (taken.has(`${name}-${ordinal}`)) ordinal += 1;
  return `${name}-${ordinal}`;
}

function defaultLayoutFaults(
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (site.defaultLayout === undefined) return [];
  if (!Array.isArray(site.defaultLayout)) {
    return [fault("(defaultLayout)", "defaultLayout must be a list of cards")];
  }
  const sparse = sparseListProblem(site.defaultLayout, "defaultLayout");
  if (sparse !== undefined) return [fault("(defaultLayout)", sparse)];
  const entries: readonly unknown[] = site.defaultLayout;
  const cards = entries.map(asCard);
  // An optional card whose widget the install does not have is left out of
  // the default (`defaultLayoutPlacements`), so it takes none of its room.
  const placed = cards.filter(
    card =>
      !(
        card?.optional === true &&
        typeof card.widget === "string" &&
        ctx.factsOf(card.widget) === undefined
      )
  ).length;
  const over =
    placed > ctx.maxPlacements
      ? [
          fault(
            "(defaultLayout)",
            `defaultLayout places ${placed} cards, and a dashboard holds at most ${ctx.maxPlacements}`
          ),
        ]
      : [];
  const each = cards.flatMap((card, index) => {
    if (card === undefined) {
      return [
        fault(
          `(defaultLayout ${index + 1})`,
          "a default card is a widget id or { widget, w?, h?, settings?, optional? }"
        ),
      ];
    }
    return defaultCardProblems(card, site, ctx).map(problem =>
      fault(
        typeof card.widget === "string"
          ? card.widget
          : `(defaultLayout ${index + 1})`,
        problem
      )
    );
  });
  const listed = cards.filter(
    (card): card is Record<string, unknown> => card !== undefined
  );
  return [
    ...over,
    ...each,
    ...repeatedFaults(listed, ctx),
    ...cardIdFaults(listed, ctx),
  ];
}

function replacementProblem(
  core: string,
  alternative: unknown,
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): string | undefined {
  if (!ctx.coreIds.has(core)) {
    return `replace names "${core}", which is not a built-in widget`;
  }
  const unknown = unknownWidget(`replace "${core}"`, alternative, ctx);
  if (unknown !== undefined) return unknown;
  const id = alternative as string;
  if (ctx.alternatives.get(id) !== core) {
    return `replace puts "${id}" in place of "${core}", and no plugin offers it as an alternative to "${core}"`;
  }
  return hiddenIds(site).has(id)
    ? `replace puts "${id}" in place of "${core}", and hide hides it`
    : undefined;
}

function replaceFaults(
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (site.replace === undefined) return [];
  if (!isRecord(site.replace)) {
    return [
      fault(
        "(replace)",
        "replace must be an object keyed by built-in widget id"
      ),
    ];
  }
  return Object.entries(site.replace).flatMap(([core, alternative]) => {
    const problem = replacementProblem(core, alternative, site, ctx);
    return problem === undefined ? [] : [fault(core, problem)];
  });
}

/**
 * Every fault of the site config's `admin.dashboard`, other than its own
 * widgets' declarations, which are checked with the plugins'.
 */
export function siteDashboardFaults(
  dashboard: unknown,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (dashboard === undefined) return [];
  if (!isRecord(dashboard)) {
    return [fault("(admin.dashboard)", "admin.dashboard must be an object")];
  }
  const unknownKeys = unknownKeyProblems(
    "admin.dashboard",
    dashboard,
    DASHBOARD_KEYS
  ).map(problem => fault("(admin.dashboard)", problem));
  const suggestions =
    dashboard.suggestions === undefined ||
    typeof dashboard.suggestions === "boolean"
      ? []
      : [fault("(suggestions)", "suggestions must be true or false")];
  return [
    ...unknownKeys,
    ...hideFaults(dashboard, ctx),
    ...overridesFaults(dashboard, ctx),
    ...defaultLayoutFaults(dashboard, ctx),
    ...suggestions,
    ...replaceFaults(dashboard, ctx),
  ];
}

/** The keys this version accepts and checks but does not yet apply. */
const NOT_APPLIED_YET = ["widgets", "hide", "overrides", "replace"] as const;

/**
 * The keys the site config sets that this version does not apply yet, so
 * startup can say so rather than let a setting appear to do nothing.
 */
export function siteDashboardKeysNotApplied(dashboard: unknown): string[] {
  if (!isRecord(dashboard)) return [];
  return NOT_APPLIED_YET.filter(key => dashboard[key] !== undefined);
}

/**
 * The install's widgets as the check reads them: the declarations being
 * registered (`declared`, by id, as their definitions), then core's and the
 * plugins' older-shape widgets from the registry, whose sizes come from the
 * one reading every other door uses (`sizeFacts`).
 */
export function siteDashboardContext(
  declared: ReadonlyMap<string, WidgetDefinition>,
  alternatives: ReadonlyMap<string, string>,
  // Core's ids, derived once where startup registers widgets and handed to
  // every check that asks whether an id is a built-in.
  coreIds: ReadonlySet<string>
): SiteDashboardContext {
  const registered = new Map(allWidgets().map(widget => [widget.id, widget]));
  const factsOf = (id: string): SiteWidgetFacts | undefined => {
    const definition = declared.get(id);
    if (definition !== undefined) {
      return {
        size: sizeBounds(definition.size),
        allowsSeveral: definition.allowsSeveral === true,
        ...(definition.settings === undefined
          ? {}
          : { settings: definition.settings }),
      };
    }
    const widget = registered.get(id);
    if (widget === undefined) return undefined;
    const { size, allowsSeveral } = sizeFacts(widget);
    const settings = getWidget(id)?.settings;
    return {
      size,
      allowsSeveral,
      // A widget only the registry knows declares its settings there; one
      // contributed in the older shape is seen without them.
      ...(getWidget(id) === undefined ? {} : { settings: settings ?? [] }),
    };
  };
  return {
    ids: [...declared.keys(), ...registered.keys()],
    factsOf,
    coreIds,
    alternatives,
    maxPlacements: MAX_PLACEMENTS,
  };
}

/**
 * The site config's `admin.dashboard`, read once at startup into a copy every
 * check reads, so a value that answers differently on each read is judged as
 * one config.
 */
export function siteDashboardSnapshot(dashboard: unknown): unknown {
  return isRecord(dashboard) ? { ...dashboard } : dashboard;
}

/**
 * The default dashboard the site config asks for, from the copy startup checked:
 * its `defaultLayout`, or core's own where it gives none, and whether the
 * plugins' suggestions (`suggested`, in plugin order) are placed after it.
 * Read only once the config has passed every check, so each entry is a widget
 * id or a card of the shape the check admits.
 */
export function siteDefaultLayoutPlan(
  dashboard: unknown,
  suggested: readonly string[]
): DefaultLayoutPlan {
  const site = isRecord(dashboard) ? dashboard : {};
  const given = site.defaultLayout as
    | readonly (string | DefaultLayoutCard)[]
    | undefined;
  return {
    cards:
      given === undefined
        ? CORE_DEFAULT_LAYOUT
        : given.map(entry =>
            typeof entry === "string" ? { widget: entry } : { ...entry }
          ),
    suggestions: site.suggestions !== false,
    suggested,
  };
}
