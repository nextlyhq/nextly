"use client";

/**
 * Redirects for the addresses email has had before it settled under Settings,
 * so a bookmark or a link to one lands on the same page at its address now.
 *
 * Two earlier homes are covered. The hub's own rail entry served it at
 * `/admin/email/...`, and every address under it maps to the same path under
 * `/admin/settings/email/...`. Before the hub, templates and providers were
 * separate Settings pages, and each maps to its place in the hub.
 *
 * The history entry is REPLACED rather than pushed: Back from the hub then
 * leaves the page the old link came from, instead of returning to the old URL
 * only to be sent forward again. The query string and fragment travel with
 * it, so `?duplicate=<id>` still opens a copy.
 */

import { useEffect, useState, type JSX } from "react";

import { ROUTES, buildRoute } from "@admin/constants/routes";
import { replaceTo } from "@admin/lib/navigation";

/**
 * The hub's earlier address, matched with whatever follows it. The rest of
 * the path is carried over unchanged, so a tab, an editor and the id it opens
 * all keep their place, and a page added under the hub later is covered
 * without a row of its own.
 */
const OLD_HUB = /^\/admin\/email(\/.*)?$/;

const MOVED: ReadonlyArray<[from: RegExp, to: (id: string) => string]> = [
  [/^\/admin\/settings\/email-templates\/?$/, () => ROUTES.EMAIL],
  [
    /^\/admin\/settings\/email-templates\/create\/?$/,
    () => ROUTES.EMAIL_MESSAGES_CREATE,
  ],
  [
    /^\/admin\/settings\/email-templates\/edit\/([^/]+)\/?$/,
    id => buildRoute(ROUTES.EMAIL_MESSAGES_EDIT, { id }),
  ],
  [/^\/admin\/settings\/email-providers\/?$/, () => ROUTES.EMAIL_SENDING],
  [
    /^\/admin\/settings\/email-providers\/create\/?$/,
    () => ROUTES.EMAIL_SENDING_CREATE,
  ],
  [
    /^\/admin\/settings\/email-providers\/edit\/([^/]+)\/?$/,
    id => buildRoute(ROUTES.EMAIL_SENDING_EDIT, { id }),
  ],
];

/** Where an old email URL now lives, or null for any other path. */
export function emailHubPathFor(pathname: string): string | null {
  const hub = OLD_HUB.exec(pathname);
  if (hub) {
    // A trailing slash is dropped, as the router matches routes without one.
    const rest = (hub[1] ?? "").replace(/\/+$/, "");
    return `${ROUTES.EMAIL}${rest}`;
  }
  for (const [from, to] of MOVED) {
    const match = from.exec(pathname);
    if (match) return to(match[1] ?? "");
  }
  return null;
}

/**
 * The full address an old email URL redirects to: its new path, with the
 * query string and fragment it was opened with. A path this module does not
 * recognise lands on the hub's first page rather than nowhere.
 */
export function emailRedirectTarget(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  const path = emailHubPathFor(location.pathname) ?? ROUTES.EMAIL;
  return `${path}${location.search}${location.hash}`;
}

export default function EmailSettingsRedirect(): JSX.Element {
  // Decided once, from the URL the page was opened at. Reading the location
  // inside the effect would read the hub's URL on an effect's second run (as
  // development runs every effect twice) and send the reader on to Messages.
  const [target] = useState(() => emailRedirectTarget(window.location));
  useEffect(() => {
    replaceTo(target);
  }, [target]);
  return <div className="h-32" aria-hidden="true" />;
}
