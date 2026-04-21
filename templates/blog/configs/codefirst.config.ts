// Code-first approach: schemas defined in TypeScript. Collections and
// singles are synced to the database on `pnpm dev`. Edit the files under
// ../src/collections/ and ../src/globals/ to add, remove, or modify fields.
import { defineConfig } from "@revnixhq/nextly/config";

import { Authors } from "../src/collections/Authors";
import { Categories } from "../src/collections/Categories";
import { Posts } from "../src/collections/Posts";
import { Tags } from "../src/collections/Tags";
import { SiteSettings } from "../src/globals/SiteSettings";

export default defineConfig({
  collections: [Posts, Authors, Categories, Tags],
  singles: [SiteSettings],

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
