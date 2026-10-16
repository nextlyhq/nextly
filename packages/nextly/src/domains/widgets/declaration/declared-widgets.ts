/**
 * The widgets declared with `defineWidget()`, as core holds them after
 * startup.
 *
 * Every declaration is checked before any is kept (`validate.ts`), all owners
 * together, so a duplicate id is found across doors and every fault is
 * reported at once. Each declaration is then kept here whole, its server code
 * included, for the server's own use.
 *
 * 🔴 None is published to the widget registry the admin reads yet. A declared
 * widget's data is built on the server, and nothing runs it for a card until
 * the dashboard's data path does; offered before then, it would be placed on
 * dashboards and draw only an error. It is published when it can be drawn.
 *
 * Widgets declared in today's shape (`contributes.admin.widgets`) are drawn as
 * today, through their own path. They take part here only in the id rules: two
 * of them sharing an id keep today's first-wins, with a warning, and an id a
 * declared widget also takes stops startup.
 *
 * @module domains/widgets/declaration/declared-widgets
 */

import { getNextlyLogger } from "../../../observability/logger";
import type { WidgetQuery } from "../query";

import { buildCardQuery } from "./card-query";
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
  readonly settings?: Readonly<Record<string, Record<string, unknown>>>;
  readonly data: unknown;
  readonly display?: unknown;
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
    }
  }
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
    : buildCardQuery(declared.declaration, stored, declared.collections);
}

/** Forgets every declared widget. Called at boot before declaring again. */
export function clearDeclaredWidgets(): void {
  store().clear();
}
