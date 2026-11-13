"use client";

/**
 * The startup request's early start: a script in the prebuilt admin page that
 * sends the admin's startup request as the browser reads the page, before the
 * admin's main code has loaded, and leaves it for the admin to take.
 *
 * The script is written from the admin's own code, so it cannot drift from
 * it: what every screen needs is what `adminStartupPaths` returns, computed
 * when the page is built; the reads of the page it is on are found by
 * `startupPathsForPage`'s source text, from what the admin layout wrote into
 * the page; and its request is `sendStartupRequest`'s source text. The admin
 * then takes the request it sent and the paths it named, rather than sending
 * its own (`beginStartupRequest`).
 *
 * Nothing in it is per visitor: the page stays the same for everyone. Every
 * screen of the admin is served this one page, so the script runs on each,
 * and sends what every screen needs first, whichever screen it is, with the
 * reads a plugin page declares where it is on one. It runs
 * under the admin's own API address, which is where the admin's code sends
 * it too (`API_PATH_PREFIX`).
 *
 * @module context/providers/AdminStartupScript
 */
import {
  ADMIN_STARTUP_SCREENS_ELEMENT_ID,
  MAX_STARTUP_PATHS,
} from "nextly/config";
import type { JSX } from "react";

import {
  InlineScript,
  scriptJson,
} from "@admin/components/shared/inline-script";
import { API_PATH_PREFIX } from "@admin/lib/api/fetcher";
import {
  EARLY_STARTUP_SLOT,
  sendStartupRequest,
  startEarlyStartupRequest,
  type EarlyStartupPlan,
} from "@admin/lib/api/startup-request";

import { adminStartupPaths, startupPathsForPage } from "./admin-startup";

/** The script's source: the early start called with the request and its paths. */
function adminStartupScriptSource(): string {
  const plan: EarlyStartupPlan = {
    apiPath: API_PATH_PREFIX,
    common: adminStartupPaths(),
    screensElementId: ADMIN_STARTUP_SCREENS_ELEMENT_ID,
    max: MAX_STARTUP_PATHS,
    slot: EARLY_STARTUP_SLOT,
  };
  return `(${startEarlyStartupRequest.toString()})(${sendStartupRequest.toString()},${startupPathsForPage.toString()},${scriptJson(plan)})`;
}

/**
 * Renders the early start. Render it once, as early in the admin's page as
 * the admin's markup allows; `RootLayout` does. `nonce` is the one a
 * `script-src` Content Security Policy needs where the page is rendered with
 * one; a policy that refuses the script costs only the early start, as the
 * admin then sends the request itself.
 */
export function AdminStartupScript({ nonce }: { nonce?: string }): JSX.Element {
  return <InlineScript source={adminStartupScriptSource()} nonce={nonce} />;
}
