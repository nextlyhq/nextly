import { defineConfig } from "@revnixhq/nextly/config";

export default defineConfig({
  // Add your collections here
  collections: [],

  // Add your singles (globals) here
  singles: [],

  // TypeScript type generation
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
});
