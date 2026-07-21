/**
 * Nextly Playground Configuration
 *
 * Internal contributor playground for the Nextly monorepo. NOT a
 * template for end-user projects — see templates/blog for that.
 *
 * Collections Posts, Categories, Tags (defined here) plus Media and
 * Users (core, registered automatically), and two singles (Homepage,
 * LandingPage). Dev-harness plugins — page builder, form builder, and a
 * styling fixture — exercise the plugin surfaces; the playground otherwise
 * stays minimal so a broken change is easy to spot.
 *
 * Storage falls through to the local-disk default when no cloud env
 * vars are set (handled by packages/nextly/src/storage/env-config.ts).
 *
 * admin.devAutoLogin makes the contributor land on /admin already
 * logged in. It is hard-blocked in production by the framework's
 * session handler — even if NODE_ENV ends up wrong on a deploy, the
 * runtime ignores this field. See packages/nextly/src/auth/handlers/session.ts.
 */

import { formBuilderPlugin } from "@nextlyhq/plugin-form-builder";
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineConfig } from "nextly/config";

import { Categories } from "./src/collections/categories";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { styleFixturePlugin } from "./src/plugins/style-fixture/plugin";
import { Homepage } from "./src/singles/homepage";
import { LandingPage } from "./src/singles/landing-page";

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
  collections: [Posts, Categories, Tags],
  singles: [Homepage, LandingPage],
  // Dev-harness plugins: page builder, form builder, and the styling fixture
  // (exercises the plugin admin-styling layers for e2e).
  plugins: [pageBuilder(), formBuilderPlugin, styleFixturePlugin],
  typescript: {
    outputFile: "./src/types/nextly-types.ts",
  },
  db: {
    schemasDir: "./src/db/schemas/collections",
    migrationsDir: "./src/db/migrations",
  },
});
