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

import { getNextlyLogger } from "../../../observability/logger";
import type { Logger } from "../../../shared/types";
import { validateWidgetDefinition, type WidgetDefinition } from "../definition";
// The registry's own gate shape, which this file maps the declaration's
// `WidgetAccessGate` (of `define-widget.ts`) onto.
import type { WidgetPermissionGate as RequiredPermission } from "../gate";
import { sizeBounds, type WidgetSizeDeclaration } from "../grid-size";
import {
  deregisterWidget,
  getWidget,
  registerDeclaredDefinition,
  registerWidget,
  widgetSource,
} from "../registry";
import type { AnyWidgetSetting } from "../settings";

import type { WidgetAccessGate } from "./define-widget";
import { displayOfView, type WidgetDisplay, type WidgetView } from "./displays";
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
  /** The declaration as its author wrote it, its server code included. */
  readonly declaration: DeclaredWidgetShape;
  /** The display that draws its view (`displayOfView`), read once, here. */
  readonly display: WidgetDisplay;
  /** The owner's renamed collections, as its group carried them. */
  readonly collections?: Readonly<Record<string, string>>;
}

/** A declaration as its author writes it (`defineWidget`), checked at startup. */
interface DeclaredWidgetShape {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon?: string;
  readonly category?: string;
  /** The card's size and the bounds it may be resized within, in grid units. */
  readonly size: WidgetSizeDeclaration;
  /**
   * Who may be offered it: a permission gate (a permission name, `{ anyOf }`
   * or `{ allOf }`), published as the registry's `requiredPermission` and
   * judged when the card is handed; the collections it reads, or a predicate
   * of the person, judged with the person before `load` runs.
   */
  readonly access?:
    | WidgetAccessGate
    | { readonly collections: readonly string[] }
    | ((input: { user: unknown }) => unknown);
  /** Where the add panel offers it, published as the registry's own `offered`. */
  readonly offered?: WidgetDefinition["offered"];
  /** Whether the card shows at all for the person asking, judged before `load`. */
  readonly shows?: (input: unknown) => unknown;
  readonly settings?: Readonly<Record<string, Record<string, unknown>>>;
  /** The card's data, run on the server for each card, as the person asking. */
  readonly load: (input: unknown) => unknown;
  readonly view: WidgetView;
  readonly isEmpty?: (data: unknown) => boolean;
  readonly empty?: {
    readonly message?: string;
    readonly action?:
      | { label: string; link: string; permission?: string }
      | { label: string; opens: "settings" };
  };
  readonly several?: boolean;
  readonly hidesWhenEmpty?: boolean;
  /**
   * The cases the development preview page draws the card's ready state from,
   * each held at startup to what JSON carries (`previewProblems`).
   *
   * 🔴 Kept here, on the server, and never published: `toDefinition` names
   * every field the registry carries and this is not one of them, so the
   * admin's workspace payload never holds a case. Only the preview read, which
   * answers in development alone, sends them, and only for the widgets its
   * reader may see.
   */
  readonly preview?: readonly DeclaredPreviewCase[];
}

/** One preview case as a declaration states it, checked at startup. */
export interface DeclaredPreviewCase {
  readonly name: string;
  readonly data: unknown;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/**
 * The add panel's category for a widget that names none. Not for core's own:
 * the panel shows a category as a label beside the name, and core's widgets
 * carry none, so a core declaration that names none stays without one.
 */
const DEFAULT_CATEGORY = "Other";

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
    ...(action === undefined ? {} : { action: publishedAction(action) }),
  };
  return Object.keys(published).length === 0 ? undefined : published;
}

/** An empty state's action as a declaration states it. */
type DeclaredEmptyAction = NonNullable<
  NonNullable<DeclaredWidgetShape["empty"]>["action"]
>;

/**
 * Whether an empty action opens the card's settings: by the value of `opens`, as the startup check
 * reads it, not by the key alone. A plain JavaScript declaration may carry `opens: undefined`
 * beside its link, which the check accepts as the link form; read by the key, it was published as
 * a settings action with no `opens`, which the registry refuses.
 */
function opensSettings(
  action: DeclaredEmptyAction
): action is Extract<DeclaredEmptyAction, { opens: "settings" }> {
  return "opens" in action && action.opens === "settings";
}

/**
 * An empty state's action as published: a link with the gate's own name for its permission, or
 * the card's settings, which need no permission here, since the admin offers the button only
 * where the person can change that card's settings.
 */
function publishedAction(
  action: DeclaredEmptyAction
): NonNullable<NonNullable<WidgetDefinition["empty"]>["action"]> {
  if (opensSettings(action)) return { label: action.label, opens: "settings" };
  return {
    label: action.label,
    link: action.link,
    ...(action.permission === undefined
      ? {}
      : { requiredPermission: action.permission }),
  };
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
 * query. The size is published with every end filled in (`sizeBounds`), the
 * one reading of a declared size, so no reader fills a missing end its own way.
 */
function toDefinition(
  declaration: DeclaredWidgetShape,
  owner: string
): WidgetDefinition {
  const settings = Object.entries(declaration.settings ?? {}).map(
    // Each was checked at startup by the rules a definition's settings are
    // held to (`widgetSettingsProblems`), so it is one, named.
    ([name, setting]) => ({ ...setting, name }) as AnyWidgetSetting
  );
  return {
    id: declaration.id,
    title: declaration.title,
    description: declaration.description,
    ...publishedLabels(declaration, owner),
    ...drawnBy(displayOfView(declaration.view), owner),
    ...(settings.length > 0 ? { settings } : {}),
    size: sizeBounds(declaration.size),
    ...publishedGates(declaration),
    ...withEmpty(publishedEmpty(declaration.empty)),
    serverData: true,
  };
}

/**
 * What the add panel shows beside a declared widget's name: its icon, and its
 * category, "Other" when it names none. Not for core's own, whose cards carry
 * no category label.
 */
function publishedLabels(
  declaration: DeclaredWidgetShape,
  owner: string
): Pick<WidgetDefinition, "icon" | "category"> {
  const category =
    declaration.category ??
    (owner === CORE_OWNER ? undefined : DEFAULT_CATEGORY);
  return {
    ...(declaration.icon === undefined ? {} : { icon: declaration.icon }),
    ...(category === undefined ? {} : { category }),
  };
}

/**
 * The archetype a declared view is drawn by, and for a view of its own, its component and who
 * declared it, so a card whose component is missing can name both.
 */
function drawnBy(
  display: WidgetDisplay,
  owner: string
): Pick<WidgetDefinition, "archetype" | "component" | "owner"> {
  return typeof display === "string"
    ? { archetype: display }
    : { archetype: "custom", component: display.component, owner };
}

/**
 * Who is offered a declared widget, where, how many times, and whether it
 * leaves while empty.
 */
function publishedGates(
  declaration: DeclaredWidgetShape
): Pick<
  WidgetDefinition,
  "allowsSeveral" | "hidesWhenEmpty" | "offered" | "requiredPermission"
> {
  const requiredPermission = requiredPermissionOf(declaration.access);
  return {
    // Published whenever it is stated, `false` included: a widget offered per
    // collection or on request allows several unless it says otherwise, so a
    // `several: false` left out would read as the opposite.
    ...(typeof declaration.several === "boolean"
      ? { allowsSeveral: declaration.several }
      : {}),
    ...(declaration.hidesWhenEmpty === true ? { hidesWhenEmpty: true } : {}),
    // As written: startup held it to the registry's own rule (`offeredProblem`).
    ...(declaration.offered === undefined
      ? {}
      : { offered: declaration.offered }),
    // A permission gate decides who is offered the widget at all; the other
    // forms are judged per card, with the person, before its `load` runs.
    ...(requiredPermission === undefined ? {} : { requiredPermission }),
  };
}

/**
 * A declaration's permission gate as the registry's `requiredPermission`, the
 * one shape the layout and payload gates judge (`widgetGateHolds`), or
 * `undefined` for an access that is no gate: absent, the collections it
 * reads, or a predicate.
 *
 * 🔴 Mapped, not passed through: the registry reads a bare list as any-of,
 * which a declaration spells `{ anyOf }`, so each form is rewritten into the
 * registry's spelling of the same rule, and every gate is judged by the one
 * path that judges core's own widgets. A fresh value, so nothing else the
 * author's object carries is published.
 */
function requiredPermissionOf(
  access: DeclaredWidgetShape["access"]
): RequiredPermission | undefined {
  if (typeof access === "string") return access;
  if (typeof access !== "object" || access === null) return undefined;
  if ("anyOf" in access) return [...access.anyOf];
  if ("allOf" in access) {
    return {
      allOf: access.allOf.map(entry =>
        typeof entry === "string" ? entry : [...entry.anyOf]
      ),
    };
  }
  return undefined;
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
      if (oldOwner === undefined) return [];
      // 🔴 One id has one owner. An id core declares is core's, so the plugin
      // using it in the old shape is the one to change, and the fault is filed
      // under that plugin with what to do instead.
      if (owner === CORE_OWNER) {
        return [
          {
            owner: oldOwner,
            widget: String(id),
            problem: `${oldOwner} contributes ${String(id)} through contributes.admin.widgets; core owns that id. Remove it, or contribute your own id through contributes.dashboard.`,
          },
        ];
      }
      return [
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

/**
 * What startup says its warnings through: the logger the app's registration
 * was given, so they reach the same place as the rest of its boot.
 */
export type StartupLogger = Pick<Logger, "warn">;

/**
 * The process-wide logger, as a startup logger: where startup's warnings go
 * when the caller hands none.
 */
export const NEXTLY_STARTUP_LOGGER: StartupLogger = {
  warn: (message, meta) => getNextlyLogger().warn({ ...meta, message }),
};

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
function warnSharedLegacyIds(
  legacy: readonly LegacyWidgetIds[],
  logger: StartupLogger
): void {
  const owners = new Map<string, string[]>();
  for (const { owner, ids } of legacy) {
    for (const id of ids) owners.set(id, [...(owners.get(id) ?? []), owner]);
  }
  for (const [id, plugins] of owners) {
    if (plugins.length < 2 || WARNED_LEGACY_IDS.has(id)) continue;
    WARNED_LEGACY_IDS.add(id);
    logger.warn(
      `${plugins.join(" and ")} each declare a widget "${id}" in the old ` +
        `shape. The first one is used, as before. Widgets declared with ` +
        `defineWidget() may not share an id: rename one before moving it.`,
      { kind: "widget-id-shared-old-shape", widget: id, plugins }
    );
  }
}

/** The owner core's own widgets are reported and registered under. */
export const CORE_OWNER = "core";

/** Every widget a dashboard can show, by owner, as the one call takes them. */
export interface DashboardWidgets {
  /**
   * Core's own widgets: the definitions core ships, until each is declared
   * with `defineWidget` as a plugin's is.
   */
  core?: readonly WidgetDefinition[];
  /** Each plugin's declarations, kept and published. */
  groups?: readonly DeclaredWidgetGroup[];
  /** The ids each plugin declares in today's shape. */
  legacy?: readonly LegacyWidgetIds[];
  /**
   * What names these widgets (the site config's dashboard, a plugin's
   * suggestions), handed each well-formed declaration as the definition it
   * becomes and the groups as they were snapshotted, so ownership is read from
   * the same copy that is kept, and its faults are refused with the
   * declarations' own, at once.
   */
  references?: (
    declared: ReadonlyMap<string, WidgetDefinition>,
    groups: readonly DeclaredWidgetGroup[]
  ) => readonly WidgetDeclarationFault[];
  /** Where startup's warnings go: the registration's logger, or the process-wide one. */
  logger?: StartupLogger;
}

/**
 * The one way a widget reaches the dashboard: core's own, every plugin's and
 * the site's all come through here.
 *
 * Checks every widget of every owner first, then keeps them all, or refuses
 * startup naming every fault of every owner in one message and keeps none. One
 * door, so a rule checked here holds for every widget, and a fault in one
 * owner never leaves the dashboard half registered from the others.
 */
export function registerDashboardWidgets({
  core = [],
  groups: given = [],
  legacy = [],
  references,
  logger = NEXTLY_STARTUP_LOGGER,
}: DashboardWidgets): void {
  const groups = given.map(snapshot);
  const faults = [
    ...coreWidgetFaults(core),
    ...collectWidgetDeclarationFaults(groups),
    ...sharedWithLegacy(groups, legacy),
  ];
  if (references !== undefined) {
    // Core's widgets among them: nothing is kept until every check has passed,
    // so what names a core widget finds it here rather than in the registry.
    const declared = new Map([
      ...core.map(definition => [definition.id, definition] as const),
      ...wellFormedDefinitions(groups, faults),
    ]);
    faults.push(...references(declared, groups));
  }
  if (faults.length > 0) throw widgetDeclarationsRefused(faults);
  warnSharedLegacyIds(legacy, logger);

  for (const definition of core) {
    registerWidget(definition, { source: CORE_OWNER });
  }

  for (const { owner, declarations, collections } of groups) {
    // Every group is a list by now: one that was not is a fault, refused above.
    for (const raw of declarations as readonly unknown[]) {
      const declaration = raw as DeclaredWidgetShape;
      store().set(declaration.id, {
        owner,
        declaration,
        display: displayOfView(declaration.view),
        ...(collections === undefined ? {} : { collections }),
      });
      // Published as it is kept, so every declared widget the admin is offered
      // has a declaration here to answer its cards from. One drawn by its own
      // component is published as a custom card core answers: the admin hands
      // that component the props its declaration types (`WidgetProps`).
      registerDeclaredDefinition(toDefinition(declaration, owner), owner);
    }
  }
}

/**
 * Every fault in core's own list, as the faults of every other owner are
 * reported: an id it lists twice, and a definition the registry would refuse.
 * Core's list is checked by the same rules as everyone's, so a mistake in it
 * stops startup with the rest rather than as a separate throw after some of
 * the dashboard was already registered.
 */
function coreWidgetFaults(
  core: readonly WidgetDefinition[]
): WidgetDeclarationFault[] {
  const faults: WidgetDeclarationFault[] = [];
  const seen = new Set<string>();
  for (const definition of core) {
    if (seen.has(definition.id)) {
      faults.push({
        owner: CORE_OWNER,
        widget: definition.id,
        problem: `id "${definition.id}" is already declared by ${CORE_OWNER}`,
      });
    }
    seen.add(definition.id);
    try {
      validateWidgetDefinition(definition);
    } catch (error) {
      faults.push({
        owner: CORE_OWNER,
        widget: definition.id,
        problem: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return faults;
}

/**
 * The definitions the declarations no fault names would become, by id, so a
 * reference to a faulty one reads as unknown rather than as a second fault
 * about the same mistake.
 */
function wellFormedDefinitions(
  groups: readonly DeclaredWidgetGroup[],
  faults: readonly WidgetDeclarationFault[]
): ReadonlyMap<string, WidgetDefinition> {
  const faulty = new Set(faults.map(fault => fault.widget));
  const definitions = new Map<string, WidgetDefinition>();
  for (const { owner, declarations } of groups) {
    if (!Array.isArray(declarations)) continue;
    for (const raw of declarations as readonly unknown[]) {
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || faulty.has(id)) continue;
      definitions.set(id, toDefinition(raw as DeclaredWidgetShape, owner));
    }
  }
  return definitions;
}

/** The declared widget with this id, or `undefined`. */
export function declaredWidget(id: string): DeclaredWidget | undefined {
  return store().get(id);
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
