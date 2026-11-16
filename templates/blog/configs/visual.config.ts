// Visual approach: Collections and singles are created via the Admin Panel.
// If demo data was selected, the seed script creates blog schemas and
// sample content automatically on first run.
//
// After setup, you can modify schemas through the Admin Panel UI:
// - Add, remove, or edit fields on any collection
// - Create new collections and singles
// - All changes are reflected in the database immediately
//
// Relative imports (`./src/...`), as in codefirst.config.ts: the CLI copies
// this file to the project root as `nextly.config.ts` and loads it with plain
// Node.js module resolution.
import { defineConfig } from "nextly/config";

import { postsCreditPlugin } from "./src/collections/Posts/credit-plugin";

export default defineConfig({
  collections: [],
  singles: [],

  // A post's owner and its byline are filled from the account that writes
  // it. The Posts the migration registers can't hold a function, so these
  // hooks are registered by a plugin rather than declared on the collection.
  plugins: [postsCreditPlugin],

  // Database migrations directory (SQL-based templates store migrations at root)
  db: {
    migrationsDir: "./migrations",
  },

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
