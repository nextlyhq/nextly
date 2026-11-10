/**
 * Where the site's code is kept: the plugin-owned `page-builder-site-code`
 * Single, one document per site.
 *
 * Its own Single, never the site style's: anyone who may change the site's
 * design may write the style Single, and code runs on every page, so it is
 * kept behind the site settings permission alone, written by the site code
 * route.
 *
 * ## Only one writer
 *
 * The site code route is the only writer. Every write it makes carries a
 * context marker, and a hook on this Single refuses any write without it, on
 * both pre-write phases. Hooks run for system writes too, so a Direct API
 * write with `overrideAccess: true`, a super admin's REST call, an admin form
 * save and a version restored through the generic restore are all refused
 * alike: none of them can store code the sanitiser has not judged, or skip
 * the route's refusal of API keys and its audit row.
 *
 * The marker cannot arrive from a request body: hook context is set by the
 * server-side caller of the service, never read from the request.
 *
 * Both what the person wrote (`headSource`, `bodySource`, shown again for
 * editing, never rendered) and the entries it was judged into (`head`,
 * `body`, the only thing rendered) are stored, written together by the
 * route, so the two always describe the same code.
 *
 * @module site-code/storage
 * @experimental
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  defineSingle,
  json,
  text,
  textarea,
  type SingleConfig,
} from "nextly/config";

import {
  siteCodeEntryProblem,
  type SiteCodeEntry,
  type SiteCodeSlot,
} from "./rules";

/** The Single the site's code is kept in. */
export const SITE_CODE_SLUG = "page-builder-site-code";

/**
 * The hook-context key a sanctioned write sets to `true`. Namespaced by
 * plugin so no other caller's context key can collide with it by accident.
 */
const SITE_CODE_WRITE = "pageBuilder.siteCodeWrite";

/** The context every sanctioned write to the site code Single is made with. */
export const SITE_CODE_WRITE_CONTEXT: Readonly<Record<string, unknown>> = {
  [SITE_CODE_WRITE]: true,
};

/** What an unsanctioned write is told: where site code is changed. */
export const SITE_CODE_WRITE_REFUSAL =
  "Site code is changed in Settings, under Site, where it is checked before it is saved.";

/**
 * Refuse a write to the site code Single that does not carry the marker, on
 * both pre-write phases, so a handler registered later on either phase cannot
 * slip a write past by running before this one.
 */
function refuseUnmarkedWrite(hook: {
  context?: Record<string, unknown>;
}): void {
  if (hook.context?.[SITE_CODE_WRITE] === true) return;
  // A CONFLICT rather than `forbidden`: the refusal is about where code is
  // written, not who is asking, and says where to go instead.
  throw NextlyError.conflict({
    reason: "state",
    message: SITE_CODE_WRITE_REFUSAL,
    logContext: { reason: "page-builder-site-code-unmarked-write" },
  });
}

/**
 * The site code Single.
 *
 * NO code-defined `access` block: reads and updates fall to the permissions
 * seeded with the Single, so an anonymous REST read is refused, and every
 * update is refused by the hook whoever asks. The published render reads
 * through the Direct API. `versions: true`, so each save can be told apart
 * and put back through the route.
 */
export function siteCodeSingle(): SingleConfig {
  return defineSingle({
    slug: SITE_CODE_SLUG,
    label: { singular: "Site Code" },
    versions: true,
    // Hidden from navigation: the code is edited in Settings, where it is
    // checked first, and a form here would offer a save the hook refuses.
    admin: {
      hidden: true,
      description:
        "Code added to every page of the site. Changed in Settings, under Site.",
    },
    hooks: {
      beforeValidate: [refuseUnmarkedWrite],
      beforeChange: [refuseUnmarkedWrite],
    },
    fields: [
      // What the person wrote for the head, as it was judged: shown again for
      // editing, never rendered.
      textarea({
        name: "headSource",
        label: "Head",
        admin: { readOnly: true },
      }),
      // What the person wrote for the end of the body.
      textarea({
        name: "bodySource",
        label: "End of body",
        admin: { readOnly: true },
      }),
      // The entries the head's code was judged into: the only thing rendered.
      json({
        name: "head",
        label: "Head entries",
        admin: { readOnly: true, hidden: true },
      }),
      // The entries for the end of the body.
      json({
        name: "body",
        label: "End of body entries",
        admin: { readOnly: true, hidden: true },
      }),
      // Who saved it last: `user:<id>`. API keys may not save site code.
      text({
        name: "changedBy",
        label: "Changed by",
        admin: { readOnly: true, hidden: true },
      }),
    ],
  });
}

/**
 * The stored entries for `slot` that the rules still accept, from a read of
 * the Single. Any other, a row edited in the database say, is left out and
 * the server log says so: rendered pages and the Settings summary both read
 * stored code through this, so they never disagree about what is there.
 */
export function storedSiteCodeEntries(
  doc: unknown,
  slot: SiteCodeSlot
): SiteCodeEntry[] {
  const stored = (doc as Record<string, unknown> | null)?.[slot];
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry: unknown): entry is SiteCodeEntry => {
    const problem = siteCodeEntryProblem(entry, slot);
    if (problem === undefined) return true;
    console.warn(
      `[page-builder] A stored site code entry was left out of the ${slot}: ${problem}.`
    );
    return false;
  });
}
