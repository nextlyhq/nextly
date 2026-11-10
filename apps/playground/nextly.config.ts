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
import { seoPlugin } from "@nextlyhq/plugin-seo";
import { defineCollection, defineConfig, text } from "nextly/config";

import { JOURNAL, JOURNAL_COLLECTIONS } from "./src/blog-fixture/collections";
import { Authors } from "./src/collections/authors";
import { BlockPages } from "./src/collections/block-pages";
import { BoundEntries } from "./src/collections/bound-entries";
import { EntryArticles } from "./src/collections/entry-articles";
import { ListStories } from "./src/collections/list-stories";
import { E2E_NAMED_QUERIES } from "./src/named-queries";
import { Categories } from "./src/collections/categories";
import { DevReloadProbe } from "./src/collections/dev-reload-probe";
import { HistoryNotes } from "./src/collections/history-notes";
import { LinkedEntries } from "./src/collections/linked-entries";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { TranslatedPages } from "./src/collections/translated-pages";
import { TranslatorNotes } from "./src/collections/translator-notes";
import { siteNotesWidget } from "./src/dashboard/site-notes-widget";
import { LinkCard, LinkQuote } from "./src/field-groups/related-link-groups";
import { Seo } from "./src/field-groups/seo";
import { SITE_STYLE_DEFAULTS } from "./src/lib/site-style-defaults";
import { blockFixturePlugin } from "./src/plugins/block-fixture/plugin";
import { contributionsFixturePlugin } from "./src/plugins/contributions-fixture/plugin";
import { missingWidgetFixturePlugin } from "./src/plugins/missing-widget-fixture/plugin";
import { slowWidgetFixturePlugin } from "./src/plugins/slow-widget-fixture/plugin";
import { styleFixturePlugin } from "./src/plugins/style-fixture/plugin";
import { widgetKitFixturePlugin } from "./src/plugins/widget-kit-fixture/plugin";
import { Announcement } from "./src/singles/announcement";
import { ContactDetails } from "./src/singles/contact-details";
import { Homepage } from "./src/singles/homepage";
import { LandingPage } from "./src/singles/landing-page";
import { RelatedLinks } from "./src/singles/related-links";
import { SiteSettings } from "./src/singles/site-settings";

// Set by e2e/playwright.config.ts for the suite's own server. Compared to
// "1" rather than checked for presence so an empty value reads as off.
const brandingColorsEnabled = process.env.NEXTLY_E2E_BRANDING === "1";

/**
 * First-party plugins this playground registers only when asked, by name, in
 * a comma-separated `NEXTLY_PLAYGROUND_PLUGINS` (`seo`). Off by default: each
 * one adds fields, routes or dashboard cards that a contributor's daily
 * `pnpm dev:app` and every other browser spec would otherwise meet.
 * `e2e/playwright.config.ts` names the ones the suite's own server runs with.
 */
const playgroundPlugins = new Set(
  (process.env.NEXTLY_PLAYGROUND_PLUGINS ?? "")
    .split(",")
    .map(name => name.trim())
    .filter(name => name !== "")
);
const seoPluginEnabled = playgroundPlugins.has("seo");

/**
 * The one collection the SEO plugin extends here, registered with it. Its own
 * collection rather than Posts, so the `seo` group the plugin adds reaches no
 * entry form, list or count another spec reads.
 */
const SeoPages = defineCollection({
  slug: "seo-pages",
  labels: { singular: "SEO page", plural: "SEO pages" },
  fields: [text({ name: "title", label: "Title", required: true })],
});

/**
 * The page builder, as one instance, so the site's routes can hand their
 * pages this site's own named queries (`namedQueriesOf`) and never another
 * site's served from the same process.
 */
export const pageBuilderPlugin = pageBuilder({
  siteStyle: SITE_STYLE_DEFAULTS,
  // The browser tests' custom sources, registered by the same switch as
  // the collections and the Single they read.
  ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1"
    ? { namedQueries: [...E2E_NAMED_QUERIES] }
    : {}),
  pagePreviewPath: "/{slug}",
  // Each post is served at `/blog/<its slug>` by the same route as the pages,
  // drawn with the Posts template once one is published.
  // The Entry content fixture's articles at `/articles/<slug>`, and the blog
  // fixture's posts at `/journal/<slug>`, with it.
  templates: {
    addresses: {
      posts: "/blog",
      ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1"
        ? {
            "entry-articles": "/articles",
            // The blog fixture's posts, rebuilt with their template.
            [JOURNAL.posts]: "/journal",
          }
        : {}),
    },
  },
  // The route that draws the editor's canvas inside this site's layout.
  canvasPath: "/page-builder-canvas",
  // The browser suite's stand-in Google Fonts catalogue, so adding a font
  // there never reaches the real one. Unset everywhere else: the plugin's
  // defaults (Fontsource and jsDelivr) apply.
  ...(process.env.NEXTLY_E2E_FONT_CATALOGUE === undefined
    ? {}
    : {
        fonts: {
          catalogue: {
            api: process.env.NEXTLY_E2E_FONT_CATALOGUE,
            files: process.env.NEXTLY_E2E_FONT_CATALOGUE,
          },
        },
      }),
});

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
    // A widget the site declares itself, offered in the Add panel like a
    // plugin's, for site-widget.spec.ts.
    dashboard: { widgets: [siteNotesWidget] },
    // The environment badge in the dashboard's header, only when a contributor
    // names one: never guessed, as an app is told to configure it.
    ...(process.env.NEXTLY_ENV_LABEL
      ? { environment: { label: process.env.NEXTLY_ENV_LABEL } }
      : {}),
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
    // The browser test of bindings served to the public needs a list whose
    // fields include one the public may not read; registered for the e2e run
    // only, by the same switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [BoundEntries] : []),
    // What a template's Entry content block draws, for its browser tests.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [EntryArticles] : []),
    // The browser test of a collection list's related source needs a public,
    // page-built entry holding a public to-many relation; registered for the
    // e2e run only, by the same switch.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [ListStories] : []),
    // The blog template's own posts, authors, categories and tags, renamed,
    // for the browser test of its post page rebuilt with a template.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1"
      ? JOURNAL_COLLECTIONS
      : []),
    // The collection the SEO plugin extends, by the plugin's own switch.
    ...(seoPluginEnabled ? [SeoPages] : []),
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
    // A Single with a field the public may not read, for the browser test of
    // the editor marking a bound value a visitor will not see.
    ...(process.env.NEXTLY_E2E_STYLE_FIXTURE === "1" ? [ContactDetails] : []),
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
    pageBuilderPlugin,
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
    // Always on: the plugin contributions a page offers (today one entry-list
    // filter on Posts) appear only in its menus until someone chooses them,
    // and their screenshots, and the browser tests to come, need them in every
    // build.
    // Named as a fixture, and inert: no tables, routes, jobs or hooks.
    contributionsFixturePlugin,
    // The SEO plugin as it ships, for the browser test of its dashboard card
    // and its Needs attention line, by the switch above. No sitemap: a public
    // route is not what that test is about.
    ...(seoPluginEnabled
      ? [seoPlugin({ collections: [SeoPages.slug], sitemap: false })]
      : []),
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
