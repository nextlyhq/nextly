/**
 * ONE answer to "which widgets exist", for every server-side question that
 * needs one.
 *
 * 🔴 A widget reaches the dashboard by TWO channels — `registerWidget`, which
 * writes the imperative registry, and `contributes.admin.widgets`, which a
 * plugin declares and which never touches that registry at all. The admin grid
 * has always resolved both. The layout store, written later, read only the
 * first, and the two consequences were invisible while nothing consumed it:
 * a contributed widget was absent from the default arrangement and from
 * `available`, and every write naming one was refused as unavailable. So a
 * plugin using the documented contribution surface could render a card that
 * could never be arranged, hidden, or added.
 *
 * The fix is not for the layout endpoint to learn about contributions — that
 * would be a third place answering the same question. It is for the question to
 * have one implementation that both channels feed.
 *
 * ## Why this is a SUMMARY and not a `WidgetDefinition`
 *
 * The two channels do not carry the same shape and cannot be made to. A
 * registration is a resolved widget and requires `title` and `size`; a
 * contribution may omit both, and resolution fills them in downstream. Forcing
 * a contribution into `WidgetDefinition` here would mean inventing the missing
 * fields server-side and then disagreeing with whatever the admin invented.
 *
 * Layout resolution needs four things and none of them are the missing ones:
 * which ids exist, which permission gates each, where it sits by default, and
 * what geometry it starts with. That is what this carries. Rendering still
 * reads the full declaration through the channel it came from.
 *
 * @module domains/widgets/canonical
 */

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

/** The part of a widget that layout resolution needs, from either channel. */
export interface CanonicalWidget {
  id: string;
  /**
   * The plugin that contributed this widget, by its name. Set by the
   * contribution channel alone, so a registration overriding a plugin's widget
   * leaves it where its plugin's users look for it: the add panel lists it
   * under that plugin.
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
   * The size the declaration states, in grid units, as stated: a registration
   * always states one, and a contribution may not. Read through
   * {@link sizeFacts}, the one place an unstated end or an unstated size is
   * filled in.
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
   * The bounds the declaration's textarea settings state, from either channel,
   * so the layout write holds a placement's text to them whichever channel
   * declared the widget. Absent when the declaration states no settings.
   */
  textBounds?: readonly TextBound[];
  /**
   * The declaration's Collection setting, from either channel (a widget states
   * at most one), so the layout read and write judge which collection a card
   * reads by the declaration the admin draws, whichever channel stated it.
   * Absent when the declaration states none.
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
export function actionGatesOf(actions: unknown): readonly unknown[] {
  if (!Array.isArray(actions)) return [];
  return actions.map(action =>
    typeof action === "object" && action !== null
      ? (action as { requiredPermission?: unknown }).requiredPermission
      : undefined
  );
}

/** A summary's action gates, for one written before the field existed. */
function gatesOf(widget: CanonicalWidget): readonly unknown[] {
  return widget.actionGates ?? [];
}

/**
 * The optional fields a registration's summary carries, copied only when the
 * declaration states them, so an unstated field is absent rather than
 * `undefined` and the merge's fallbacks read it as unstated.
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

/** The summary of one registered widget. */
function fromRegistration(definition: WidgetDefinition): CanonicalWidget {
  const stated = REGISTRATION_FIELDS.filter(
    field => definition[field] !== undefined
  ).map(field => [field, definition[field]]);
  return {
    id: definition.id,
    // A declared widget's empty-state action is gated like a shortcut, so its
    // gate is resolved with them, before the payload decides what to withhold.
    actionGates: [
      ...actionGatesOf(definition.actions),
      ...emptyActionGate(definition.empty?.action),
    ],
    ...(Object.fromEntries(stated) as Partial<CanonicalWidget>),
    ...textBoundsField(definition.settings),
    ...collectionSettingField(definition.settings),
    ...knobQueriesField(definition),
  };
}

/**
 * The queries a declaration's settings may drive, as a summary field: its
 * query, or each of its cells' queries.
 */
export function knobQueriesField(declaration: {
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
 * settings, so a merge reads the other channel's, as the admin reads its
 * settings.
 */
export function textBoundsField(
  settings: readonly AnyWidgetSetting[] | undefined
): Pick<CanonicalWidget, "textBounds"> {
  const textBounds = textBoundsOf(settings);
  return textBounds === undefined ? {} : { textBounds };
}

/**
 * A declaration's Collection setting as a summary field: absent when it states
 * none, so a merge reads the other channel's, as `textBounds` does.
 */
export function collectionSettingField(
  settings: readonly AnyWidgetSetting[] | undefined
): Pick<CanonicalWidget, "collectionSetting"> {
  const collectionSetting = settings?.find(
    setting => setting.type === "collection"
  );
  return collectionSetting === undefined ? {} : { collectionSetting };
}

/**
 * One id declared through BOTH channels, as the single summary it describes.
 *
 * 🔴 MERGED FIELD BY FIELD, not substituted, because that is what the admin
 * does and the two must agree. `resolve-widgets.ts` reads
 * `registration.defaultOrder ?? contribution.defaultOrder`; a wholesale replace
 * here dropped a contributed order that the admin kept, so the server built the
 * default arrangement from one declaration while the grid drew it from another
 * — a card sorted into a position the reader never sees, with nothing visibly
 * wrong to say so.
 *
 * `requiredPermission` deliberately does NOT fall back, and the asymmetry is
 * the point rather than an omission. The registry is the override channel —
 * `overrideWidget` and `extendWidget` exist so a later plugin can correct an
 * earlier widget — so a registration that states no permission has STATED that,
 * and the admin reads it exactly that way. A `??` here would gate a card the
 * admin renders ungated: the reader would see it and the server would refuse
 * every write naming it, which is the same disagreement in the other direction.
 *
 * `size` needs no fallback either, for a duller reason: `WidgetDefinition`
 * requires it and `validateWidgetDefinition` enforces it, so a registration
 * always states one, whole: its minimum and maximum come with its default, and
 * a contributed bound is never mixed into a registered size.
 *
 * What is left is the fields a registration may legally omit and a contribution
 * may legally state, and for those the contribution is read.
 *
 * The LIFECYCLE falls back as a PAIR, and only as a pair. `visibleWhen` means
 * nothing without `lifecycle: "conditional"` beside it, so taking one
 * declaration's lifecycle with the other's condition would build a summary
 * neither channel declared — and one no validation ever saw, since each
 * declaration is checked on its own. A registration that states `"always"` has
 * overridden a contributed condition deliberately, and is read that way; one
 * that states no lifecycle has said nothing about the question, and the
 * contribution's answer stands. Substituted rather than merged, a contributed
 * conditional card became permanent here — offered forever, which is the
 * behaviour the lifecycle exists to remove.
 */
/**
 * The contribution's lifecycle pair, where the registration states none.
 *
 * As a PAIR and only as a pair, for the reason given above: `visibleWhen`
 * means nothing without `lifecycle: "conditional"`, so taking one half from
 * each channel could describe a card neither of them declared.
 *
 * Its own function because the merge is a list of fields, and the two nested
 * branches this takes were what pushed that list past what a reader can hold.
 */
function lifecycleFallback(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): Pick<CanonicalWidget, "lifecycle" | "visibleWhen"> {
  if (registration.lifecycle !== undefined) return {};
  return {
    ...(contribution.lifecycle === undefined
      ? {}
      : { lifecycle: contribution.lifecycle }),
    ...(contribution.visibleWhen === undefined
      ? {}
      : { visibleWhen: contribution.visibleWhen }),
  };
}

/**
 * The add panel's facts for a colliding id. Its row text falls back as the admin's merge reads
 * the description: a registration that restates a plugin's widget without words of its own keeps
 * the plugin's, so a search still finds the row by them. Only the contribution channel names a
 * plugin, so an override leaves the widget under the plugin its users look for it in.
 */
/**
 * The fields read from a declaration's settings, by the admin's own rule for
 * settings: the registration's whole list wherever it states any, else the
 * contribution's. Dropped by the spread in `mergeCanonical`, a merged widget's
 * sheet would bound a note its layout write let through, and a card would be
 * judged by a Collection setting the admin does not draw.
 *
 * 🔴 Both fields from the ONE declaration whose list wins, never field by
 * field: a registration stating settings without a Collection setting would
 * otherwise keep the contribution's, and its cards be withheld and their
 * writes refused by a setting the drawn widget does not have. A declaration
 * states settings exactly when its `textBounds` is present (empty when none
 * is a bounded textarea), so that is what decides.
 */
function settingsFallback(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): Pick<CanonicalWidget, "textBounds" | "collectionSetting"> {
  const { textBounds, collectionSetting } =
    registration.textBounds === undefined ? contribution : registration;
  return {
    ...(textBounds === undefined ? {} : { textBounds }),
    ...(collectionSetting === undefined ? {} : { collectionSetting }),
  };
}

function addPanelFallback(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): Pick<CanonicalWidget, "description" | "category" | "plugin"> {
  const description = registration.description ?? contribution.description;
  const category = registration.category ?? contribution.category;
  return {
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    ...(contribution.plugin === undefined
      ? {}
      : { plugin: contribution.plugin }),
  };
}

/**
 * The registration's card flags, with the contribution's wherever the registration states none.
 *
 * 🔴 The same fallback the admin's `mergeCollision` applies. Left out, a contributed `dismissible`
 * colliding with a registration that states nothing is dropped HERE and kept THERE -- the browser
 * draws a card its reader can send away while the server's canonical copy of the same declaration
 * says nothing about it, which is exactly the two-implementations divergence the merge exists to
 * prevent. `hidesWhenEmpty` falls back the same way, for the same reason.
 */
function flagFallback(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): Pick<CanonicalWidget, "dismissible" | "hidesWhenEmpty"> {
  const dismissible = registration.dismissible ?? contribution.dismissible;
  const hidesWhenEmpty =
    registration.hidesWhenEmpty ?? contribution.hidesWhenEmpty;
  return {
    ...(dismissible === undefined ? {} : { dismissible }),
    ...(hidesWhenEmpty === undefined ? {} : { hidesWhenEmpty }),
  };
}

function mergeCanonical(
  contribution: CanonicalWidget,
  registration: CanonicalWidget
): CanonicalWidget {
  const defaultOrder = registration.defaultOrder ?? contribution.defaultOrder;
  return {
    // The contribution's `allowsSeveral` wherever the registration states
    // none: spread first, so one the registration states replaces it below,
    // as `dismissible` falls back.
    ...(contribution.allowsSeveral === undefined
      ? {}
      : { allowsSeveral: contribution.allowsSeveral }),
    // The registration wholesale first: id, `requiredPermission` and `size`
    // are its to state, including by stating nothing.
    ...registration,
    ...(defaultOrder === undefined ? {} : { defaultOrder }),
    ...flagFallback(contribution, registration),
    ...settingsFallback(contribution, registration),
    ...addPanelFallback(contribution, registration),
    ...lifecycleFallback(contribution, registration),
    // The registration's queries alone, as the admin's merge takes its query
    // and cells: the drawn widget asks what the registration declares, and
    // asks nothing when it declares neither, though the contribution did.
    knobQueries: registration.knobQueries ?? [],
    // Both copies' action gates, because both copies ship: the payload carries
    // each channel's declaration and withholds the actions in each, so every
    // gate either names has to be resolved.
    actionGates: [...gatesOf(contribution), ...gatesOf(registration)],
  };
}

/**
 * Every widget this install has, from both channels, deduplicated by id.
 *
 * 🔴 A REGISTRATION WINS a collision, which is the same precedence the admin's
 * own resolver applies — field by field, through {@link mergeCanonical}, rather
 * than by replacing the contribution outright. The two must agree: if the
 * server resolved a colliding id differently from the admin, the arrangement
 * would order a card by one declaration and draw it from another, and nothing
 * would look wrong.
 *
 * Contributions are taken as already-validated summaries rather than raw
 * declarations, so this module never has to know how a plugin is shaped — and
 * the validation stays where the version boundary is understood.
 *
 * 🔴 Registrations are taken AS THE ADMIN MAY RECEIVE THEM, through
 * `publishableWidgets`, never from the raw registry. A registration JSON
 * cannot carry is skipped by the workspace payload, so the admin never holds
 * it -- but taken from the registry here it still won its collision, and the
 * merged verdict was then the registration's while the declaration that
 * shipped was the contribution's. An ungated registration the browser would
 * never see cleared a gated contribution's prose for every reader. What the
 * install has is what can reach the grid; a registration that cannot is
 * logged by the projection that skips it and exists nowhere else.
 */
export function canonicalWidgets(
  contributed: readonly CanonicalWidget[]
): CanonicalWidget[] {
  const byId = new Map<string, CanonicalWidget>();
  // Contributions first, so a registration with the same id merges over one
  // rather than being dropped by it.
  //
  // 🔴 FIRST WINS among contributions, which is the admin's rule and was not
  // this one's. Widget ids are plugin-local, so two enabled plugins can ship the
  // same one; `resolveDashboardWidgets` walks declarations in order and keeps
  // the first renderable, while `set` here kept the LAST. Where the two
  // declarations differ in permission, size or order, the layout endpoint then
  // filtered and placed one plugin's widget while the grid drew the other's --
  // a card taking another plugin's geometry, or vanishing.
  for (const widget of contributed) {
    if (widget.id && !byId.has(widget.id)) byId.set(widget.id, widget);
  }
  for (const definition of publishableWidgets()) {
    const registration = fromRegistration(definition);
    const contribution = byId.get(definition.id);
    byId.set(
      definition.id,
      contribution ? mergeCanonical(contribution, registration) : registration
    );
  }
  // Each as the site's `overrides` change it, whichever channel supplied it:
  // its sizes are what layouts start and keep its cards at.
  return [...byId.values()].map(widget => withSiteOverride(widget));
}

/**
 * The contributed half, pinned where the registry itself is pinned.
 *
 * On `globalThis`, like every other boot-time widget store, so it survives the
 * module re-evaluation Next.js and Turbopack perform — and so a hot reload that
 * re-registers the same plugins replaces the set rather than accumulating it.
 *
 * Written at boot rather than read from the route handler's config on demand,
 * which is what an earlier version did. Reaching from `api/` into
 * `route-handler/` for boot state inverts the layering — the request path
 * should not have to know how boot stores anything — and it made this question
 * unanswerable in any test that had not mocked the boot module. Populated
 * where every other widget store is populated, it is a plain domain question
 * again.
 */
const globalForContributed = globalThis as unknown as {
  __nextly_contributedWidgets?: CanonicalWidget[];
};

/** Replace the contributed set. Called once per boot, beside the registry. */
export function setContributedWidgets(
  widgets: readonly CanonicalWidget[]
): void {
  globalForContributed.__nextly_contributedWidgets = [...widgets];
}

/**
 * Every widget this install has, from both channels.
 *
 * The question every server-side consumer should ask. `listWidgets()` answers
 * only the imperative registry and is the reason a contributed widget could
 * render and never be arranged.
 *
 * Every widget here was DECLARED by core, a plugin or the site: core mints no
 * card from the install's own content, so this is also the set the default
 * arrangement is materialized from, with no narrower view of it to keep.
 */
export function allWidgets(): CanonicalWidget[] {
  return canonicalWidgets(
    globalForContributed.__nextly_contributedWidgets ?? []
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
 * `sizeBounds`; a contribution that states no size is read as
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
