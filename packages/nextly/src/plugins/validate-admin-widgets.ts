/**
 * Validating a plugin's `contributes.admin.widgets` and reducing them to the
 * values the browser receives.
 *
 * The same two-caller shape as `./validate-client-config`, for the same reason:
 * boot rejects a widget that cannot be delivered before anything depends on it,
 * and the admin-meta serializer needs the reduced value. One implementation, so
 * the request path cannot accept what boot refused.
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
  actionProblem,
  chromeProblem,
  DATA_ARCHETYPES,
  defaultOrderProblem,
  querylessQueryProblem,
  QUERYLESS_ARCHETYPES,
  widgetValueProblem,
  WIDGET_ARCHETYPES,
} from "../domains/widgets/definition";
import { getNextlyLogger } from "../observability/logger";

import type { PluginAdminWidget } from "./admin-contributions";
import { adminWidgetError, adminWidgetShapeError } from "./admin-widget-error";
import { jsonOnly, unserializableKeys } from "./json-round-trip";
import type { PluginDefinition } from "./plugin-context";

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
 * core, and `warnUnknownArchetype` has already let it through. Requiring a
 * query of it would be guessing which half of a vocabulary we do not have.
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

  if (DATA_ARCHETYPE_SET.has(archetype)) {
    return typeof widget.query === "object" && widget.query !== null;
  }

  // Unrecognised, and therefore a newer core's. Accepted for the same reason
  // `warnUnknownArchetype` does not throw: the card reports itself, and the
  // install stands.
  return true;
}

/**
 * Says so when a widget names an archetype this core does not know, WITHOUT
 * refusing it.
 *
 * A boot failure here would be the worst outcome available. `assertAdminWidgets`
 * runs during plugin resolution, so a throw aborts the install -- and the
 * reachable cause is a plugin built against a NEWER core naming an archetype
 * this one has not learned yet. Trading the whole admin for one card it cannot
 * draw is not a trade anyone would choose, and it is the opposite of the
 * blast-radius argument the other refusals in this file rest on: those exist
 * because ONE unserializable widget breaks the workspace payload for every
 * admin. An unrecognised archetype is perfectly serializable. It costs its own
 * card and nothing else, and the grid already reports it there by name.
 *
 * Grafana answers the same question the same way -- an unknown panel type
 * renders "Panel plugin not found" in that panel and the dashboard stands --
 * and VS Code drops a single unrecognised contribution rather than the
 * extension.
 *
 * Logged rather than swallowed, because the other reachable cause is a typo,
 * and "metrics" for "metric" is a mistake whose card reads "not rendered yet"
 * -- a sentence that suggests waiting rather than fixing.
 *
 * Called from `assertAdminWidgets` and NOWHERE else, which is the boot gate and
 * runs once. `validatedAdminWidgets` is the wrong home for it despite being
 * where the check would naturally sit: `buildPluginAdminMeta` calls it on every
 * `/api/admin-meta` request, that route is public and unauthenticated because
 * the sign-in screen renders before a session exists, and the responses are
 * `no-store`. One mistyped archetype would have written a warning line per
 * anonymous request, forever -- burying the one occurrence that says something
 * under a stream of identical ones.
 */
/**
 * What has already been warned about, as `plugin\u0000widget\u0000archetype`.
 *
 * `assertAdminWidgets` is called more than once per boot -- `registerServices`
 * runs it through `resolvePlugins` and then again on the transformed list, and
 * the CLI follows the same two-pass shape -- so an unchanged widget produced the
 * same warning at least twice. A diagnostic that repeats itself reads as two
 * problems, and the author counting occurrences learns nothing from the second.
 *
 * Module-level, so it lives as long as the process the warning describes. NUL as
 * the separator because a plugin name or widget id may contain anything else.
 */
const WARNED_ARCHETYPES = new Set<string>();

/**
 * Forgets what has been warned about.
 *
 * For tests, which share one module instance across cases and would otherwise
 * find the second case silent because the first already warned -- the same
 * reason `clearWidgets` exists on the registry. A running app never calls it:
 * the set describes one process, and re-warning inside it is exactly what was
 * being fixed.
 */
export function resetArchetypeWarnings(): void {
  WARNED_ARCHETYPES.clear();
}

function warnUnknownArchetype(
  pluginName: string,
  widget: { id?: unknown; archetype?: unknown }
): void {
  const archetype = widget.archetype;
  if (typeof archetype !== "string") return;
  if (
    WIDGET_ARCHETYPES.includes(archetype as (typeof WIDGET_ARCHETYPES)[number])
  ) {
    return;
  }
  const widgetId = typeof widget.id === "string" ? widget.id : "";
  const seenKey = `${pluginName}\u0000${widgetId}\u0000${archetype}`;
  if (WARNED_ARCHETYPES.has(seenKey)) return;
  WARNED_ARCHETYPES.add(seenKey);

  getNextlyLogger().warn({
    kind: "widget-archetype-unknown",
    plugin: pluginName,
    widget: widgetId === "" ? undefined : widgetId,
    archetype,
    known: WIDGET_ARCHETYPES,
    message:
      `Plugin "${pluginName}" contributes a widget with archetype ` +
      `"${archetype}", which this version of Nextly does not draw. Its card ` +
      "will say so and the rest of the dashboard is unaffected. If that is a " +
      "typo, the known archetypes are: " +
      WIDGET_ARCHETYPES.join(", ") +
      ".",
  });
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

  // Through the SAME rule the registry applies. Without it a contributed
  // `{ archetype: "metric", chrome: "none" }` passed boot while the registry
  // refused the identical declaration, and the admin then ignored the value --
  // so the documented refusal was true of one channel only.
  widget => chromeProblem(widget.chrome, widget.archetype),

  // The rules that hold whatever core version a plugin was built against: a
  // title that is a string, a query that is an object, orderings between sizes
  // this core can rank, and `actions` on an archetype it recognises.
  //
  // Vocabulary checks are deliberately NOT among them. A contribution crosses a
  // version boundary, so refusing a size, height or chrome value this core has
  // not learned yet would abort a whole plugin install over a card the admin
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
];

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
  const declared = plugin.contributes?.admin?.widgets;
  if (declared === undefined) return undefined;
  if (!Array.isArray(declared)) {
    throw adminWidgetError(plugin.name, "#0", []);
  }

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
 * Boot-time check over every plugin, disabled ones included.
 *
 * Disabled plugins are checked too even though `buildPluginAdminMeta` withholds
 * their widgets. Enabling a plugin is a config edit, not a code change, and it
 * must not be the thing that turns a healthy install into a workspace endpoint
 * that answers 500 — boot is where that is still cheap to say.
 */
export function assertAdminWidgets(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    // The widgets that survived, so the warning describes what will actually be
    // published rather than what was declared.
    const widgets = validatedAdminWidgets(plugin) ?? [];
    for (const widget of widgets) {
      warnUnknownArchetype(plugin.name, widget);
    }
  }
}
