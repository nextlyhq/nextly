import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for a `contributes.admin.clientConfig` that cannot be
 * delivered to the browser.
 *
 * Mirrors {@link ./permission-error}: the public message stays generic while
 * the detail an author needs — which plugin, and which keys did not survive —
 * goes to `logContext`, where a boot failure is read.
 *
 * A boot failure rather than a dropped field, because the alternative is a
 * component reading a config whose `Date`s arrived as strings and whose
 * functions arrived as nothing. That shape still looks plausible, so the
 * failure would surface later and somewhere else.
 */
export function clientConfigError(
  pluginName: string,
  offendingKeys: string[]
): NextlyError {
  return new NextlyError({
    // No `statusCode` here: the code is registered in `NEXTLY_ERROR_STATUS`, so
    // it resolves from that one table rather than being restated per factory.
    code: "NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage:
      `Plugin "${pluginName}" declares an admin.clientConfig that is not JSON` +
      (offendingKeys.length > 0 ? ` (keys: ${offendingKeys.join(", ")})` : "") +
      ". It is serialized into /api/admin-meta, so it may hold only strings, " +
      "numbers, booleans, null, arrays and plain objects — no functions, " +
      "class instances, Dates or Maps.",
    logContext: { plugin: pluginName, keys: offendingKeys },
  });
}
