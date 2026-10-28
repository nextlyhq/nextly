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
import { DevReloadProbe } from "./src/collections/dev-reload-probe";
import { HistoryNotes } from "./src/collections/history-notes";
import { LinkedEntries } from "./src/collections/linked-entries";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { TranslatedPages } from "./src/collections/translated-pages";
import { TranslatorNotes } from "./src/collections/translator-notes";
import { LinkCard, LinkQuote } from "./src/field-groups/related-link-groups";
import { Seo } from "./src/field-groups/seo";
import { SITE_STYLE_DEFAULTS } from "./src/lib/site-style-defaults";
import { blockFixturePlugin } from "./src/plugins/block-fixture/plugin";
import { missingWidgetFixturePlugin } from "./src/plugins/missing-widget-fixture/plugin";
import { slowWidgetFixturePlugin } from "./src/plugins/slow-widget-fixture/plugin";
import { styleFixturePlugin } from "./src/plugins/style-fixture/plugin";
import { widgetKitFixturePlugin } from "./src/plugins/widget-kit-fixture/plugin";
import { Announcement } from "./src/singles/announcement";
import { Homepage } from "./src/singles/homepage";
import { LandingPage } from "./src/singles/landing-page";
import { RelatedLinks } from "./src/singles/related-links";
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
  collections: [
    Posts,
    Categories,
    Tags,
    BlockPages,
    Authors,
    // The collection the dev-reload test edits during `next dev`; see
    // e2e/dev-reload/schema-edit.spec.ts. Off unless that test starts this app.
    ...(process.env.NEXTLY_E2E_DEV_RELOAD === "1" ? [DevReloadProbe] : []),
    // The Page Builder's default-language browser test needs a localized
    // collection with a translated blocks field; registered for the e2e run
    // only, by the same switch as the style fixture below.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [TranslatedPages] : []),
    // A collection embedding field groups that hold a relationship and an
    // upload, for the browser test of a related item the editor cannot read
    // inside one; registered for the e2e run only, by the same switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [LinkedEntries] : []),
    // The history browser test needs a document with a group and an embedded
    // field group, so a past version can be read in that layout; registered
    // for the e2e run only, by the same switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [HistoryNotes] : []),
    // The browser test of a document editable in one language and read-only
    // in another needs a rule that answers by language; registered for the
    // e2e run only, by the same switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [TranslatorNotes] : []),
  ],
  // Announcement is the localized single WITH the draft/published lifecycle,
  // registered for the same reason Authors is: so the per-language publish
  // surfaces are exercised in development rather than existing only in code.
  singles: [
    Homepage,
    LandingPage,
    SiteSettings,
    Announcement,
    // A Single holding a relationship and an upload, for the browser test of a
    // related item the editor cannot read; registered for the e2e run only, by
    // the same switch as the style fixture below.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [RelatedLinks] : []),
  ],
  fieldGroups: [
    Seo,
    // The field groups the e2e fixtures above embed, registered by the same
    // switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1"
      ? [LinkCard, LinkQuote]
      : []),
  ],
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
    // Always on, because its widgets are drawn by their own components, which
    // the committed component map must hold; offered only from the add panel,
    // named as test fixtures. Moves to the dev-only widget preview page once
    // there is one.
    widgetKitFixturePlugin,
    // Always on, for the same reason: the blocks it contributes reach the
    // editor through the committed component map. Offered only in the Add
    // panel, named as test fixtures, for plugin-blocks.spec.ts.
    blockFixturePlugin,
    // A card whose data answers as late as a spec asks, for the slow-card
    // spec; off in a contributor's dev server, where it would be a test double.
    ...(process.env.NEXTLY_E2E_SLOW_WIDGET === "1"
      ? [slowWidgetFixturePlugin]
      : []),
    // Refuses the admin by design (a widget whose component the committed map
    // lacks), so only the component-map e2e spec's own server turns it on.
    ...(process.env.NEXTLY_E2E_MISSING_WIDGET === "1"
      ? [missingWidgetFixturePlugin]
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
