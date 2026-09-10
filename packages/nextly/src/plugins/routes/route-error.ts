import {
  NEXTLY_ERROR_STATUS,
  type NextlyErrorCode,
} from "../../errors/error-codes";
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
    statusCode: NEXTLY_ERROR_STATUS.NEXTLY_ROUTE_COLLISION,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Duplicate route ${method} ${fullPath} contributed by ${owners.join(" and ")}`,
    logContext: { reason: "route-collision", method, fullPath, owners },
  });
}

/**
 * Fail-fast boot error when a contributed route's `path` does not start with
 * "/". Paths are namespaced under `/plugins/<name>` beneath wherever the app
 * mounts the handler, and must be absolute within the plugin namespace.
 */
export function routeInvalidPathError(
  pluginName: string,
  path: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_ROUTE_INVALID_PATH",
    statusCode: NEXTLY_ERROR_STATUS.NEXTLY_ROUTE_INVALID_PATH,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Plugin "${pluginName}" declares a route path "${path}" that does not start with "/"`,
    logContext: { reason: "route-invalid-path", pluginName, path },
  });
}

/**
 * Every refusal a route fold raises, in one list.
 *
 * `isRouteError` reads it, and so does each constructor's status. Spelled out
 * per site, a new refusal is recognised by whichever of them its author
 * remembered: a code missing from the classifier is rethrown by
 * `mountableRoutes`, which turns "this plugin's routes do not mount" into a
 * failed `/api/admin-meta` for every reader.
 */
const ROUTE_ERROR_CODES = [
  "NEXTLY_ROUTE_COLLISION",
  "NEXTLY_ROUTE_INVALID_PATH",
  "NEXTLY_ROUTE_UNREACHABLE_ROOT",
  "NEXTLY_ROUTE_INVALID_MOUNT",
] as const satisfies readonly NextlyErrorCode[];

/**
 * Whether an error is one a route fold raises.
 *
 * Narrow on purpose. A caller that treats "these routes do not mount" as a
 * verdict must not reach that verdict from an unrelated failure — a
 * `TypeError` in this module would otherwise be reported to a reader as a
 * plugin declaring bad routes, which sends them to fix the wrong thing.
 */
export function isRouteError(error: unknown): boolean {
  return (
    error instanceof NextlyError &&
    (ROUTE_ERROR_CODES as readonly string[]).includes(error.code)
  );
}

/**
 * A root route declared where the request never reaches the root pass.
 *
 * Distinct from a collision, which is two plugins wanting one address. This is
 * one plugin wanting an address nothing will ever ask it about, and the reason
 * differs per prefix, so it is carried rather than restated.
 */
export function routeUnreachableRootError(
  pluginName: string,
  path: string,
  reason: string
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_ROUTE_UNREACHABLE_ROOT",
    statusCode: NEXTLY_ERROR_STATUS.NEXTLY_ROUTE_UNREACHABLE_ROOT,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Plugin "${pluginName}" declares a root-mounted route at "${path}", which cannot answer: ${reason}`,
    logContext: { reason: "route-unreachable-root", pluginName, path },
  });
}

/**
 * A `mount` outside the union the type declares.
 *
 * Only reachable from an untyped caller, which is exactly why it is checked:
 * `pluginRouteFullPath` reads anything that is not `"root"` as namespaced,
 * while the registry stores the value verbatim and the matcher only ever asks
 * for `"plugin"` or `"root"`. A typo therefore mounts under one name and is
 * looked up under another, so the route registers, advertises itself, and can
 * never match.
 */
export function routeInvalidMountError(
  pluginName: string,
  path: string,
  mount: unknown
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_ROUTE_INVALID_MOUNT",
    statusCode: NEXTLY_ERROR_STATUS.NEXTLY_ROUTE_INVALID_MOUNT,
    publicMessage: "Route configuration is invalid.",
    logMessage: `Plugin "${pluginName}" declares route "${path}" with an unknown mount ${JSON.stringify(mount)}; expected "plugin" or "root"`,
    logContext: { reason: "route-invalid-mount", pluginName, path, mount },
  });
}
