// Code-first approach: All schemas defined in TypeScript.
// Collections and singles are synced to the database on `pnpm dev`.
// Edit the shared definitions in ./shared.ts to add, remove, or modify fields.
import { defineConfig } from "@revnixhq/nextly/config";

import { posts, authors, categories, tags, siteSettings } from "./shared";

export default defineConfig({
  collections: [posts, authors, categories, tags],
  singles: [siteSettings],

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
