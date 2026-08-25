/**
 * Nextly Playground Configuration
 *
 * Internal contributor playground for the Nextly monorepo. NOT a
 * template for end-user projects — see templates/blog for that.
 *
 * Collections Posts, Categories, Tags, BlockPages (defined here) plus Media and
 * Users (core, registered automatically), three singles (Homepage,
 * LandingPage, SiteSettings) and the Seo field group. SiteSettings and Seo
 * are registered as a pair on purpose: SiteSettings embeds Seo through a
 * field-group field, so together they exercise the embed path a field group
 * registered on its own would never reach. Dev-harness plugins — page
 * builder, form builder, and a styling fixture — exercise the plugin
 * surfaces; the playground otherwise stays minimal so a broken change is
 * easy to spot.
 *
 * Storage falls through to the local-disk default when no cloud env
 * vars are set (handled by packages/nextly/src/storage/env-config.ts).
 *
 * admin.devAutoLogin makes the contributor land on /admin already
 * logged in. It is hard-blocked in production by the framework's
 * session handler — even if NODE_ENV ends up wrong on a deploy, the
 * runtime ignores this field. See packages/nextly/src/auth/handlers/session.ts.
 */

import { formBuilder } from "@nextlyhq/plugin-form-builder";
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineConfig } from "nextly/config";

import { Authors } from "./src/collections/authors";
import { BlockPages } from "./src/collections/block-pages";
import { Categories } from "./src/collections/categories";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { Seo } from "./src/field-groups/seo";
import { SITE_STYLE_DEFAULTS } from "./src/lib/site-style-defaults";
import { styleFixturePlugin } from "./src/plugins/style-fixture/plugin";
import { Announcement } from "./src/singles/announcement";
import { Homepage } from "./src/singles/homepage";
import { LandingPage } from "./src/singles/landing-page";
import { SiteSettings } from "./src/singles/site-settings";

// Set by e2e/playwright.config.ts for the suite's own server. Compared to
// "1" rather than checked for presence so an empty value reads as off.
const brandingColorsEnabled = process.env.NEXTLY_E2E_BRANDING === "1";

export default defineConfig({
  admin: {
    branding: {
      logoUrlLight: "/Nextly_Icon_dark.svg",
      logoUrlDark: "/Nextly_Icon_Light.svg",
      logoText: "Nextly Playground",
      // Branded colors only under the e2e suite, which sets this flag.
      //
      // The admin's identity is monochrome: --nx-primary is pure black in
      // light and pure white in dark. Configuring a brand color overwrites
      // that token and every token derived from it, so a contributor running
      // the playground would see an admin no end user gets by default.
      //
      // The colors cannot simply be dropped either: they are the only thing
      // that exercises the branding path, and it stayed silently broken for
      // as long as the harness configured logos alone. Gating on the flag
      // keeps the regression cover without repainting the daily dev surface.
      ...(brandingColorsEnabled
        ? { colors: { primary: "#6366f1", accent: "#f59e0b" } }
        : {}),
    },
    devAutoLogin: {
      email: "dev@nextly.local",
      password: "DevPassword123!",
    },
  },
  localization: {
    locales: [
      { code: "en", label: "English" },
      { code: "es", label: "Spanish", fallbackLocale: "en" },
      // `rtl: true` renders this language's translatable fields right-to-left.
      { code: "ar", label: "Arabic", rtl: true, fallbackLocale: "en" },
    ],
    defaultLocale: "en",
    // Untranslated fields fall back to another locale's value on read (default true).
    fallback: true,
  },
  // Authors is the localized collection, registered so the i18n admin surfaces
  // (language row, copy-from, publish-all, list translation status) are
  // exercised in development rather than existing only in code.
  collections: [Posts, Categories, Tags, BlockPages, Authors],
  // Announcement is the localized single WITH the draft/published lifecycle,
  // registered for the same reason Authors is: so the per-language publish
  // surfaces are exercised in development rather than existing only in code.
  singles: [Homepage, LandingPage, SiteSettings, Announcement],
  fieldGroups: [Seo],
  // Dev-harness plugins: page builder and form builder are what a contributor
  // works against.
  //
  // The styling fixture is registered only for the e2e run. It exists so
  // plugin-admin-styling.spec.ts can prove a plugin's admin UI is styled in the
  // real admin, and plugin-page-routing.spec.ts can resolve a deep link to a
  // plugin page. In a normal `pnpm dev:app` it is neither of those things: it
  // is a test double listed among real plugins, and it injects a showcase
  // section into the Posts collection list, both of which read as product.
  plugins: [
    // The style defaults tier: the same object the public block routes hand to
    // `loadSiteStyle`, so the validator, the canvas and the published page all
    // read one statement of this site's breakpoints.
    //
    // `pagePreviewPath` states where those pages are served, which is what lets
    // an editor mint a shareable preview link for one. It has no default and
    // cannot have one: the plugin can neither install this app's preview route
    // nor discover that `(frontend)/[...slug]` is mounted at the site root, so
    // passing it is the only signal available that a minted link will land.
    // Without it every page-builder share is refused at the click.
    pageBuilder({
      siteStyle: SITE_STYLE_DEFAULTS,
      pagePreviewPath: "/{slug}",
    }),
    // `redirectRelationships` states where each collection's documents are
    // served, for the same reason `pagePreviewPath` above does and in the same
    // syntax: the plugin cannot discover that this app mounts
    // `(frontend)/[...slug]` at the site root. Without it a form can still
    // show a message or redirect to a typed URL, but "redirect to a page" is
    // not offered, because choosing it could only produce a form with nowhere
    // to send anyone.
    formBuilder({ redirectRelationships: { pages: "/{slug}" } }).plugin,
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1"
      ? [styleFixturePlugin]
      : []),
  ],
  typescript: {
    outputFile: "./src/types/nextly-types.ts",
  },
  db: {
    schemasDir: "./src/db/schemas/collections",
    migrationsDir: "./src/db/migrations",
  },
});
