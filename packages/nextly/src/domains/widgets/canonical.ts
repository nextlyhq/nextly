/**
 * ONE answer to "which widgets exist", for every server-side question that
 * needs one.
 *
 * Every widget reaches the registry through one call: core's own list, a
 * plugin's `contributes.dashboard.widgets` and the site config's
 * `admin.dashboard.widgets`. Layout resolution reads a SUMMARY of each, the
 * four things it needs: which ids exist, which permission gates each, where it
 * sits by default, and what geometry it starts with. Rendering reads the whole
 * published widget.
 *
 * @module domains/widgets/canonical
 */

import { declaredWidget } from "./declaration/declared-widgets";
import type { WidgetDefinition } from "./definition";
import type { WidgetPermissionGate } from "./gate";
import {
  sizeBounds,
  type WidgetSizeBounds,
  type WidgetSizeDeclaration,
} from "./grid-size";
import { publishableWidgets } from "./publish";
import {
  textBoundsOf,
  type AnyWidgetSetting,
  type TextBound,
} from "./settings";
import { withSiteOverride } from "./site-rules";
import { UNSTATED_WIDGET_SIZE } from "./unstated-size";

/** The part of a widget that layout resolution needs. */
export interface CanonicalWidget {
  id: string;
  /**
   * The plugin that declared this widget, by its name: the add panel lists it
   * under that plugin. Absent for core's and the site's.
   */
  plugin?: string;
  /** The declaration's own one-line description and category, as stated. */
  description?: string;
  category?: string;
  /** The declaration's archetype, which picks the add panel's sketch. */
  archetype?: string;
  /** The sketch the declaration names in place of its archetype's, when it names one. */
  sketch?: string;
  /**
   * Set when core builds this widget's data on the server from its declaration,
   * so the admin asks for its cards by card rather than by query.
   */
  serverData?: true;
  requiredPermission?: WidgetPermissionGate;
  /**
   * The size the declaration states, in grid units, as stated. Read through
   * {@link sizeFacts}, the one place an unstated end is filled in.
   */
  size?: WidgetSizeDeclaration;
  defaultOrder?: number;
  /**
   * Whether a dashboard may hold more than one card of this widget, when the
   * declaration says. Absent, {@link sizeFacts} decides from `offered`.
   */
  allowsSeveral?: boolean;
  /**
   * Where the add panel offers this widget, as its definition states it: per
   * collection, or on request (a card a reader asks for, such as a note).
   * Either keeps it off the default dashboard and allows any number of cards.
   *
   * @experimental
   */
  offered?: "per-collection" | "on-request";
  /**
   * How long the widget stays, and the condition it stays under.
   *
   * Carried through because the LAYOUT endpoint is where a transient card is
   * filtered out, and it holds canonical widgets rather than declarations. Left
   * off, the filter reads `undefined` for every card and treats the whole
   * dashboard as permanent -- inert, and silently so, because a filter that
   * removes nothing looks exactly like one with nothing to remove.
   */
  lifecycle?: string;
  visibleWhen?: string | readonly string[];
  /** Whether the reader may send this card away; see `WidgetDefinition`. */
  dismissible?: boolean;
  /** Whether the card leaves the grid while its answer is empty; see `WidgetDefinition`. */
  hidesWhenEmpty?: boolean;
  /**
   * The bounds the declaration's textarea settings state, so the layout write
   * holds a placement's text to them. Absent when the declaration states no
   * settings.
   */
  textBounds?: readonly TextBound[];
  /**
   * The declaration's settings, so the layout write holds a value a card's
   * caller changed to the rule it is read back by (`settingValueProblem`).
   * Absent when the declaration states none.
   */
  settings?: readonly AnyWidgetSetting[];
  /**
   * The declaration's Collection setting (a widget states at most one), so the
   * layout read and write judge which collection a card reads by the
   * declaration the admin draws. Absent when the declaration states none.
   */
  collectionSetting?: AnyWidgetSetting;
  /**
   * The queries a setting of the declaration may drive: its query, or each of
   * its cells' queries. A Collection setting no knob drives on any of them
   * names no collection the card reads, so it decides nothing about which
   * cards are withheld. Absent on a summary built before the field existed,
   * which is judged by its setting alone.
   */
  knobQueries?: readonly unknown[];
  /**
   * The gates INSIDE the declaration: one per action of an `actions` widget,
   * verbatim, `undefined` where the action declares none, and a declared
   * widget's empty-state action's, when it has one.
   *
   * Carried so the workspace payload can withhold an action from a reader
   * who lacks its grant before the declaration ships -- an action is a label
   * and an href, and the browser hiding it afterwards is not a control.
   * Verbatim for the same reason `requiredPermission` is: what a gate means
   * is decided in one place, and a summary that normalised it would be a
   * second opinion.
   */
  actionGates?: readonly unknown[];
}

/**
 * The gates an `actions` declaration carries, one per action; none for a
 * declaration without actions, or with actions that are not a list.
 */
function actionGatesOf(actions: unknown): readonly unknown[] {
  if (!Array.isArray(actions)) return [];
  return actions.map(action =>
    typeof action === "object" && action !== null
      ? (action as { requiredPermission?: unknown }).requiredPermission
      : undefined
  );
}

/**
 * The optional fields a widget's summary carries, copied only when the
 * declaration states them, so an unstated field is absent rather than
 * `undefined`.
 */
const REGISTRATION_FIELDS = [
  "description",
  "category",
  "archetype",
  "requiredPermission",
  "size",
  "defaultOrder",
  "allowsSeveral",
  "sketch",
  "serverData",
  "lifecycle",
  "visibleWhen",
  "dismissible",
  "hidesWhenEmpty",
  "offered",
] as const satisfies ReadonlyArray<
  keyof WidgetDefinition & keyof CanonicalWidget
>;

/**
 * The gate a declared widget's empty-state action is offered under: a link's permission, when
 * it names one. An action opening the card's settings has none here; the admin offers it only
 * where the reader can change that card's settings.
 */
function emptyActionGate(
  action: NonNullable<WidgetDefinition["empty"]>["action"]
): string[] {
  return action !== undefined &&
    "requiredPermission" in action &&
    action.requiredPermission !== undefined
    ? [action.requiredPermission]
    : [];
}

/** The summary of one published widget. */
function fromRegistration(definition: WidgetDefinition): CanonicalWidget {
  const stated = REGISTRATION_FIELDS.filter(
    field => definition[field] !== undefined
  ).map(field => [field, definition[field]]);
  // The plugin that declared it, from the declaration startup kept, so the
  // add panel lists a plugin's widget under that plugin.
  const plugin = declaredWidget(definition.id)?.plugin;
  return {
    id: definition.id,
    ...(plugin === undefined ? {} : { plugin }),
    // A declared widget's empty-state action is gated like a shortcut, so its
    // gate is resolved with them, before the payload decides what to withhold.
    actionGates: [
      ...actionGatesOf(definition.actions),
      ...emptyActionGate(definition.empty?.action),
    ],
    ...(Object.fromEntries(stated) as Partial<CanonicalWidget>),
    ...textBoundsField(definition.settings),
    ...settingsField(definition.settings),
    ...collectionSettingField(definition.settings),
    ...knobQueriesField(definition),
  };
}

/**
 * The queries a declaration's settings may drive, as a summary field: its
 * query, or each of its cells' queries.
 */
function knobQueriesField(declaration: {
  query?: unknown;
  cells?: unknown;
}): Pick<CanonicalWidget, "knobQueries"> {
  const cells = Array.isArray(declaration.cells) ? declaration.cells : [];
  const knobQueries = [
    ...(declaration.query === undefined ? [] : [declaration.query]),
    ...cells.map((cell: unknown) =>
      typeof cell === "object" && cell !== null
        ? (cell as { query?: unknown }).query
        : undefined
    ),
  ];
  // Absent when it asks nothing, as every unstated field is.
  return knobQueries.length === 0 ? {} : { knobQueries };
}

/**
 * A declaration's textarea bounds as a summary field: absent when it states no
 * settings.
 */
function textBoundsField(
  settings: readonly AnyWidgetSetting[] | undefined
): Pick<CanonicalWidget, "textBounds"> {
  const textBounds = textBoundsOf(settings);
  return textBounds === undefined ? {} : { textBounds };
}

/** A declaration's settings as a summary field: absent when it states none. */
function settingsField(
  settings: readonly AnyWidgetSetting[] | undefined
): Pick<CanonicalWidget, "settings"> {
  return settings === undefined ? {} : { settings };
}

/** A declaration's Collection setting as a summary field: absent when it states none. */
function collectionSettingField(
  settings: readonly AnyWidgetSetting[] | undefined
): Pick<CanonicalWidget, "collectionSetting"> {
  const collectionSetting = settings?.find(
    setting => setting.type === "collection"
  );
  return collectionSetting === undefined ? {} : { collectionSetting };
}

/**
 * Every widget this install has, each as the site's `overrides` change it: its
 * sizes are what layouts start and keep its cards at.
 *
 * 🔴 Taken AS THE ADMIN MAY RECEIVE THEM, through `publishableWidgets`, never
 * from the raw registry. A widget JSON cannot carry is skipped by the
 * workspace payload, so the admin never holds it; what the install has is
 * what can reach the grid, and a widget that cannot is logged by the
 * projection that skips it and exists nowhere else.
 *
 * Every widget here was DECLARED by core, a plugin or the site: core mints no
 * card from the install's own content, so this is also the set the default
 * arrangement is materialized from, with no narrower view of it to keep.
 */
export function allWidgets(): CanonicalWidget[] {
  return publishableWidgets().map(definition =>
    withSiteOverride(fromRegistration(definition))
  );
}

/** What the dashboard needs to know about a widget's size. */
export interface WidgetSizeFacts {
  /** The size a new card starts at and the bounds it is kept within. */
  size: WidgetSizeBounds;
  /** Whether one dashboard may hold more than one card of this widget. */
  allowsSeveral: boolean;
}

/**
 * Whether a widget of the older shape is placed on the default by being
 * declared, as a suggestion after the default's own cards
 * (`default-layout.ts`): the ONE answer, for every reader that follows the
 * default.
 *
 * A plugin's declared widget is offered, never placed this way: where a plugin
 * may put one is its suggestion (`contributes.dashboard.suggest`), which the
 * site may decline, and an unsuggested one stays in the add panel.
 *
 * Nor does a widget that is offered (`offered`): one offered per collection
 * reads the collection a card is set to, and the default arrangement places a
 * widget once, set to nothing; one offered on request, a note, has nothing to
 * show until its reader writes it.
 */
export function placedByDefault(widget: CanonicalWidget): boolean {
  return widget.serverData !== true && widget.offered === undefined;
}

/**
 * The ONE reading of a widget's size, for the default arrangement, the layout
 * read and the check on a write alike.
 *
 * The declared size with every end filled in, through the grid size module's
 * `sizeBounds`; a summary that states no size is read as
 * {@link UNSTATED_WIDGET_SIZE}, as the admin reads it. A widget allows one
 * card unless it says otherwise.
 */
export function sizeFacts(widget: CanonicalWidget): WidgetSizeFacts {
  return {
    size: sizeBounds(widget.size ?? UNSTATED_WIDGET_SIZE),
    // An offered widget is added on request: once for each collection, or a
    // note for each thing a reader wants to keep, so a dashboard holds several
    // of it by design.
    allowsSeveral: widget.allowsSeveral ?? widget.offered !== undefined,
  };
}
