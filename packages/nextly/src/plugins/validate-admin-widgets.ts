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
 * The two fields the admin grid cannot draw a widget without, and what each is
 * for.
 *
 * Checked HERE rather than by borrowing `validateWidgetDefinition`, which
 * validates a different shape and would reject valid contributions. That
 * validator requires `title`, `archetype` and `defaultSize` -- all OPTIONAL on
 * `PluginAdminWidget` -- insists on `namespace/name` for the id, which this
 * contract puts no shape on at all, and FORBIDS `component` on any archetype
 * but `custom`, where this contract requires it on every widget. The two
 * disagree field for field, so the reuse would be a name rather than a shared
 * decision.
 *
 * `id` keys the grid cell, so a blank one collides with every other blank one
 * and React reconciles two different widgets as one. `component` is the only
 * thing the grid draws: `PluginWidgetGrid` passes it to `PluginSlot`, and an
 * empty or absent path renders a blank card.
 */
const REQUIRED_WIDGET_TEXT = ["id", "component"] as const;

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
 * The name of the first required field this widget cannot supply, or
 * `undefined` when both are present.
 *
 * Reads the DECODED value rather than the caller's object, so a getter that
 * answered once for this check cannot answer differently for the
 * serialization -- the same reason `validatedAdminWidgets` publishes the
 * decoded value.
 */
function missingRequiredText(
  widget: Record<string, unknown>
): string | undefined {
  return REQUIRED_WIDGET_TEXT.find(field => !isUsableText(widget[field]));
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
    const missing = missingRequiredText(serializable);
    if (missing !== undefined) {
      throw adminWidgetShapeError(
        plugin.name,
        label,
        `declares no usable "${missing}"`
      );
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
  for (const plugin of plugins) validatedAdminWidgets(plugin);
}
