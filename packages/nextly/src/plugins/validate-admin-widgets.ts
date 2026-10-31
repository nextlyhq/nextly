/**
 * Validating widgets in the older `contributes.admin.widgets` shape and
 * reducing them to the values the browser receives, and the startup gate that
 * refuses a plugin carrying that key at all.
 *
 * Startup refuses `contributes.admin.widgets` and `contributes.widgetSources`
 * (`./removed-widget-keys`): a plugin's widgets are declared with
 * `defineWidget` under `contributes.dashboard`. The reduction below still
 * answers for whatever reaches it without passing startup, so the admin-meta
 * serializer cannot publish a value `JSON.stringify` cannot carry.
 *
 * A contributed widget never passes through `registerWidget`, so the widget
 * REGISTRY's `structuredClone` gate does not stand between it and the wire —
 * `buildPluginAdminMeta` copies the declaration verbatim. `WidgetQuery.where`
 * is a `Record<string, unknown>`, so a bigint under it is type-legal, and
 * `structuredClone` would carry it happily where `JSON.stringify` throws. This
 * is the gate that closes the difference.
 *
 * @module plugins/validate-admin-widgets
 */

import {
  actionGatesOf,
  collectionSettingField,
  knobQueriesField,
  settingsField,
  textBoundsField,
  type CanonicalWidget,
} from "../domains/widgets/canonical";
import type { WidgetArchetype } from "../domains/widgets/definition";
import {
  actionProblem,
  archetypeResultProblem,
  chromeFieldProblem,
  DATA_ARCHETYPES,
  defaultOrderProblem,
  querylessQueryProblem,
  CELL_ARCHETYPES,
  cellsProblem,
  customAsksTwiceProblem,
  QUERYLESS_ARCHETYPES,
  rangedLimitSettingProblem,
  textContentProblem,
  widgetValueProblem,
} from "../domains/widgets/definition";
import type { WidgetQuerySpec } from "../domains/widgets/query";
import {
  settingsSourceOf,
  widgetSettingsProblem,
} from "../domains/widgets/settings";

import type { PluginAdminWidget } from "./admin-contributions";
import { adminWidgetError, adminWidgetShapeError } from "./admin-widget-error";
import { jsonOnly, unserializableKeys } from "./json-round-trip";
import type { PluginDefinition } from "./plugin-context";
import {
  assertNoRemovedWidgetKeys,
  carriedRemovedKey,
} from "./removed-widget-keys";

/**
 * How a widget with no usable `id` is named in the failure.
 *
 * `id` is required by the type and this runs on values a JavaScript host may
 * have written, so the diagnostic must still say something. Naming the position
 * is what lets an author find it.
 */
function widgetLabel(widget: unknown, index: number): string {
  const id: unknown = (widget as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.trim() !== "" ? id : `#${index}`;
}

/**
 * Whether a decoded property carries real, non-whitespace text.
 *
 * Trimmed rather than length-checked: a component path made of spaces resolves
 * no better than an empty one, which is the same reading
 * `validateWidgetDefinition` takes of a `custom` widget's component.
 */
function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Archetypes core fills from a query result, as a set for lookup. */
const DATA_ARCHETYPE_SET: ReadonlySet<string> = new Set(DATA_ARCHETYPES);

/** Archetypes core draws without asking for data. */
const QUERYLESS_ARCHETYPE_SET: ReadonlySet<string> = new Set(
  QUERYLESS_ARCHETYPES
);
const CELL_ARCHETYPE_SET: ReadonlySet<string> = new Set(CELL_ARCHETYPES);

/**
 * Why core cannot draw a QUERYLESS widget from its declaration, or `undefined`.
 *
 * Its own function rather than a branch inside {@link describesDrawableBody},
 * because two callers ask it: that one, deciding whether a body exists at all,
 * and {@link undrawableReason}, holding the declaration to its shape even when
 * a component is supplied beside it. One question, one implementation -- the
 * two would otherwise agree today and drift silently.
 *
 * `actions` IS its shortcuts, so an empty one describes an empty card. Every
 * item goes through the SAME rule the registry applies: checking only that the
 * array was non-empty let a JavaScript plugin publish `actions: [{}]`, which
 * the admin drew as a blank link with an undefined destination -- while a
 * registered widget carrying that shortcut was refused. One contract, two
 * channels, one rule.
 *
 * The other queryless archetypes are drawn from the declaration alone and need
 * nothing further here.
 */
function querylessProblem(widget: Record<string, unknown>): string | undefined {
  // Through the SAME rule the registry applies. A queryless archetype is drawn
  // from its declaration, so a query beside it is never read -- and because
  // `coreDraws` is true for one, the grid batched a request per mount and
  // refetch for a result the declared renderer discards.
  const queryProblem = querylessQueryProblem(widget.archetype, widget.query);
  if (queryProblem !== undefined) return queryProblem;

  // `text` IS its prose, through the same rule the registry applies.
  if (widget.archetype === "text") {
    const problem = textContentProblem(widget.content);
    return problem === undefined
      ? undefined
      : `names the "text" archetype and ${problem.replace(/^archetype "text" /, "")}`;
  }

  if (widget.archetype !== "actions") return undefined;

  if (!Array.isArray(widget.actions) || widget.actions.length === 0) {
    return 'names the "actions" archetype, which IS its shortcuts, and declares none';
  }

  for (const [index, action] of widget.actions.entries()) {
    const problem = actionProblem(action);
    if (problem !== undefined) {
      return `declares an unusable shortcut at #${index}: ${problem}`;
    }
  }

  return undefined;
}

/**
 * Whether this widget describes a body CORE can draw without the plugin.
 *
 * DERIVED from core's two vocabularies rather than restated. Restating it is
 * exactly how this went wrong once: "every archetype but `custom` needs a
 * query" sounds right, and it made `text` and `actions` undeclarable while
 * contradicting `validateWidgetDefinition`, which REFUSES a query on those two.
 * One question, one implementation.
 *
 * So the pair is the unit for a DATA archetype and the archetype alone is the
 * unit for a queryless one. A `metric` without a query describes a card core
 * can never fill -- no request is made for it, no slot arrives, and the grid
 * reads that absence as still loading for the life of the page.
 *
 * An archetype in NEITHER set is not judged here at all: it belongs to a newer
 * core. Requiring a query of it would be guessing which half of a vocabulary
 * we do not have.
 *
 * `query` is checked for being an OBJECT and no further. What is inside it is
 * `validateWidgetQuery`'s job, at the point the query runs and against the
 * source registry that only exists then; duplicating any of it here would be a
 * second opinion that can disagree with the one that decides.
 */
function describesDrawableBody(widget: Record<string, unknown>): boolean {
  const archetype = widget.archetype;
  if (typeof archetype !== "string" || archetype === "custom") return false;

  if (QUERYLESS_ARCHETYPE_SET.has(archetype)) {
    return querylessProblem(widget) === undefined;
  }

  if (CELL_ARCHETYPE_SET.has(archetype)) {
    // 🔴 Through the REGISTRY's own cell rule, not a similar one written here.
    // Checking only that the array was non-empty published contributions the
    // registry refuses -- a `list` query, a missing query, two cells under one
    // key -- which then render as silent dashes or one answer drawn twice.
    // A stats card also takes no top-level query, the same pair
    // `validateWidgetDefinition` refuses, so a contribution carrying both
    // describes two bodies and is not drawable as either.
    if (widget.query !== undefined) return false;
    return cellsProblem(widget.cells) === undefined;
  }

  if (DATA_ARCHETYPE_SET.has(archetype)) {
    return typeof widget.query === "object" && widget.query !== null;
  }

  // Unrecognised, and therefore a newer core's. Accepted: the card reports
  // itself, and the install stands.
  return true;
}

/**
 * Why a widget cannot be drawn at all, or `undefined` when it can.
 *
 * TWO ways to describe a body, because there are two tiers and the contract has
 * to be able to say so. A plugin either ships a component and draws its own
 * card, or it declares an archetype and a query and the HOST draws it -- which
 * is the tier the whole widget query contract exists for, and which this gate
 * previously made unreachable by requiring `component` on every widget.
 *
 * That requirement was justified on `PluginWidgetGrid` (since deleted) being
 * "the only
 * consumer", and it renders `PluginSlot path={widget.component}`, so a widget
 * with no component drew an empty cell. `WidgetGrid` replaced it and nothing
 * mounts `PluginWidgetGrid` any more: the current grid draws a `metric` from
 * its query and says so by name when it cannot draw an archetype yet. The
 * premise the rule rested on is gone, and the rule outlived it.
 *
 * `id` is still required unconditionally. It keys the grid cell, so a blank one
 * collides with every other blank one and React reconciles two different
 * widgets as one.
 */
/**
 * The field checks a widget must pass whatever kind of body it describes.
 *
 * A LIST rather than a ladder of `if`s, because this is a growing set with no
 * ordering between its members -- each asks about one field and none depends on
 * another's answer. Every addition was previously another branch in one
 * function, which is how it reached the point where the shape of the function
 * hid what it was doing.
 *
 * First problem wins, so the diagnostic names the field an author can act on
 * rather than the last one checked.
 */
const FIELD_RULES: ReadonlyArray<
  (widget: Record<string, unknown>) => string | undefined
> = [
  // `id` keys the grid cell, so a blank one collides with every other blank one
  // and React reconciles two different widgets as one.
  widget => (isUsableText(widget.id) ? undefined : 'declares no usable "id"'),

  // A SUPPLIED component must be usable, whether or not the declarative route
  // would also have carried this widget. Checking it only as an ALTERNATIVE let
  // `component: "   "` through beside a valid archetype and query -- and the
  // admin resolver reads the component for TRUTHINESS, not usability, so a
  // whitespace string won the archetype fallback, reached `PluginSlot` as a
  // path nothing resolves, and drew a blank card where the archetype's own
  // "not rendered yet" diagnostic belonged. An absent component is a choice; an
  // unusable one is a mistake, and only the second is worth refusing.
  widget =>
    widget.component !== undefined && !isUsableText(widget.component)
      ? 'supplies a "component" that is empty or not a string'
      : undefined,

  // Through the SAME rule the registry applies. This channel had no order check
  // at all, so `defaultOrder: "soon"` shipped and the admin's comparator made
  // it `NaN` -- which compares false against every value, so the widget sorted
  // as equal to whatever it was measured against and the explicit orders around
  // it quietly stopped holding.
  widget => defaultOrderProblem(widget.defaultOrder),

  // Through the SAME rule the registry applies: a custom card asking through
  // both a query and cells would have its query ignored by the admin, which
  // takes the cells, while the identical registered definition is refused.
  customAsksTwiceProblem,

  // Through the SAME rule the registry applies: a "limit" setting beside a
  // ranged query would fail every request it changed.
  rangedLimitSettingProblem,

  // Through the SAME rule the registry applies, and it is the rule ITSELF
  // rather than a second spelling of it. This channel had no settings check at
  // all, so `settings: {}` from an untyped declaration passed the JSON gate,
  // travelled to the admin, and threw out of `applyWidgetSettings` while the
  // grid was rendering -- taking the whole dashboard down rather than the one
  // install that declared it.
  // Judged on the widget's own source, as registration judges it.
  widget =>
    widgetSettingsProblem(widget.settings, false, settingsSourceOf(widget)),

  // Through the SAME rule the registry applies: no widget declines the frame.
  widget => chromeFieldProblem(widget),

  // The rules that hold whatever core version a plugin was built against: a
  // title that is a string, a query that is an object, a size in grid units
  // within its own bounds, and `actions` on an archetype it recognises.
  //
  // Vocabulary checks are deliberately NOT among them. A contribution crosses a
  // version boundary, so refusing a value from a vocabulary this core has not
  // learned yet would abort a whole plugin install over a card the admin
  // renders anyway -- those belong to `validateWidgetDefinition`, which judges
  // the resolved widget rather than a declaration from an unknown vintage.
  widget => widgetValueProblem(widget),

  // A QUERYLESS archetype is drawn from its declaration ALONE, so a component
  // beside it is a fallback for an admin too old to draw the archetype -- never
  // a substitute for a well-formed declaration. A current admin prefers the
  // host renderer and reads this same declaration, so checking the shortcuts
  // only as the ALTERNATIVE to a component meant naming one skipped the rule,
  // and `actions: [{}]` beside a component reached the grid as exactly the
  // blank link that rule exists to prevent.
  //
  // The queryless half only. A DATA archetype missing its query is a card core
  // genuinely cannot fill, so the admin reports it undrawable and the component
  // fallback is what renders -- refusing that here would reject a widget which
  // draws correctly today.
  widget =>
    typeof widget.archetype === "string" &&
    QUERYLESS_ARCHETYPE_SET.has(widget.archetype)
      ? querylessProblem(widget)
      : undefined,

  // Through the SAME table the registry applies, for the reason the queryless
  // rule above reuses `querylessQueryProblem`: a contribution that pairs an
  // archetype with a result core cannot draw from is the same mistake wherever
  // it is declared, and restating the pairing here would let the two drift.
  //
  // A card declared this way registers, executes, and is then replaced by the
  // body's own "wrong result" message on every load -- so boot is the last
  // point the author can be told.
  widget => {
    const problem = archetypeResultProblem(
      widget.archetype as WidgetArchetype,
      widget.query as WidgetQuerySpec | undefined
    );
    return problem === undefined ? undefined : problem;
  },
];

/**
 * The source a contributed widget's settings knobs see, as registration reads
 * a definition's: its query's own; none yet (`undefined`) for a query or cells
 * a Collection setting supplies; `null` for a widget that asks nothing a knob
 * could drive.
 */
function undrawableReason(widget: Record<string, unknown>): string | undefined {
  for (const rule of FIELD_RULES) {
    const problem = rule(widget);
    if (problem !== undefined) return problem;
  }

  if (isUsableText(widget.component)) return undefined;
  if (describesDrawableBody(widget)) return undefined;
  return (
    'describes no body: it needs either a usable "component", or an ' +
    '"archetype" other than "custom" together with the "query" core draws it ' +
    "from"
  );
}

/**
 * The widgets a plugin will publish, or `undefined` when it declares none.
 *
 * Returns the DECODED values rather than the caller's objects, so what boot
 * approved is what ships — a getter that answered once for the check cannot
 * answer differently for the serialization.
 *
 * Throws {@link adminWidgetError} naming the first widget that cannot be
 * delivered unchanged.
 */
export function validatedAdminWidgets(
  plugin: PluginDefinition
): PluginAdminWidget[] | undefined {
  const carried = carriedRemovedKey(plugin, "admin.widgets");
  if (carried === undefined) return undefined;
  if (!Array.isArray(carried)) {
    throw adminWidgetError(plugin.name, "#0", []);
  }
  // Read as unknown entries: the key is no field of the contributions type,
  // so nothing about what it holds is known until each entry is checked.
  const declared: readonly unknown[] = carried;

  const publishable: PluginAdminWidget[] = [];
  for (const [index, widget] of declared.entries()) {
    const label = widgetLabel(widget, index);
    if (typeof widget !== "object" || widget === null) {
      throw adminWidgetError(plugin.name, label, []);
    }
    const serializable = jsonOnly(widget);
    if (serializable === undefined) {
      throw adminWidgetError(plugin.name, label, unserializableKeys(widget));
    }
    // On the DECODED value, and after the round trip, so what is checked is
    // exactly what ships. Before this, `jsonOnly` was the only gate a
    // contributed widget passed, and it has nothing to say about a field being
    // blank or absent: `{ id: "stats", component: "" }` is perfectly good
    // JSON, so it was cast to `PluginAdminWidget` and published, and the grid
    // drew an empty card from it.
    const undrawable = undrawableReason(serializable);
    if (undrawable !== undefined) {
      throw adminWidgetShapeError(plugin.name, label, undrawable);
    }
    publishable.push(serializable as unknown as PluginAdminWidget);
  }
  return publishable;
}

/**
 * Boot-time check over every plugin, disabled ones included: refuses a plugin
 * that adds widgets or widget data sources through a key other than
 * `contributes.dashboard`, naming the plugin, the key and the replacement.
 *
 * Plugin resolution runs it over the declared list and again over the list
 * `setup` transformers leave, so a transformer cannot add either key back.
 */
export function assertAdminWidgets(plugins: PluginDefinition[]): void {
  assertNoRemovedWidgetKeys(plugins);
}

/**
 * Every contributed widget across every plugin, reduced to the summary layout
 * resolution reads.
 *
 * Built from `validatedAdminWidgets`, which is the same reduction admin-meta
 * publishes — so the server's canonical set and the payload the admin renders
 * from cannot disagree about which contributed widgets exist. A plugin whose
 * declaration this validator refuses contributes nothing here, exactly as it
 * contributes nothing to the admin.
 *
 * Reads the fields WITHOUT narrowing them: a contribution may come from a
 * plugin built against a newer core, so `archetype` is copied as whatever
 * string it is rather than checked against this core's vocabulary. Refusing an
 * unknown one here would drop the whole card from the arrangement over a value
 * the admin already survives.
 */
/** A contributed field, when it is a usable string. */
function contributedText(
  declaration: Record<string, unknown>,
  field: string
): string | undefined {
  const value = declaration[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * How long a contributed card stays, and who may send it away.
 *
 * Its own function rather than three more spreads inline: `toSummary` already
 * answers several unrelated questions -- identity, gates, size, order -- and
 * the lifecycle trio is one of them, with reasoning long enough that keeping it
 * in the body pushed the whole function past the complexity gate.
 *
 * Carried so a contributed card can be transient too. Dropped here, the layout
 * server reads no lifecycle and treats the card as PERMANENT -- silently,
 * because a widget that never lapses looks exactly like one declared permanent.
 * `widgetValueProblem` has already refused an unknown condition, or a lifecycle
 * and condition that do not agree, so what reaches here is a pair this host can
 * act on.
 */
function lifecycleOf(
  declaration: Record<string, unknown>
): Partial<CanonicalWidget> {
  return {
    ...(typeof declaration.lifecycle === "string"
      ? { lifecycle: declaration.lifecycle }
      : {}),
    ...(typeof declaration.visibleWhen === "string"
      ? { visibleWhen: declaration.visibleWhen }
      : {}),
    // Boolean rather than truthy: a contribution carrying `dismissible: "yes"`
    // is a declaration mistake, and publishing it as `true` would honour a
    // value the author never wrote.
    ...(declaration.dismissible === true ? { dismissible: true } : {}),
    ...(declaration.hidesWhenEmpty === true ? { hidesWhenEmpty: true } : {}),
  };
}

function toSummary(widget: PluginAdminWidget): CanonicalWidget | undefined {
  const declaration = widget as unknown as Record<string, unknown>;
  const id = contributedText(declaration, "id");
  if (id === undefined) return undefined;

  /*
   * 🔴 Read through the GATE's own reader, never `contributedText`. A gate may
   * be a slug or an any-of array, and the string-only helper answered
   * `undefined` for the array -- which this summary spells as "no
   * requiredPermission", so `holdsWidgetPermission` returned true and the
   * layout endpoint published the card's id and default placement to every
   * authenticated reader. The browser hid it, so the only visible symptom was a
   * card missing for someone who should have had it, while the disclosure had
   * already happened on the wire.
   *
   * Carried VERBATIM when present, rather than normalised or filtered here.
   * `holdsWidgetPermission` is the one place that decides what a gate means,
   * including that a present-but-unusable one refuses -- so passing the value
   * through unchanged is what keeps this summary from becoming a second opinion
   * about it. Dropping an unusable gate would turn it into no gate, which is
   * the same fail-open one level down.
   */
  const requiredPermission = declaration.requiredPermission as
    | string
    | readonly string[]
    | undefined;
  const defaultOrder = declaration.defaultOrder;

  // What the add panel shows on the widget's row: its line of description,
  // its category as a label, and the sketch its archetype picks. Text only,
  // and absent rather than empty when the declaration states none.
  const panelText = Object.fromEntries(
    (["description", "category", "archetype"] as const).flatMap(field => {
      const value = contributedText(declaration, field);
      return value === undefined ? [] : [[field, value]];
    })
  ) as Pick<CanonicalWidget, "description" | "category" | "archetype">;

  return {
    id,
    ...panelText,
    ...(requiredPermission === undefined ? {} : { requiredPermission }),
    // The gates inside an `actions` declaration, verbatim, for the same
    // reason the card's own gate is.
    actionGates: actionGatesOf(declaration.actions),
    // Its size, verbatim when stated: `widgetValueProblem` has already refused
    // one the grid cannot draw or whose default lies outside its own bounds.
    // Absent when unstated, so `sizeFacts` reads it as the admin does.
    ...(widget.size === undefined ? {} : { size: widget.size }),
    // `Number.isFinite`, so a `NaN` or an infinity a plugin computed cannot
    // become a sort key that puts the card nowhere in particular.
    ...(typeof defaultOrder === "number" && Number.isFinite(defaultOrder)
      ? { defaultOrder }
      : {}),
    ...lifecycleOf(declaration),
    // The bounds its textarea settings state, which the layout write holds
    // a placement's text to: a contribution's settings passed the registry's
    // own check above, so they are read as declared.
    ...textBoundsField(widget.settings),
    // Its settings, so the layout write holds a changed value to the rule it
    // is read back by.
    ...settingsField(widget.settings),
    // Its Collection setting, so a card is judged by the collection it reads
    // whichever channel declared the widget.
    ...collectionSettingField(widget.settings),
    // What its settings may drive, so a Collection setting no knob reaches
    // on its query decides nothing about which of its cards are withheld.
    ...knobQueriesField(widget),
  };
}

/**
 * Every contributed widget across every plugin, reduced to the summary layout
 * resolution reads.
 *
 * Built from `validatedAdminWidgets`, which is the same reduction admin-meta
 * publishes — so the server's canonical set and the payload the admin renders
 * from cannot disagree about which contributed widgets exist. A plugin whose
 * declaration that validator refuses contributes nothing here, exactly as it
 * contributes nothing to the admin.
 */
export function contributedWidgetSummaries(
  plugins: readonly PluginDefinition[]
): CanonicalWidget[] {
  return plugins.flatMap(plugin =>
    // 🔴 Disabled plugins contribute NOTHING, matching `buildPluginAdminMeta`,
    // which withholds every behavioural admin surface — menu, pages, settings,
    // widgets — from a plugin the config has switched off. Without this the two
    // answers drifted: the layout endpoint put a disabled plugin's widget ids
    // into default placements, into `available` and into the scope token, while
    // the admin had no declaration to draw any of them with. Ghost cards the
    // reader could arrange and never see.
    //
    // `enabled !== false` rather than `enabled === true`, because the field is
    // optional and its absence means enabled — the same reading admin-meta,
    // `reload-config` and the field-type registry each apply.
    plugin.enabled === false
      ? []
      : (validatedAdminWidgets(plugin) ?? [])
          .map(toSummary)
          .filter(
            (summary): summary is CanonicalWidget => summary !== undefined
          )
          // Which plugin it came from, so the add panel lists it under that
          // plugin: core assigns a contributed widget's group, and the
          // summary is the only place the plugin is still known.
          .map(summary => ({ ...summary, plugin: plugin.name }))
  );
}
