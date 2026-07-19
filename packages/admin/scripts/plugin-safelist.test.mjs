/**
 * The Layer-2 plugin utility safelist.
 *
 * Third-party plugins cannot add themselves to the admin's `@source` scan, so a
 * curated set of token-driven utilities is force-emitted via `@source inline`.
 * This compiles tailwind + theme + the safelist the same way the admin build
 * does and pins that representative utilities are generated AND scoped under
 * `.nextly-admin`, so a Tailwind upgrade or an accidental edit that drops them
 * fails here instead of silently breaking every plugin.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scopeCss, findUnscopedRules } from "@nextlyhq/admin-css";
import { describe, expect, it, beforeAll } from "vitest";

// import.meta.dirname requires Node 20.11+, above the repo's Node >=20 floor.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let scoped = "";

beforeAll(() => {
  const require = createRequire(import.meta.url);
  const twPkg = require.resolve("@tailwindcss/cli/package.json");
  const twBin = JSON.parse(fs.readFileSync(twPkg, "utf-8")).bin;
  const twCli = path.resolve(
    path.dirname(twPkg),
    typeof twBin === "string" ? twBin : twBin.tailwindcss
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nx-safelist-"));
  const entry = path.join(tmp, "in.css");
  const out = path.join(tmp, "out.css");
  // Same import chain as globals.css, minus the first-party @source scans.
  fs.writeFileSync(
    entry,
    `@import "tailwindcss";\n` +
      `@import "${ROOT}/../ui/src/styles/theme.css";\n` +
      `@import "${ROOT}/src/styles/plugin-safelist.css";\n`
  );
  execFileSync(process.execPath, [twCli, "-i", entry, "-o", out], {
    stdio: "inherit",
  });
  scoped = scopeCss(fs.readFileSync(out, "utf-8"));
});

describe("plugin utility safelist", () => {
  it.each([
    ".nextly-admin .flex",
    ".nextly-admin .grid",
    ".nextly-admin .gap-4",
    ".nextly-admin .p-4",
    ".nextly-admin .text-sm",
    ".nextly-admin .rounded-md",
  ])("emits %s", sel => {
    expect(scoped).toContain(sel);
  });

  it("emits token-mapped colors that resolve through a CSS var, not a literal", () => {
    expect(scoped).toContain(".nextly-admin .bg-primary");
    const rule = scoped.slice(scoped.indexOf(".nextly-admin .bg-primary"));
    expect(rule).toMatch(/var\(--/);
  });

  it("leaves no unscoped utility rules", () => {
    expect(findUnscopedRules(scoped)).toEqual([]);
  });
});
