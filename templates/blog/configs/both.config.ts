// Both approach: core schemas are defined here in code. You can also
// create additional collections and singles via the Admin Panel UI.
//
// Code-defined schemas take priority and sync on every `pnpm dev`.
// UI-created schemas are stored in the database and managed via the
// Admin Panel. This gives you the best of both worlds: version-controlled
// core schemas with the flexibility to extend via the UI.
import { defineConfig, text, textarea } from "@revnixhq/nextly/config";
import { formBuilderPlugin } from "@revnixhq/plugin-form-builder";

// Imports use `./src/...` relative paths (not `@/*` alias) because
// Nextly's CLI loads this config through plain Node.js, which does not
// honor tsconfig path aliases. See codefirst.config.ts for full note.
import { Categories } from "./src/collections/Categories";
import { Posts } from "./src/collections/Posts";
import { Tags } from "./src/collections/Tags";
import { Homepage } from "./src/globals/Homepage";
import { Navigation } from "./src/globals/Navigation";
import { SiteSettings } from "./src/globals/SiteSettings";

export default defineConfig({
  collections: [Posts, Categories, Tags],
  singles: [SiteSettings, Navigation, Homepage],

  // Form builder plugin registers `forms` and `form-submissions`
  // collections so the newsletter form (and any other forms users
  // create in the admin) work out of the box. Plugin docs:
  // packages/plugin-form-builder/README.md in the Nextly monorepo.
  plugins: [formBuilderPlugin],

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
