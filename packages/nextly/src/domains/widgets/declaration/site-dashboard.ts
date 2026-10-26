/**
 * The site config's `admin.dashboard`, checked at startup against every widget
 * the install has: core's, the plugins' and the site's own.
 *
 * Every fault is gathered and refused together with the widget declarations'
 * own, each naming "the site config" and the entry, so one restart shows the
 * author everything to fix (R-4, R-5). Nothing here applies a key; which keys
 * are applied yet is `siteDashboardKeysNotApplied`'s to say.
 *
 * @module domains/widgets/declaration/site-dashboard
 */

import { allWidgets, widthFacts } from "../canonical";
import { CORE_WIDGETS } from "../core-widgets";
import type { WidgetDefinition } from "../definition";
import { MAX_PLACEMENTS } from "../layout-limits";
import { getWidget } from "../registry";
import { startingValueProblem, type AnyWidgetSetting } from "../settings";
import { isWidgetWidth, WIDGET_WIDTHS, type WidgetWidth } from "../widths";

import { quote } from "./quote";
import {
  descriptionProblem,
  requiredTextProblem,
  type WidgetDeclarationFault,
} from "./validate";

/** Who a site config fault names as its owner. */
export const SITE_CONFIG = "the site config";

/** What the check needs to know of one widget. */
export interface SiteWidgetFacts {
  allowedWidths: readonly WidgetWidth[];
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
const OVERRIDE_KEYS = [
  "title",
  "description",
  "width",
  "widths",
  "settings",
] as const;

/** The keys a `defaultLayout` card takes. */
const CARD_KEYS = ["widget", "width", "settings"] as const;

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
 * What the check assumes of a generated card it cannot see yet: every width
 * and no settings it can judge, so only the config's own shape is checked.
 */
const NOT_YET_GENERATED: SiteWidgetFacts = {
  allowedWidths: WIDGET_WIDTHS,
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

/** Why `width` is not one `widget` allows within `allowed`, or `undefined`. */
function widthProblem(
  where: string,
  width: unknown,
  allowed: readonly WidgetWidth[]
): string | undefined {
  if (width === undefined) return undefined;
  if (!isWidgetWidth(width))
    return `${where} is ${quote(width)}, which is not a width`;
  return allowed.includes(width)
    ? undefined
    : `${where} is "${width}", which the widget does not allow (${allowed.join(", ")})`;
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

/** The widths a widget allows once the site's own narrowing applies. */
function narrowedWidths(
  id: string,
  site: Record<string, unknown>,
  facts: SiteWidgetFacts
): readonly WidgetWidth[] {
  const overrides = isRecord(site.overrides) ? site.overrides : {};
  const override = overrides[id];
  if (!isRecord(override) || !Array.isArray(override.widths)) {
    return facts.allowedWidths;
  }
  const narrowed = override.widths.filter(
    (width): width is WidgetWidth =>
      isWidgetWidth(width) && facts.allowedWidths.includes(width)
  );
  return narrowed.length > 0 ? narrowed : facts.allowedWidths;
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
  return site.hide.flatMap(id => {
    const problem = unknownWidget("hide", id, ctx);
    return problem === undefined
      ? []
      : [fault(typeof id === "string" ? id : quote(id), problem)];
  });
}

/** Why the narrowed widths widen or empty the widget's, one per problem. */
function narrowingProblems(widths: unknown, facts: SiteWidgetFacts): string[] {
  if (widths === undefined) return [];
  if (!Array.isArray(widths) || widths.length === 0) {
    return ["overrides.widths must be a non-empty list of widths"];
  }
  return widths.flatMap(width => {
    if (!isWidgetWidth(width))
      return [`overrides.widths holds ${quote(width)}, which is not a width`];
    return facts.allowedWidths.includes(width)
      ? []
      : [
          `overrides.widths adds "${width}", which the widget does not allow; widths may only be narrowed (${facts.allowedWidths.join(", ")})`,
        ];
  });
}

function overrideProblems(
  id: string,
  override: unknown,
  site: Record<string, unknown>,
  facts: SiteWidgetFacts
): string[] {
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
    ...narrowingProblems(override.widths, facts),
    ...[
      widthProblem(
        "overrides.width",
        override.width,
        narrowedWidths(id, site, facts)
      ),
    ].filter((problem): problem is string => problem !== undefined),
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
    return overrideProblems(id, override, site, facts).map(problem =>
      fault(id, problem)
    );
  });
}

/** One default card as `{ widget, width, settings }`, whichever way it is written. */
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
  const unknownKeys = unknownKeyProblems("defaultLayout card", card, CARD_KEYS);
  const unknown = unknownWidget("defaultLayout", id, ctx);
  if (unknown !== undefined) return [...unknownKeys, unknown];
  const widget = id as string;
  const facts = factsFor(widget, ctx) as SiteWidgetFacts;
  return [
    ...unknownKeys,
    ...(hiddenIds(site).has(widget)
      ? [`defaultLayout places "${widget}", which hide hides`]
      : []),
    ...[
      widthProblem(
        "defaultLayout width",
        card.width,
        narrowedWidths(widget, site, facts)
      ),
    ].filter((problem): problem is string => problem !== undefined),
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

function defaultLayoutFaults(
  site: Record<string, unknown>,
  ctx: SiteDashboardContext
): WidgetDeclarationFault[] {
  if (site.defaultLayout === undefined) return [];
  if (!Array.isArray(site.defaultLayout)) {
    return [fault("(defaultLayout)", "defaultLayout must be a list of cards")];
  }
  const entries: readonly unknown[] = site.defaultLayout;
  const over =
    entries.length > ctx.maxPlacements
      ? [
          fault(
            "(defaultLayout)",
            `defaultLayout holds ${entries.length} cards, and a dashboard holds at most ${ctx.maxPlacements}`
          ),
        ]
      : [];
  const cards = entries.map(asCard);
  const each = cards.flatMap((card, index) => {
    if (card === undefined) {
      return [
        fault(
          `(defaultLayout ${index + 1})`,
          "a default card is a widget id or { widget, width?, settings? }"
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
  return [...over, ...each, ...repeatedFaults(listed, ctx)];
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
const NOT_APPLIED_YET = [
  "widgets",
  "hide",
  "overrides",
  "defaultLayout",
  "suggestions",
  "replace",
] as const;

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
 * plugins' older-shape widgets from the registry, whose widths come from the
 * one reading every other door uses (`widthFacts`).
 */
export function siteDashboardContext(
  declared: ReadonlyMap<string, WidgetDefinition>,
  alternatives: ReadonlyMap<string, string>
): SiteDashboardContext {
  const registered = new Map(allWidgets().map(widget => [widget.id, widget]));
  const factsOf = (id: string): SiteWidgetFacts | undefined => {
    const definition = declared.get(id);
    if (definition !== undefined) {
      return {
        allowedWidths: definition.allowedWidths ?? [],
        allowsSeveral: definition.allowsSeveral === true,
        ...(definition.settings === undefined
          ? {}
          : { settings: definition.settings }),
      };
    }
    const widget = registered.get(id);
    if (widget === undefined) return undefined;
    const { allowedWidths, allowsSeveral } = widthFacts(widget);
    const settings = getWidget(id)?.settings;
    return {
      allowedWidths,
      allowsSeveral,
      // A widget only the registry knows declares its settings there; one
      // contributed in the older shape is seen without them.
      ...(getWidget(id) === undefined ? {} : { settings: settings ?? [] }),
    };
  };
  return {
    ids: [...declared.keys(), ...registered.keys()],
    factsOf,
    coreIds: new Set(CORE_WIDGETS.map(widget => widget.id)),
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
