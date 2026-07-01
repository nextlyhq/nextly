import { NextlyError } from "../../errors/nextly-error";

/**
 * Fail-fast boot error when two contributed routes resolve to the same
 * `(method, full path)`. Mirrors {@link ../schema-error}: a generic public
 * message; the specific detail lives in `logContext` for operators.
 */
export function routeCollisionError(
  method: string,
  fullPath: string,
  owners: string[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_ROUTE_COLLISION",
    statusCode: 409,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Duplicate route ${method} ${fullPath} contributed by ${owners.join(" and ")}`,
    logContext: { reason: "route-collision", method, fullPath, owners },
  });
}

/**
 * Fail-fast boot error when a contributed route's `path` does not start with
 * "/". Paths are mounted under `/api/plugins/<name>` and must be absolute
 * within the plugin namespace.
 */
export function routeInvalidPathError(
  pluginName: string,
  path: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_ROUTE_INVALID_PATH",
    statusCode: 400,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Plugin "${pluginName}" declares a route path "${path}" that does not start with "/"`,
    logContext: { reason: "route-invalid-path", pluginName, path },
  });
}
