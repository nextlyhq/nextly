import { respondAction } from "../../api/response-shapes";
import type { PluginContext } from "../../plugins/plugin-context";
import { clearAccessTokenCookie } from "../cookies/access-token-cookie";
import {
  readRefreshTokenCookie,
  clearRefreshTokenCookie,
} from "../cookies/refresh-token-cookie";
import {
  clearCsrfCookie,
  readCsrfCookie,
  readCsrfFromRequest,
} from "../csrf/csrf-cookie";
import { validateCsrf } from "../csrf/validate";
import type { AuthHookRegistry } from "../pipeline/hooks";
import { hashRefreshToken } from "../session/refresh";

import {
  jsonResponse,
  parseJsonBody,
  buildCookieHeaders,
} from "./handler-utils";

export interface LogoutHandlerDeps {
  allowedOrigins: string[];
  deleteRefreshTokenByHash: (tokenHash: string) => Promise<void>;
  /** Auth-flow hooks (D71). Optional; the DI path always supplies it. */
  authHooks?: AuthHookRegistry;
  /** Plugin context for {@link authHooks}. */
  pluginCtx?: PluginContext;
}

export async function handleLogout(
  request: Request,
  deps: LogoutHandlerDeps
): Promise<Response> {
  const body = await parseJsonBody(request);
  const csrfCookie = readCsrfCookie(request);
  const csrfToken = readCsrfFromRequest(body, request);
  const csrfResult = validateCsrf(
    request,
    csrfCookie,
    csrfToken,
    deps.allowedOrigins
  );

  if (!csrfResult.valid) {
    return jsonResponse(403, {
      error: { code: "CSRF_FAILED", message: csrfResult.error },
    });
  }

  // beforeLogout hook (D71). The logout endpoint doesn't resolve the user, so
  // pass null; plugins that need the user can read it from the request/session.
  if (deps.authHooks && deps.pluginCtx) {
    await deps.authHooks.runBeforeLogout(null, deps.pluginCtx);
  }

  const refreshToken = readRefreshTokenCookie(request);
  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await deps.deleteRefreshTokenByHash(tokenHash);
  }

  if (deps.authHooks && deps.pluginCtx) {
    await deps.authHooks.runAfterLogout(deps.pluginCtx);
  }

  const clearCookies = [
    clearAccessTokenCookie(),
    clearRefreshTokenCookie(),
    clearCsrfCookie(),
  ];

  // Silent success body is just `{ message }` per spec §7.6.
  // Cleared cookies still travel via the headers param.
  return respondAction(
    "Logged out.",
    {},
    { status: 200, headers: buildCookieHeaders(clearCookies) }
  );
}
