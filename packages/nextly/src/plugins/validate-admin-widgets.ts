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

import { WIDGET_ARCHETYPES } from "../domains/widgets/definition";
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

/**
 * Whether this widget describes a body CORE can draw without the plugin.
 *
 * The archetype alone is not enough and that is the whole check. Every
 * archetype but `custom` is drawn FROM A QUERY RESULT, so one declared without
 * a query describes a card core can never fill: no request is made for it, no
 * slot ever arrives, and the grid reads that absence as "still loading" for the
 * life of the page. The pair is the unit that means something.
 *
 * The archetype is NOT checked against `WIDGET_ARCHETYPES` here, and that is
 * deliberate rather than an omission -- see `warnUnknownArchetype`. Refusing an
 * unrecognised one would abort plugin resolution for the whole install.
 *
 * `query` is checked for being an OBJECT and no further. What is inside it is
 * `validateWidgetQuery`'s job, at the point the query runs and against the
 * source registry that only exists then; duplicating any of it here would be a
 * second opinion that can disagree with the one that decides.
 */
function describesDrawableBody(widget: Record<string, unknown>): boolean {
  return (
    typeof widget.archetype === "string" &&
    widget.archetype !== "custom" &&
    widget.archetype.trim() !== "" &&
    typeof widget.query === "object" &&
    widget.query !== null
  );
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
 */
function warnUnknownArchetype(
  pluginName: string,
  widget: Record<string, unknown>
): void {
  const archetype = widget.archetype;
  if (typeof archetype !== "string") return;
  if (
    WIDGET_ARCHETYPES.includes(archetype as (typeof WIDGET_ARCHETYPES)[number])
  ) {
    return;
  }
  getNextlyLogger().warn({
    kind: "widget-archetype-unknown",
    plugin: pluginName,
    widget: typeof widget.id === "string" ? widget.id : undefined,
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
 * That requirement was justified on `PluginWidgetGrid` being "the only
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
function undrawableReason(widget: Record<string, unknown>): string | undefined {
  if (!isUsableText(widget.id)) return 'declares no usable "id"';
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
    warnUnknownArchetype(plugin.name, serializable);
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
  for (const plugin of plugins) validatedAdminWidgets(plugin);
}
