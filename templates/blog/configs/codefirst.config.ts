// Code-first approach: schemas defined in TypeScript. Collections and
// singles are synced to the database on `pnpm dev`. Edit the files under
// src/collections/ and src/globals/ to add, remove, or modify fields.
//
// Imports are relative (`./src/...`) rather than using the `@/*` alias:
// Nextly's CLI loads this file through plain Node.js module resolution
// when running `nextly dev`, and Node does not honor tsconfig path
// aliases. Using `./src/...` works because the CLI copies this file
// to `nextly.config.ts` at the scaffolded project root - `src/` lives
// right next to it there.
import { defineConfig, text, textarea } from "@revnixhq/nextly/config";

import { Categories } from "./src/collections/Categories";
import { Posts } from "./src/collections/Posts";
import { Tags } from "./src/collections/Tags";
import { Homepage } from "./src/globals/Homepage";
import { Navigation } from "./src/globals/Navigation";
import { SiteSettings } from "./src/globals/SiteSettings";

export default defineConfig({
  collections: [Posts, Categories, Tags],
  singles: [SiteSettings, Navigation, Homepage],

  // Users are the author identity: posts relate to users, and
  // `/authors/[slug]` resolves to a user by their `slug` extension field.
  // Keep fields minimal and scalar; UserConfig.fields only supports
  // scalar types (no group, no upload) in the current Nextly core.
  users: {
    fields: [
      textarea({ name: "bio", maxLength: 500 }),
      text({ name: "avatarUrl" }),
      text({ name: "slug" }),
    ],
  },

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
