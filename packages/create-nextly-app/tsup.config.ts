import { cpSync, existsSync, readdirSync, renameSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "tsup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Templates that are bundled into the CLI package for offline use.
// Content templates (blog, etc.) are downloaded from GitHub at runtime.
// `plugin` is bundled so plugins are scaffoldable offline (D44).
const BUNDLED_TEMPLATES = ["base", "blank", "plugin"] as const;

/**
 * Rename every `.gitignore` in the copied tree to the publish-safe name
 * `gitignore`. npm's packer (npm-packlist, used by npm and pnpm pack alike)
 * always strips `.gitignore` files from tarballs, so a bundled template
 * shipped with the dotted name silently loses its ignore rules in the
 * published CLI — scaffolds would then happily commit node_modules, dist,
 * and the generated dev/.env. The scaffolder renames it back at copy time
 * (see restoreBundledGitignores in src/utils/template.ts).
 */
function renameGitignoresForPacking(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A template dir may carry a local node_modules from testing the dev/
      // playground in place; recursing into it is pure waste.
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      renameGitignoresForPacking(full);
    } else if (entry.name === ".gitignore") {
      renameSync(full, path.join(dir, "gitignore"));
    }
  }
}

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
    // Publish-safe rename: a dotted .gitignore would be stripped from the
    // npm tarball, so the bundled copy carries `gitignore` instead.
    renameGitignoresForPacking(target);
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
