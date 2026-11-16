/**
 * Where the site's default Layout is recorded: the plugin-owned
 * `page-builder-settings` Single.
 *
 * One document per site, so "which Layout is the default" has exactly one
 * answer by construction. A per-row `isDefault` flag would need every writer to
 * clear it from the others in the same transaction, and a missed clear leaves
 * two rows claiming it; a single reference cannot name two Layouts.
 *
 * ## Only one writer
 *
 * The make-default route and the default repair are the only writers. Every
 * write they make carries a context marker, and a hook on this Single refuses
 * any write without it. Hooks run for system writes too, so a Direct API write
 * with `overrideAccess: true`, an admin save and a super admin's REST call are
 * all refused alike. That is what keeps the route's checks (the Layout is
 * published, the caller may publish Layouts) from being stepped around by
 * writing the reference directly.
 *
 * The marker cannot arrive from a request body: hook context is set by the
 * server-side caller of the service, never read from the request.
 *
 * @module default-layout/settings-single
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  defineSingle,
  relationship,
  text,
  type SingleConfig,
} from "nextly/config";

import { LAYOUTS_SLUG } from "../collections/layouts";

/** The Single the default Layout is recorded in. */
export const PAGE_BUILDER_SETTINGS_SLUG = "page-builder-settings";

/**
 * The hook-context key a sanctioned write sets to `true`. Namespaced by plugin
 * so no other caller's context key can collide with it by accident.
 */
const DEFAULT_LAYOUT_WRITE = "pageBuilder.defaultLayoutWrite";

/** The context every sanctioned write to the settings Single is made with. */
export const DEFAULT_LAYOUT_WRITE_CONTEXT: Readonly<Record<string, unknown>> = {
  [DEFAULT_LAYOUT_WRITE]: true,
};

/** What an unsanctioned write is told. Names the one place the default is set. */
export const SETTINGS_WRITE_REFUSAL =
  "The default Layout is set from the Layouts list, with Make default.";

/**
 * Refuse a write to the settings Single that does not carry the marker.
 *
 * Registered on both pre-write phases a Single runs, so a write is refused
 * before validation and again before it is stored: a handler registered later
 * on either phase cannot slip a write past by running before this one.
 */
function refuseUnmarkedWrite(hook: {
  context?: Record<string, unknown>;
}): void {
  if (hook.context?.[DEFAULT_LAYOUT_WRITE] === true) return;
  // A CONFLICT rather than `forbidden`: the refusal is about where the
  // default is set, not about who is asking, and `forbidden` carries only its
  // generic sentence, which would leave the caller nothing to act on.
  throw NextlyError.conflict({
    reason: "state",
    message: SETTINGS_WRITE_REFUSAL,
    logContext: { reason: "page-builder-settings-unmarked-write" },
  });
}

/**
 * The settings Single.
 *
 * NO code-defined `access` block, for the reason `site-style-storage` gives:
 * reads and updates fall to the `read-page-builder-settings` /
 * `update-page-builder-settings` permissions seeded with the Single, so an
 * anonymous REST read is refused. The published render reads through the
 * Direct API, which does not consult them.
 */
export function pageBuilderSettingsSingle(): SingleConfig {
  return defineSingle({
    slug: PAGE_BUILDER_SETTINGS_SLUG,
    label: { singular: "Page Builder Settings" },
    // Hidden from navigation: nothing here is edited in a form. The default is
    // chosen from the Layouts list, and a form offering these fields would
    // offer a save that the guard below refuses.
    admin: {
      hidden: true,
      description:
        "Which Layout pages are drawn inside when they name none. Set from the Layouts list.",
    },
    hooks: {
      beforeValidate: [refuseUnmarkedWrite],
      beforeChange: [refuseUnmarkedWrite],
    },
    fields: [
      // Nullable: a site whose default is unset draws its pages with no
      // regions until the repair seeds one.
      relationship({
        name: "defaultLayout",
        label: "Default Layout",
        relationTo: LAYOUTS_SLUG,
        admin: { readOnly: true },
      }),
      // The seed's identity. The repair finds the Layout it seeded by this id
      // and never by title or slug, so an authored Layout that happens to be
      // called "Site layout" is never adopted, renamed or republished.
      relationship({
        name: "seededLayout",
        label: "Seeded Layout",
        relationTo: LAYOUTS_SLUG,
        admin: { readOnly: true, hidden: true },
      }),
      // Who last chose the default, so a surprising change can be traced:
      // `user:<id>` for a person, `api-key:<id>` for an API key (a bare id is
      // a person's, from before the kind was written). Empty when the system
      // chose it: the repair clears it whenever it changes the default, so no
      // one is credited with a choice they did not make.
      text({
        name: "defaultLayoutChangedBy",
        label: "Default changed by",
        admin: { readOnly: true, hidden: true },
      }),
    ],
  });
}
