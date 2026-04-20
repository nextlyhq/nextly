// Both approach: Core schemas are defined here in code. You can also create
// additional collections and singles via the Admin Panel UI.
//
// Code-defined schemas take priority and sync on every `pnpm dev`.
// UI-created schemas are stored in the database and managed via the Admin Panel.
// This gives you the best of both worlds: version-controlled core schemas
// with the flexibility to extend via the UI.
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
