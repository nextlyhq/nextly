/**
 * Where a site's style edits persist: the plugin-owned Site Style single.
 *
 * One global document — versioned, access-controlled, written through the
 * ordinary single write path — holding the stored tier of the site style that
 * `site-style.ts` layers over the config-supplied defaults. The arrangement is
 * WordPress's theme.json + global-styles pairing: the code states a baseline,
 * the stored document carries what admins changed, and one merge point
 * resolves them.
 *
 * The section checkers live in `site-style-record`, which reads a stored
 * document with the same rules these validators write by; this module is the
 * server half — the single's schema, its fail-closed write validation, and
 * the per-request loader a published route calls.
 *
 * Node-safe: no React, no admin imports. The single's validators run
 * server-side on every write.
 *
 * @module @nextlyhq/plugin-page-builder/site-style-storage
 */
import { defineSingle, json } from "nextly/config";

import { resolveSiteStyle, type SiteStyleData } from "./site-style";
import {
  checkStoredBreakpoints,
  checkStoredClasses,
  checkStoredFonts,
  checkStoredTokens,
  readSiteStyleRecord,
  type SectionCheck,
  type SectionPolicy,
} from "./site-style-record";

/** The single the stored tier lives in. One document per site, by design. */
export const SITE_STYLE_SLUG = "site-style";

/**
 * A field `validate` that fails closed over one section checker.
 *
 * Any issue refuses the write — including the entries the shape check had to
 * exclude, which each carry an issue of their own — so nothing that would be
 * silently narrowed on read can be stored in the first place. An absent value
 * is an empty section, exactly as for every other optional field.
 */
const refusing =
  (check: (raw: unknown) => SectionCheck<unknown>) =>
  (value: unknown): string | true => {
    if (value === null || value === undefined) return true;
    const { issues } = check(value);
    return issues.length === 0 ? true : issues.join(" ");
  };

/**
 * The Site Style single: the one global, versioned, access-controlled
 * document a site's stored style edits live in.
 *
 * - `versions: true`, because a site's whole look changes in one write and a
 *   restorable history is the difference between an experiment and an
 *   accident.
 * - NO code-defined access block, so read and update alike fall through to the
 *   `read-site-style` / `update-site-style` permissions seeded with the single.
 *   A published render is unaffected: it reads through the Direct API, whose
 *   `overrideAccess` default returns before any rule is consulted.
 * - Plain `json` fields rather than structured ones, because the shapes are
 *   the ENGINE's contracts and the style studios that will edit them write
 *   whole sections at a time; a field-per-property schema here would be a
 *   third statement of shapes two packages already agree on.
 */
export function siteStyleSingle(policy: SectionPolicy = {}) {
  return defineSingle({
    slug: SITE_STYLE_SLUG,
    label: { singular: "Site Style" },
    versions: true,
    // No `access` block, deliberately: read and update both fall through to
    // the `read-site-style` / `update-site-style` permissions seeded with the
    // single and granted to super_admin, so a role reaches this document only
    // by being given one.
    //
    // A code-defined read rule cannot serve the anonymous render it would be
    // written for. `checkAccess` refuses an absent user before consulting any
    // rule, singles are not public endpoints, and the published page does not
    // use the route at all — `loadSiteStyle` reads through the Direct API,
    // whose `overrideAccess` default returns from `checkSingleAccess` before
    // the rule is reached. What such a rule DOES reach is every authenticated
    // principal, returning ahead of the permission lookup, and the `read`
    // action spans more than the published document: the version list, a
    // version, a version diff and the autosave recovery point all resolve to
    // `read` on this slug. None of those is emitted into a public page.
    admin: {
      icon: "Palette",
      description:
        "Site-wide design tokens, fonts, classes and breakpoints for pages built from blocks.",
    },
    fields: [
      json({
        name: "tokens",
        label: "Design tokens",
        validate: refusing(checkStoredTokens),
        admin: {
          description:
            'A token set: { tokens: [{ name, kind, values: { light, dark? } }], prefix?, darkMode? }. Values are per mode; "light" is what a reader with no mode set resolves.',
        },
      }),
      json({
        name: "fonts",
        label: "Font faces",
        validate: refusing(checkStoredFonts),
        admin: {
          description:
            "Self-hosted @font-face definitions: [{ family, src: [{ url, format? }], weight?, style? }]. Files must live on this site.",
        },
      }),
      json({
        name: "classes",
        label: "Named classes",
        // The one section whose gate is given the site's host policy: a class
        // is emitted verbatim into every public page's sheet, so a `url()`
        // stored here is fetched by every visitor. Tokens reach the page as a
        // `var()` substitution, which is why their own gate is the last place
        // a URL can be stopped and this one is the last place a class's can.
        validate: refusing(raw => checkStoredClasses(raw, policy)),
        admin: {
          description:
            "Reusable style presets: [{ id, slug, orderIndex, styles }]. Documents reference a class by id; a later orderIndex overrides an earlier one.",
        },
      }),
      json({
        name: "breakpoints",
        label: "Breakpoints",
        validate: refusing(checkStoredBreakpoints),
        admin: {
          description:
            "The site's breakpoints: { viewport: [{ id, label, maxWidth? }], container: [...] }. Ids must be unique across both axes; the base breakpoint has no maxWidth.",
        },
      }),
    ],
  });
}

/**
 * The one read a route needs: the stored single. Structural rather than the
 * generated reader type, because the generated single-slug union is the HOST
 * app's — it may not exist yet when this plugin is being wired, and this
 * document's slug is the plugin's to know.
 */
export interface SiteStyleReader {
  findSingle(args: { slug: string }): Promise<unknown>;
}

/**
 * The site style a published route serves: config defaults with the stored
 * document layered on top, ready to hand to a route helper's `siteStyles`.
 *
 * Called per request (route helpers accept it as an async provider), so an
 * admin's saved edit reaches the next page view rather than the next deploy.
 * A site that has never stored anything gets its defaults back: a single with
 * no row reads as a default document whose sections are all absent.
 *
 * Errors propagate. A read that cannot reach the database will fail the page
 * render anyway; catching here would serve an unstyled page that looks like a
 * content decision instead of an outage.
 */
export async function loadSiteStyle(args: {
  nextly: SiteStyleReader;
  defaults?: SiteStyleData;
}): Promise<SiteStyleData> {
  const doc = await args.nextly.findSingle({ slug: SITE_STYLE_SLUG });
  return resolveSiteStyle(args.defaults, readSiteStyleRecord(doc));
}
