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
import { adminWidgetError } from "./admin-widget-error";
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
