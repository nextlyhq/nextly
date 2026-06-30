import { NextlyError } from "../errors/nextly-error";

/**
 * Fail-fast boot error for plugin resolution. The specific failure mode is
 * carried in `logContext.reason` (e.g. "missing-dependency", "dependency-cycle",
 * "core-incompatible", "version-incompatible").
 */
export function resolutionError(
  reason: string,
  logMessage: string,
  logContext: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code: "PLUGIN_RESOLUTION_ERROR",
    statusCode: 500,
    publicMessage: "Plugin configuration is invalid.",
    logMessage,
    logContext: { reason, ...logContext },
  });
}
