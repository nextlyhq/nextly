import { cpSync, existsSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { defineConfig } from "tsdown";

// The repository's own skill check, so the build bundles exactly the skills
// it holds to be for people building with Nextly.
import { userSkillSeparation } from "../../scripts/agent-skills.mjs";
// The supported ranges, from the nextly package's own peers.
import { frameworkRanges } from "../../scripts/framework-ranges.mjs";

import {
  copyBundledSkills,
  skillsToBundle,
  skillsVersionIn,
} from "./src/lib/bundled-skills";
import { BUNDLED_TEMPLATES } from "./src/lib/bundled-templates";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Copies the repository's user skills into the package, which publishes
 * them, so a scaffold writes the skills of this release into the project.
 * Unlike the templates it refuses when the source is missing: a package
 * built without its skills would fail every scaffold that asks for them.
 */
function copyBundledSkillsFromRepository(): void {
  const repository = path.resolve(__dirname, "../..");
  const names = skillsToBundle(userSkillSeparation(repository));
  // Refuses skills that name no release, or different ones, before copying:
  // a scaffold writes them only into a project on that release.
  const version = skillsVersionIn(path.join(repository, "skills"), names);
  copyBundledSkills(
    path.join(repository, "skills"),
    names,
    path.resolve(__dirname, "skills")
  );
  console.log(
    `✓ Bundled skills copied (nextly ${version}): ${names.join(", ")}`
  );
}

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Inlined at build, so the published CLI carries the ranges and never
  // loads the nextly package to read them.
  define: {
    __NEXTLY_FRAMEWORK_RANGES__: JSON.stringify(frameworkRanges()),
  },
  target: "node18",
  platform: "node",
  // Bundle all dependencies so the CLI is self-contained and works
  // without needing to install dependencies (e.g. via npx or yalc).
  deps: { alwaysBundle: [/(.*)/] },
  // Inject createRequire so CJS deps (fs-extra, graceful-fs) that use
  // require("fs") work correctly when bundled into ESM output.
  // Keep the file names the exports map already publishes.
  outExtensions({ format }) {
    return format === "cjs"
      ? { js: ".cjs", dts: ".d.cts" }
      : { js: ".mjs", dts: ".d.ts" };
  },
  checks: { legacyCjs: false },
  cjsDefault: false,
  onSuccess() {
    copyBundledTemplates();
    copyBundledSkillsFromRepository();
  },
});
