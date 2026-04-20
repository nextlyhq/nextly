import { cpSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/admin/index.ts", "src/components/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  external: ["@revnixhq/plugin-form-builder/styles/submissions-filter.css"],
  async onSuccess() {
    console.log("\n🎨 Copying plugin-form-builder CSS files to dist...");
    try {
      const rootDir = process.cwd();
      const srcStyles = join(rootDir, "src/styles");
      const distStyles = join(rootDir, "dist/styles");

      if (!existsSync(distStyles)) {
        mkdirSync(distStyles, { recursive: true });
        console.log("Created dist/styles directory");
      }

      if (existsSync(srcStyles)) {
        cpSync(srcStyles, distStyles, { recursive: true });
        console.log("CSS files copied successfully");
      } else {
        console.warn("Source styles directory not found:", srcStyles);
      }

      console.log("Assets copied successfully\n");
    } catch (error) {
      console.error("❌ Failed to copy style files:", error);
      // Don't fail the build if assets are missing, but log the error
    }
  },
});
