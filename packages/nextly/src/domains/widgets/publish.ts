/**
 * The registered widgets as the admin may receive them.
 *
 * The registry is the single place that knows which widgets exist in a running
 * app, and `registerWidget` is the public API an app or plugin uses to add one.
 * Nothing carried that store to the browser, so the admin grid could only ever
 * render `contributes.admin.widgets` -- a plugin that registered a widget and
 * did not ALSO declare it as a contribution was invisible to its own renderer.
 * This is the projection that closes that gap.
 *
 * Per widget rather than per payload, and that is the whole reason this is a
 * function rather than a `listWidgets()` call at the call site. A registration
 * happens in code at boot, so unlike `contributes.admin.widgets` it never passed
 * `assertAdminWidgets` -- the registry's own gate is `structuredClone`, which
 * carries a `BigInt` under `WidgetQuery.where` happily where `JSON.stringify`
 * throws. One such widget would take the whole authenticated workspace payload
 * down for every admin. Skipping the offender and logging it costs that one
 * widget its card and leaves the dashboard standing.
 *
 * @module domains/widgets/publish
 */

import { getNextlyLogger } from "../../observability/logger";
import { jsonOnly, unserializableKeys } from "../../plugins/json-round-trip";

import type { WidgetDefinition } from "./definition";
import { listWidgets } from "./registry";

/**
 * Every registered widget that survives the trip to the browser unchanged, in
 * registration order.
 *
 * Returns the DECODED value rather than the stored object, so what is checked is
 * exactly what ships -- the same reading `validatedAdminWidgets` takes of a
 * contributed widget, and for the same reason.
 */
export function publishableWidgets(): WidgetDefinition[] {
  const byId = new Map<string, WidgetDefinition>();

  for (const definition of listWidgets()) {
    const serializable = jsonOnly(definition);
    if (serializable === undefined) {
      getNextlyLogger().error({
        kind: "widget-not-serializable",
        widget: definition.id,
        keys: unserializableKeys(definition),
      });
      continue;
    }
    const widget = serializable as unknown as WidgetDefinition;
    byId.set(widget.id, widget);
  }

  return [...byId.values()];
}
