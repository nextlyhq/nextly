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
