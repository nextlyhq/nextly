import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for a `contributes.admin.widgets` entry that cannot be
 * delivered to the browser.
 *
 * Mirrors {@link ./client-config-error}: the public message stays generic while
 * the detail an author needs — which plugin, which widget, and which keys did
 * not survive — goes to `logContext`, where a boot failure is read.
 *
 * A boot failure rather than a dropped widget, and the blast radius is why. A
 * contributed widget is copied into the `/api/admin-meta/workspace` payload,
 * which is serialized by ONE `JSON.stringify`. A value that throws there — a
 * bigint under `query.where` is the reachable one, since `WidgetQuery.where` is
 * a `Record<string, unknown>` — does not break the widget's own card: it breaks
 * the whole authenticated workspace response, for every admin, on every page
 * load. One plugin's typo, the entire admin.
 */
export function adminWidgetError(
  pluginName: string,
  widgetId: string,
  offendingKeys: string[]
): NextlyError {
  return new NextlyError({
    // No `statusCode` here: the code is registered in `NEXTLY_ERROR_STATUS`, so
    // it resolves from that one table rather than being restated per factory.
    code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage:
      `Plugin "${pluginName}" contributes an admin widget "${widgetId}" that ` +
      `is not JSON` +
      (offendingKeys.length > 0 ? ` (keys: ${offendingKeys.join(", ")})` : "") +
      ". It is serialized into /api/admin-meta/workspace, so it may hold only " +
      "strings, numbers, booleans, null, arrays and plain objects — no " +
      "functions, class instances, Dates, Maps or bigints. A bigint in " +
      "query.where throws while the whole workspace payload is serialized, " +
      "which fails that request for every admin rather than just this card.",
    logContext: { plugin: pluginName, widget: widgetId, keys: offendingKeys },
  });
}

/**
 * Fail-fast boot error for a `contributes.admin.widgets` entry that is
 * malformed rather than unserializable.
 *
 * A sibling of {@link adminWidgetError} rather than a widening of it: both
 * refuse the same contribution at the same moment and carry the same code, so
 * they share the registered status and the generic public message, but the
 * SENTENCE an author has to act on is the whole value of a boot failure and
 * "not JSON" is not what happened here.
 *
 * A throw rather than a skipped widget, matching its sibling and for a related
 * reason: an entry the type says cannot exist is a plugin-author mistake, and
 * boot is where it is still cheap to say so. Dropping it silently would leave
 * the author with a widget that is simply absent from the dashboard and no
 * statement anywhere about why.
 */
export function adminWidgetShapeError(
  pluginName: string,
  widgetId: string,
  reason: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage:
      `Plugin "${pluginName}" contributes an admin widget "${widgetId}" that ` +
      `${reason}. A widget is drawn one of two ways and must describe one of ` +
      "them: ship a `component` and draw the card yourself, or declare an " +
      "`archetype` other than `custom` together with the `query` the host " +
      "draws it from. The cell is keyed on `id`, so that must carry real text " +
      "whichever way you choose. The type states this too, but it reaches a " +
      "TypeScript caller and nothing else -- a plugin authored in JavaScript, " +
      "or one whose manifest arrives as parsed JSON, reaches this check with " +
      "nothing enforced.",
    logContext: { plugin: pluginName, widget: widgetId, reason },
  });
}
