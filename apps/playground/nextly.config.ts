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

import { Categories } from "./src/collections/categories";
import { Posts } from "./src/collections/posts";
import { Tags } from "./src/collections/tags";
import { Homepage } from "./src/singles/homepage";

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
  collections: [Posts, Categories, Tags],
  singles: [Homepage],
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
