/**
 * Nextly Playground Configuration
 *
 * Internal contributor playground for the Nextly monorepo. NOT a
 * template for end-user projects — see templates/blog for that.
 *
 * Five collections in scope: Posts, Categories, Tags (defined here)
 * plus Media and Users (core, registered automatically). No plugins,
 * no singles, no dynamic schemas — the playground stays minimal so a
 * broken plugin can't break the playground.
 *
 * Storage falls through to the local-disk default when no cloud env
 * vars are set (handled by packages/nextly/src/storage/env-config.ts).
 *
 * admin.devAutoLogin makes the contributor land on /admin already
 * logged in. It is hard-blocked in production by the framework's
 * session handler — even if NODE_ENV ends up wrong on a deploy, the
 * runtime ignores this field. See packages/nextly/src/auth/handlers/session.ts.
 */

import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import { defineConfig } from "nextly/config";

import { Authors } from "./src/collections/authors";
import { Categories } from "./src/collections/categories";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { Seo } from "./src/components/seo";
import { Homepage } from "./src/singles/homepage";
import { LandingPage } from "./src/singles/landing-page";
import { SiteSettings } from "./src/singles/site-settings";

export default defineConfig({
  admin: {
    branding: {
      logoUrlLight: "/Nextly_Icon_dark.svg",
      logoUrlDark: "/Nextly_Icon_Light.svg",
      logoText: "Nextly Playground",
    },
    devAutoLogin: {
      email: "dev@nextly.local",
      password: "DevPassword123!",
    },
  },
  // Multilingual content. Defines the languages the admin can switch between —
  // required for the entry-editor language switcher, per-language pills, and the
  // "Copy from" / "Publish all languages" actions to appear. A collection also
  // needs its own Internationalization toggle on (or `localized: true` in code).
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
  collections: [Posts, Categories, Tags, Authors],
  singles: [Homepage, LandingPage, SiteSettings],
  // Code-first components (reusable field groups → comp_<slug> tables).
  components: [Seo],
  // First plugin registered in the Playground (consciously relaxing the
  // "playground stays plugin-free" note) — the page-builder dev harness.
  plugins: [pageBuilder()],
  typescript: {
    outputFile: "./src/types/nextly-types.ts",
  },
  db: {
    schemasDir: "./src/db/schemas/collections",
    migrationsDir: "./src/db/migrations",
  },
});
