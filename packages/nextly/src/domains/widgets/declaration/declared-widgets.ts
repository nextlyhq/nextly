/**
 * The widgets declared with `defineWidget()`, as core holds them after
 * startup.
 *
 * Every declaration is checked before any is kept (`validate.ts`), all owners
 * together, so a duplicate id is found across doors and every fault is
 * reported at once. Each declaration is then kept here whole, its server code
 * included, for the server's own use, and published to the widget registry as
 * a definition holding data only: the registry is what the admin reads, and
 * nothing in a declaration that runs on the server may reach the browser.
 *
 * Widgets declared in today's shape (`contributes.admin.widgets`) are drawn as
 * today, through their own path. They take part here only in the id rules: two
 * of them sharing an id keep today's first-wins, with a warning, and an id a
 * declared widget also takes stops startup.
 *
 * @module domains/widgets/declaration/declared-widgets
 */

import { getNextlyLogger } from "../../../observability/logger";
import type { WidgetDefinition, WidgetSize } from "../definition";
import type { WidgetQuery } from "../query";
import { registerWidget } from "../registry";
import type { WidgetSetting } from "../settings";

import { buildCardQuery } from "./card-query";
import type { WidgetWidth } from "./define-widget";
import { NEW_SETTING_TYPES } from "./setting-builders";
import {
  collectWidgetDeclarationFaults,
  widgetDeclarationsRefused,
  type WidgetDeclarationFault,
  type WidgetDeclarationGroup,
} from "./validate";

/** A declaration as startup kept it, with who declared it. */
export interface DeclaredWidget {
  readonly owner: string;
  readonly declaration: DeclaredWidgetShape;
}

/** The fields of a declaration this module reads, checked at startup. */
interface DeclaredWidgetShape {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly widths: readonly WidgetWidth[];
  readonly width: WidgetWidth;
  readonly permission?: string;
  readonly settings?: Readonly<Record<string, Record<string, unknown>>>;
  readonly data: unknown;
  readonly display: string | { readonly component: string };
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
 * The registry's column-span step for each declared width, at the large
 * breakpoint the steps are measured at: a quarter, a third, a half, two
 * thirds, and the whole row are 3, 4, 6, 8 and 12 of its 12 columns.
 */
const SIZE_OF_WIDTH: Record<WidgetWidth, WidgetSize> = {
  "1/4": "sm",
  "1/3": "md",
  "1/2": "lg",
  "2/3": "xl",
  full: "full",
};
const WIDTH_ORDER: readonly WidgetWidth[] = [
  "1/4",
  "1/3",
  "1/2",
  "2/3",
  "full",
];

/**
 * A declaration as the registry publishes it: data only.
 *
 * The data function, the query function and the empty test stay on the
 * server. `serverData` tells the registry, and the admin after it, that core
 * builds this card's data from the declaration, so the definition carries no
 * query. Only the settings of a type core defines are published; a control
 * core has no definition type for yet stays in the declaration, where the
 * server reads it.
 */
function toDefinition(declaration: DeclaredWidgetShape): WidgetDefinition {
  const widths = [...declaration.widths].sort(
    (a, b) => WIDTH_ORDER.indexOf(a) - WIDTH_ORDER.indexOf(b)
  );
  const display = declaration.display;
  const settings: WidgetSetting[] = Object.entries(declaration.settings ?? {})
    .filter(([, setting]) => !NEW_SETTING_TYPES.has(String(setting.type)))
    // A cast, because each was checked at startup by the reader a
    // `WidgetSetting` passes (`widgetSettingsProblem`).
    .map(([name, setting]) => ({ ...setting, name }) as WidgetSetting);
  return {
    id: declaration.id,
    title: declaration.title,
    description: declaration.description,
    category: declaration.category,
    ...(typeof display === "string"
      ? { archetype: display as WidgetDefinition["archetype"] }
      : { archetype: "custom" as const, component: display.component }),
    ...(settings.length > 0 ? { settings } : {}),
    defaultSize: SIZE_OF_WIDTH[declaration.width],
    minSize: SIZE_OF_WIDTH[widths[0]],
    maxSize: SIZE_OF_WIDTH[widths[widths.length - 1]],
    ...(declaration.permission === undefined
      ? {}
      : { requiredPermission: declaration.permission }),
    serverData: true,
  };
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
      const id = (declaration as { id?: unknown }).id;
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

const WARNED_LEGACY_IDS = new Set<string>();

/** Forgets which shared old-shape ids were warned about, for tests. */
export function resetLegacyIdWarnings(): void {
  WARNED_LEGACY_IDS.clear();
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
 * Checks every declaration, then keeps and publishes them all, or refuses
 * startup naming every fault and keeps none.
 *
 * `legacy` is the ids each plugin declares in today's shape.
 */
export function registerWidgetDeclarations(
  groups: readonly WidgetDeclarationGroup[],
  legacy: readonly LegacyWidgetIds[] = []
): void {
  const faults = [
    ...collectWidgetDeclarationFaults(groups),
    ...sharedWithLegacy(groups, legacy),
  ];
  if (faults.length > 0) throw widgetDeclarationsRefused(faults);
  warnSharedLegacyIds(legacy);

  for (const { owner, declarations } of groups) {
    // Every group is a list by now: one that was not is a fault, refused above.
    for (const raw of declarations as readonly unknown[]) {
      const declaration = raw as DeclaredWidgetShape;
      store().set(declaration.id, { owner, declaration });
      registerWidget(toDefinition(declaration), { source: owner });
    }
  }
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
    : buildCardQuery(declared.declaration, stored);
}

/** Forgets every declared widget. Called at boot before declaring again. */
export function clearDeclaredWidgets(): void {
  store().clear();
}
