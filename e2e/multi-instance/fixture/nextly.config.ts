/**
 * One collection, `notes`, holding the single row both instances read. The
 * database comes from `DB_DIALECT` and `DATABASE_URL`, as a deployment's does,
 * and the tables from the committed migration under `./migrations`.
 */
import {
  defineCollection,
  defineConfig,
  text,
  type SanitizedNextlyConfig,
} from "nextly/config";

export const Notes = defineCollection({
  slug: "notes",
  fields: [
    text({ name: "slug", required: true, unique: true }),
    text({ name: "value", required: true }),
  ],
});

// Typed as the public config type: the fixture has no plugins, so the widget
// record defineConfig adds to it is empty, and its own name is not exported.
const config: SanitizedNextlyConfig = defineConfig({
  collections: [Notes],
  db: { migrationsDir: "./migrations" },
});

export default config;
