/**
 * What the site config's `admin.dashboard` says about other widgets, as startup read and checked
 * it: which it hides, which built-in each alternative replaces, and what it overrides.
 *
 * Read wherever a widget is offered, drawn or described, so a key the site sets holds on every
 * door at once: the reader's audience (`visibility.ts`) keeps off the dashboard every widget the
 * site keeps off it, and the default places an alternative where the built-in it replaces would
 * have been (`default-layout.ts`).
 *
 * @module domains/widgets/site-rules
 */

import type { WidgetOverride } from "./declaration/dashboard";
import {
  narrowedSizeBounds,
  sizeBounds,
  type WidgetSizeDeclaration,
} from "./grid-size";
import { UNSTATED_WIDGET_SIZE } from "./unstated-size";

/** The site's rules about other widgets. */
export interface SiteDashboardRules {
  /** Widgets nobody is offered and no card draws (`hide`). */
  readonly hidden: ReadonlySet<string>;
  /** Each built-in the site replaces, with the alternative in its place (`replace`). */
  readonly replaced: ReadonlyMap<string, string>;
  /** Every alternative a plugin offers, whether or not the site puts it anywhere. */
  readonly alternatives: ReadonlySet<string>;
  /** What the site changes about a widget, by its id (`overrides`). */
  readonly overrides: ReadonlyMap<string, WidgetOverride>;
}

/** No rules: what a boot that read no site config holds. */
const NO_RULES: SiteDashboardRules = {
  hidden: new Set(),
  replaced: new Map(),
  alternatives: new Set(),
  overrides: new Map(),
};

/**
 * Pinned where every boot-time widget store is pinned, so a hot reload replaces the rules with
 * the ones its own config gives rather than keeping the last.
 */
const globalForRules = globalThis as unknown as {
  __nextly_siteDashboardRules?: SiteDashboardRules;
};

/** Replace the rules. Called once per boot, beside the widget registries. */
export function setSiteDashboardRules(rules: SiteDashboardRules): void {
  globalForRules.__nextly_siteDashboardRules = rules;
}

/** The rules this boot set, or none. */
export function siteDashboardRules(): SiteDashboardRules {
  return globalForRules.__nextly_siteDashboardRules ?? NO_RULES;
}

/**
 * Whether the site keeps widget `id` off the dashboard: hidden; a built-in an alternative
 * replaces; or an alternative no `replace` names, which is offered only in the place of the
 * built-in it was made for. Its saved cards are kept, not drawn, and are drawn again where they
 * were if the site's config changes.
 */
export function keptOffBySite(
  id: string,
  rules: SiteDashboardRules = siteDashboardRules()
): boolean {
  if (rules.hidden.has(id) || rules.replaced.has(id)) return true;
  return (
    rules.alternatives.has(id) && ![...rules.replaced.values()].includes(id)
  );
}

/** What an override may change, on any reading of a widget that carries it. */
interface Overridable {
  id: string;
  title?: string;
  description?: string;
  size?: WidgetSizeDeclaration;
  settings?: unknown;
}

/**
 * `widget` as the site's `overrides` change it: its title and description,
 * its sizes narrowed within its own (`narrowedSizeBounds`, which startup
 * checked would allow them), and its settings' starting values. The ONE
 * application, made on every reading of a widget: the canonical list layouts
 * and the add panel read, the definitions the admin draws, and the settings a
 * declared card is answered with. Applying it twice changes nothing more.
 */
export function withSiteOverride<T extends Overridable>(
  widget: T,
  rules: SiteDashboardRules = siteDashboardRules()
): T {
  const override = rules.overrides.get(widget.id);
  if (override === undefined) return widget;
  const size =
    override.size === undefined
      ? undefined
      : narrowedSizeBounds(
          sizeBounds(widget.size ?? UNSTATED_WIDGET_SIZE),
          override.size
        );
  return {
    ...widget,
    ...(override.title === undefined ? {} : { title: override.title }),
    ...(override.description === undefined
      ? {}
      : { description: override.description }),
    ...(size === undefined ? {} : { size }),
    ...(override.settings === undefined || widget.settings === undefined
      ? {}
      : { settings: withStartingValues(widget.settings, override.settings) }),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Settings with the starting values `values` names, in either shape a widget
 * states them: a registered widget's list, each setting naming itself, or a
 * declared widget's object, keyed by name. A setting `values` does not name
 * keeps its own.
 */
function withStartingValues(
  settings: unknown,
  values: Readonly<Record<string, unknown>>
): unknown {
  const started = (setting: unknown, name: unknown) =>
    isRecord(setting) && typeof name === "string" && Object.hasOwn(values, name)
      ? { ...setting, defaultValue: values[name] }
      : setting;
  if (Array.isArray(settings)) {
    return settings.map(setting =>
      started(setting, isRecord(setting) ? setting.name : undefined)
    );
  }
  if (isRecord(settings)) {
    return Object.fromEntries(
      Object.entries(settings).map(([name, setting]) => [
        name,
        started(setting, name),
      ])
    );
  }
  return settings;
}
