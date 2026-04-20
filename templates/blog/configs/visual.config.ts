// Visual approach: Collections and singles are created via the Admin Panel.
// If demo data was selected, the seed script creates blog schemas and
// sample content automatically on first run.
//
// After setup, you can modify schemas through the Admin Panel UI:
// - Add, remove, or edit fields on any collection
// - Create new collections and singles
// - All changes are reflected in the database immediately
import { defineConfig } from "@revnixhq/nextly/config";

export default defineConfig({
  collections: [],
  singles: [],

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
