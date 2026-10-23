import { pluginAdminSlug, type PluginRoute } from "@nextlyhq/plugin-sdk";

import type { FlowDeps } from "../flows/deps";
import { PLUGIN_NAME } from "../schema/definition";

import {
  cancelAddressEndpoint,
  changeAddressEndpoint,
  changePasswordEndpoint,
  confirmAddressEndpoint,
  csrf,
  deleteAccountEndpoint,
  meEndpoint,
  notMeEndpoint,
  resendEndpoint,
  resetEndpoint,
  resetRequestEndpoint,
  signInEndpoint,
  signOutEndpoint,
  signOutEverywhereEndpoint,
  signUpEndpoint,
  verifyEndpoint,
  type Endpoint,
} from "./handlers";
import { ACCOUNT_KIND } from "./principal";

/** The plugin's kind of signed-in person, as a route names it: `<plugin>:account`. */
export const ACCOUNT_PRINCIPAL: string = `${pluginAdminSlug(PLUGIN_NAME)}:${ACCOUNT_KIND}`;

/**
 * The plugin's REST endpoints. Those a visitor uses before signing in are
 * public, and the plugin's own guard refuses any write from another site or
 * without its CSRF token. Those for a signed-in holder ask core for the
 * account kind, so core refuses a request with no account before the
 * handler runs; the handler then reads the same session itself.
 */
export function accountsRoutes(deps: () => FlowDeps): PluginRoute[] {
  const route = (
    method: PluginRoute["method"],
    path: string,
    endpoint: Endpoint,
    signedIn = false
  ): PluginRoute => ({
    method,
    path,
    handler: request => endpoint(deps(), request),
    ...(signedIn
      ? { principal: { kind: ACCOUNT_PRINCIPAL } }
      : { public: true }),
  });

  return [
    route("GET", "/csrf", csrf),
    route("POST", "/sign-up", signUpEndpoint),
    route("POST", "/verify", verifyEndpoint),
    route("POST", "/verify/resend", resendEndpoint),
    route("POST", "/verify/not-me", notMeEndpoint),
    route("POST", "/sign-in", signInEndpoint),
    route("POST", "/sign-out", signOutEndpoint),
    route("POST", "/reset/request", resetRequestEndpoint),
    route("POST", "/reset", resetEndpoint),
    route("POST", "/address/cancel", cancelAddressEndpoint),
    route("GET", "/me", meEndpoint),
    route("POST", "/sign-out/everywhere", signOutEverywhereEndpoint, true),
    route("POST", "/password", changePasswordEndpoint, true),
    route("POST", "/address", changeAddressEndpoint, true),
    route("POST", "/address/confirm", confirmAddressEndpoint, true),
    route("POST", "/delete", deleteAccountEndpoint, true),
  ];
}
