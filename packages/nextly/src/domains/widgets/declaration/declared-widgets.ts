/**
 * The widgets declared with `defineWidget()`, as core holds them after
 * startup.
 *
 * Every declaration is checked before any is kept (`validate.ts`), all owners
 * together, so a duplicate id is found across doors and every fault is
 * reported at once. Each declaration is then kept here whole, its server code
 * included, for the server's own use.
 *
 * 🔴 Each is published to the widget registry the admin reads as DATA ONLY,
 * through core's own door: its data function, query function and empty test
 * stay here, and the published definition says only that core builds its
 * card's data (`serverData`). The dashboard asks for such a card by its id and
 * core answers it from the declaration kept here, so a declared widget is
 * published in the same change that answers its cards, never before.
 *
 * Widgets declared in today's shape (`contributes.admin.widgets`) are drawn as
 * today, through their own path. They take part here only in the id rules: two
 * of them sharing an id keep today's first-wins, with a warning, and an id a
 * declared widget also takes stops startup.
 *
 * @module domains/widgets/declaration/declared-widgets
 */

import { NextlyError } from "../../../errors/nextly-error";
import { getNextlyLogger } from "../../../observability/logger";
import type { WidgetDefinition } from "../definition";
import type { WidgetQuery } from "../query";
import {
  deregisterWidget,
  getWidget,
  registerDeclaredDefinition,
  widgetSource,
} from "../registry";
import type { AnyWidgetSetting } from "../settings";
import { sizeFromWidth, WIDGET_WIDTHS, type WidgetWidth } from "../widths";

import { buildCardQuery } from "./card-query";
import { declaredQueryProblem } from "./displays";
import {
  collectWidgetDeclarationFaults,
  widgetDeclarationsRefused,
  type WidgetDeclarationFault,
  type WidgetDeclarationGroup,
} from "./validate";

/**
 * One owner's declarations, with the slugs its own collections were renamed
 * to: a plugin's `.rename()` moves a collection, and the queries its widgets
 * write still name it as the plugin declared it.
 */
export interface DeclaredWidgetGroup extends WidgetDeclarationGroup {
  /** Declared slug to the slug the site uses, for the owner's collections. */
  readonly collections?: Readonly<Record<string, string>>;
}

/** A declaration as startup kept it, with who declared it. */
export interface DeclaredWidget {
  readonly owner: string;
  readonly declaration: DeclaredWidgetShape;
  /** The owner's renamed collections, as its group carried them. */
  readonly collections?: Readonly<Record<string, string>>;
}

/** The fields of a declaration this module reads, checked at startup. */
interface DeclaredWidgetShape {
  readonly id: string;
  /**
   * The widths the widget allows, in core's own words, gaps included: what
   * publishing it to the registry carries through as its allowed widths.
   */
  readonly widths: readonly WidgetWidth[];
  readonly settings?: Readonly<Record<string, Record<string, unknown>>>;
  readonly data: unknown;
  readonly display?: unknown;
  /** What publishing reads: the card's words, its starting width, and its gates. */
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly width: WidgetWidth;
  readonly several?: boolean;
  readonly permission?: string;
  readonly sketch?: WidgetDefinition["sketch"];
  readonly empty?: {
    readonly message?: string;
    readonly action?: { label: string; link: string; permission?: string };
  };
}

/**
 * A declaration's empty state as published: its words and its action, never
 * its test, which runs on the server. `permission` becomes the gate's own name.
 */
function publishedEmpty(
  empty: DeclaredWidgetShape["empty"]
): WidgetDefinition["empty"] | undefined {
  if (empty === undefined) return undefined;
  const { message, action } = empty;
  const published: NonNullable<WidgetDefinition["empty"]> = {
    ...(message === undefined ? {} : { message }),
    ...(action === undefined
      ? {}
      : {
          action: {
            label: action.label,
            link: action.link,
            ...(action.permission === undefined
              ? {}
              : { requiredPermission: action.permission }),
          },
        }),
  };
  return Object.keys(published).length === 0 ? undefined : published;
}

/** `{ empty }` when there is one to publish, and nothing otherwise. */
const withEmpty = (empty: WidgetDefinition["empty"] | undefined) =>
  empty === undefined ? {} : { empty };

/**
 * A declaration as the registry publishes it: data only.
 *
 * 🔴 A fresh object of named fields, never a spread of the declaration: the
 * data function, the query function and the empty test stay on the server,
 * and a field a declaration gains later reaches the browser only once it is
 * named here. `serverData` says core builds the card's data, so there is no
 * query. The widths are carried as declared, gaps included, in the
 * arrangement's own words; the size is only the span of the starting width,
 * for what still reads sizes.
 */
function toDefinition(declaration: DeclaredWidgetShape): WidgetDefinition {
  const display = declaration.display;
  const settings = Object.entries(declaration.settings ?? {}).map(
    // Each was checked at startup by the rules a definition's settings are
    // held to (`widgetSettingsProblems`), so it is one, named.
    ([name, setting]) => ({ ...setting, name }) as AnyWidgetSetting
  );
  return {
    id: declaration.id,
    title: declaration.title,
    description: declaration.description,
    category: declaration.category,
    ...(typeof display === "string"
      ? { archetype: display as WidgetDefinition["archetype"] }
      : {
          archetype: "custom" as const,
          component: (display as { component: string }).component,
        }),
    ...(settings.length > 0 ? { settings } : {}),
    defaultSize: sizeFromWidth(declaration.width),
    allowedWidths: WIDGET_WIDTHS.filter(width =>
      declaration.widths.includes(width)
    ),
    defaultWidth: declaration.width,
    ...(declaration.several === true ? { allowsSeveral: true } : {}),
    ...(declaration.permission === undefined
      ? {}
      : { requiredPermission: declaration.permission }),
    ...(declaration.sketch === undefined ? {} : { sketch: declaration.sketch }),
    ...withEmpty(publishedEmpty(declaration.empty)),
    serverData: true,
  };
}

/** The ids one owner declares in today's shape. */
export interface LegacyWidgetIds {
  readonly owner: string;
  readonly ids: readonly string[];
}

const STORE_KEY = "__nextly_declared_widgets";

/**
 * Pinned to `globalThis`, as the widget registry is, so a development reload
 * that re-evaluates this module still finds the one store boot filled.
 */
function store(): Map<string, DeclaredWidget> {
  const holder = globalThis as unknown as Record<
    string,
    Map<string, DeclaredWidget> | undefined
  >;
  holder[STORE_KEY] ??= new Map();
  return holder[STORE_KEY];
}

/**
 * The old-shape ids a declared widget also takes, as faults against the
 * declared one, naming the plugin that uses the old shape.
 */
function sharedWithLegacy(
  groups: readonly WidgetDeclarationGroup[],
  legacy: readonly LegacyWidgetIds[]
): WidgetDeclarationFault[] {
  const oldOwners = new Map<string, string>();
  for (const { owner, ids } of legacy) {
    for (const id of ids) if (!oldOwners.has(id)) oldOwners.set(id, owner);
  }
  return groups.flatMap(({ owner, declarations }) =>
    (Array.isArray(declarations) ? declarations : []).flatMap(declaration => {
      // An entry that is not an object is a fault already; it has no id here.
      const id = isRecord(declaration) ? declaration.id : undefined;
      const oldOwner = typeof id === "string" ? oldOwners.get(id) : undefined;
      return oldOwner === undefined
        ? []
        : [
            {
              owner,
              widget: String(id),
              problem: `id "${String(id)}" is already used by ${oldOwner}, which declares it in the old shape`,
            },
          ];
    })
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Each declaration copied once, property by property, before anything reads
 * it, so what is checked is what is kept.
 *
 * The declaration is the plugin's object, and an accessor or a proxy on it
 * could answer one id while it is checked and another when it is stored,
 * past the reserved namespaces and the duplicate check. The copy is shallow:
 * the functions it holds are kept as they are, since running them is their
 * purpose.
 */
function snapshot(group: DeclaredWidgetGroup): DeclaredWidgetGroup {
  const { declarations } = group;
  return {
    ...group,
    declarations: Array.isArray(declarations)
      ? declarations.map((entry: unknown) =>
          isRecord(entry) ? { ...entry } : entry
        )
      : declarations,
  };
}

const WARNED_LEGACY_IDS = new Set<string>();

/** Forgets which shared old-shape ids, and which held widgets, were warned about, for tests. */
export function resetLegacyIdWarnings(): void {
  WARNED_LEGACY_IDS.clear();
  WARNED_HELD_COMPONENT_WIDGETS.clear();
}

/**
 * Warns, once per process for each id, that old-shape plugins share it.
 *
 * Today's rule is kept, the first plugin winning, because widgets in that
 * shape must keep working as they do; the warning is what tells their authors
 * that the new shape refuses this.
 */
function warnSharedLegacyIds(legacy: readonly LegacyWidgetIds[]): void {
  const owners = new Map<string, string[]>();
  for (const { owner, ids } of legacy) {
    for (const id of ids) owners.set(id, [...(owners.get(id) ?? []), owner]);
  }
  for (const [id, plugins] of owners) {
    if (plugins.length < 2 || WARNED_LEGACY_IDS.has(id)) continue;
    WARNED_LEGACY_IDS.add(id);
    getNextlyLogger().warn({
      kind: "widget-id-shared-old-shape",
      widget: id,
      plugins,
      message:
        `${plugins.join(" and ")} each declare a widget "${id}" in the old ` +
        `shape. The first one is used, as before. Widgets declared with ` +
        `defineWidget() may not share an id: rename one before moving it.`,
    });
  }
}

/**
 * Checks every declaration, then keeps them all, or refuses startup naming
 * every fault and keeps none.
 *
 * `legacy` is the ids each plugin declares in today's shape.
 */
export function registerWidgetDeclarations(
  given: readonly DeclaredWidgetGroup[],
  legacy: readonly LegacyWidgetIds[] = []
): void {
  const groups = given.map(snapshot);
  const faults = [
    ...collectWidgetDeclarationFaults(groups),
    ...sharedWithLegacy(groups, legacy),
  ];
  if (faults.length > 0) throw widgetDeclarationsRefused(faults);
  warnSharedLegacyIds(legacy);

  for (const { owner, declarations, collections } of groups) {
    // Every group is a list by now: one that was not is a fault, refused above.
    for (const raw of declarations as readonly unknown[]) {
      const declaration = raw as DeclaredWidgetShape;
      store().set(declaration.id, {
        owner,
        declaration,
        ...(collections === undefined ? {} : { collections }),
      });
      // Published as it is kept, so every declared widget the admin is offered
      // has a declaration here to answer its cards from. One drawn by its own
      // component is kept and checked but not published: the admin does not
      // yet hand a widget's own component the props its declaration types
      // (`WidgetProps`), and a component reading them would throw in the card.
      if (drawnByOwnComponent(declaration)) {
        warnComponentWidgetHeld(declaration, owner);
        continue;
      }
      registerDeclaredDefinition(toDefinition(declaration), owner);
    }
  }
}

/** Whether a declaration is drawn by its own component rather than a core display. */
function drawnByOwnComponent(declaration: DeclaredWidgetShape): boolean {
  return typeof declaration.display !== "string";
}

const WARNED_HELD_COMPONENT_WIDGETS = new Set<string>();

/**
 * Says, once per process for each widget and only in development, that a
 * widget drawn by its own component is not offered yet, so its author is not
 * left looking for a card that never appears.
 */
function warnComponentWidgetHeld(
  declaration: DeclaredWidgetShape,
  owner: string
): void {
  if (process.env.NODE_ENV === "production") return;
  if (WARNED_HELD_COMPONENT_WIDGETS.has(declaration.id)) return;
  WARNED_HELD_COMPONENT_WIDGETS.add(declaration.id);
  getNextlyLogger().warn({
    kind: "widget-component-display-held",
    widget: declaration.id,
    plugin: owner,
    message:
      `"${declaration.id}" (${owner}) declares display.component. Widgets ` +
      `drawn by their own component are not offered on the dashboard yet, ` +
      `so it is left out of the add panel until they are; widgets with a ` +
      `core display are offered as declared.`,
  });
}

/** Every declared widget, in the order startup kept them. */
export function listDeclaredWidgets(): DeclaredWidget[] {
  return [...store().values()];
}

/** The declared widget with this id, or `undefined`. */
export function declaredWidget(id: string): DeclaredWidget | undefined {
  return store().get(id);
}

/**
 * The query core runs for a card of a declared widget, from the card's stored
 * settings, or `undefined` when the widget is not declared or its data is not
 * a query.
 */
export function cardQueryFor(
  widgetId: string,
  stored: Record<string, unknown> | undefined
): WidgetQuery | undefined {
  const declared = store().get(widgetId);
  return declared === undefined
    ? undefined
    : checkedCardQuery(declared, stored);
}

/**
 * The query core runs for a card of this declared widget, from the card's
 * stored settings, held to what the widget's display draws; `undefined` when
 * its data is not a query or a setting it needs has no value.
 *
 * 🔴 The ONE builder of a card's query, so the card that runs it and anything
 * that asks for it judge the same query. Judged here as well as at startup.
 * Startup builds the query from the starting settings, and a Collection setting
 * with no default leaves it unbuilt there, so a plain JavaScript list with no
 * fields passed startup and was first built here, for a card, with no check in
 * between; and a query function that changes its op for a setting other than
 * the starting one is only ever built here.
 */
export function checkedCardQuery(
  declared: DeclaredWidget,
  stored: Record<string, unknown> | undefined
): WidgetQuery | undefined {
  const query = buildCardQuery(
    declared.declaration,
    stored,
    declared.collections
  );
  if (query === undefined) return undefined;
  const problem = declaredQueryProblem(declared.declaration.display, query);
  if (problem !== undefined) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage: `Declared widget "${declared.declaration.id}" cannot draw its query: ${problem}.`,
    });
  }
  return query;
}

/**
 * Forgets every declared widget, and withdraws the definitions they published.
 * The registry's declared widgets are derived from this store, so clearing one
 * without the other would offer the admin widgets with no declaration left to
 * answer their cards from, and refuse the same declaration made again. Only
 * what a declaration published goes: its id, under its owner, with
 * `serverData`. Called at boot before declaring again.
 */
export function clearDeclaredWidgets(): void {
  for (const [id, { owner }] of store()) {
    if (widgetSource(id) === owner && getWidget(id)?.serverData === true) {
      deregisterWidget(id);
    }
  }
  store().clear();
}
