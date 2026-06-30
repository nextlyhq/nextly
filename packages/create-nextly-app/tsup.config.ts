import { cpSync, existsSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "tsup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Templates that are bundled into the CLI package for offline use.
// Content templates (blog, etc.) are downloaded from GitHub at runtime.
// `plugin` is bundled so plugins are scaffoldable offline (D44).
const BUNDLED_TEMPLATES = ["base", "blank", "plugin"] as const;

function copyBundledTemplates(): void {
  const monoRepoTemplates = path.resolve(__dirname, "../../templates");
  const dest = path.resolve(__dirname, "templates");

  if (!existsSync(monoRepoTemplates)) {
    console.warn(
      `\n⚠  Monorepo templates not found at ${monoRepoTemplates} — skipping template copy.\n` +
        "   Run from the monorepo root or use --local-template when testing."
    );
    return;
  }

  for (const tmpl of BUNDLED_TEMPLATES) {
    const src = path.join(monoRepoTemplates, tmpl);
    const target = path.join(dest, tmpl);

    if (!existsSync(src)) {
      console.warn(`⚠  Template "${tmpl}" not found at ${src} — skipping.`);
      continue;
    }

    // Clean stale copy before overwriting so removed files don't linger.
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }

    cpSync(src, target, { recursive: true });
  }

  console.log(`✓ Bundled templates copied: ${BUNDLED_TEMPLATES.join(", ")}`);
}

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "node18",
  platform: "node",
  // Bundle all dependencies so the CLI is self-contained and works
  // without needing to install dependencies (e.g. via npx or yalc).
  noExternal: [/(.*)/],
  // Inject createRequire so CJS deps (fs-extra, graceful-fs) that use
  // require("fs") work correctly when bundled into ESM output.
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".mjs",
    };
  },
  async onSuccess() {
    copyBundledTemplates();
  },
});
