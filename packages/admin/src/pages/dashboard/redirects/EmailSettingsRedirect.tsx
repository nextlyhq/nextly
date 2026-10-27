"use client";

/**
 * Redirects for the email pages that lived under Settings before the Email
 * hub, so a bookmark or a link to one lands in the matching place in the hub.
 *
 * The history entry is REPLACED rather than pushed: Back from the hub then
 * leaves the page the old link came from, instead of returning to the old URL
 * only to be sent forward again. The query string and fragment travel with
 * it, so `?duplicate=<id>` still opens a copy.
 */

import { useEffect, useState, type JSX } from "react";

import { ROUTES, buildRoute } from "@admin/constants/routes";
import { replaceTo } from "@admin/lib/navigation";

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

/** Where an old Settings email URL now lives, or null for any other path. */
export function emailHubPathFor(pathname: string): string | null {
  for (const [from, to] of MOVED) {
    const match = from.exec(pathname);
    if (match) return to(match[1] ?? "");
  }
  return null;
}

export default function EmailSettingsRedirect(): JSX.Element {
  // Decided once, from the URL the page was opened at. Reading the location
  // inside the effect would read the hub's URL on an effect's second run (as
  // development runs every effect twice) and send the reader on to Messages.
  const [target] = useState(() => {
    const { pathname, search, hash } = window.location;
    return `${emailHubPathFor(pathname) ?? ROUTES.EMAIL}${search}${hash}`;
  });
  useEffect(() => {
    replaceTo(target);
  }, [target]);
  return <div className="h-32" aria-hidden="true" />;
}
