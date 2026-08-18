/**
 * Controls for the design-system lint guard.
 *
 * The guard had no tests. That mattered more than an ordinary coverage gap,
 * because it is the check every other surface relies on to notice a hardcoded
 * colour — and its own failure mode is silence: a scan that reads nothing
 * reports exactly what a clean repository reports.
 *
 * The rules are exercised through the exported decisions rather than by running
 * the whole scan, so a case can be stated as one line of source and one
 * expectation. The scan itself is covered at the end by running the real
 * script, which is the only way to assert the entry guard and the summary.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  auditFile,
  colorLiteralIsExempt,
  colorLiteralViolation,
  deriveRoots,
  emptyPopulations,
  isCommentLine,
  isPluginSurface,
  paletteViolation,
  tokenWrapViolation,
} from "./lint-design.mjs";

describe("isPluginSurface", () => {
  it("recognises a plugin package and the plugin template", () => {
    expect(isPluginSurface("packages/plugin-form-builder/src/admin/X.tsx")).toBe(true);
    expect(isPluginSurface("packages/plugin-seo/src/index.ts")).toBe(true);
    expect(isPluginSurface("templates/plugin/src/admin/SettingsPage.tsx")).toBe(true);
  });

  it("does not classify the admin, the kit, or a package that merely contains the word", () => {
    expect(isPluginSurface("packages/admin/src/x.tsx")).toBe(false);
    expect(isPluginSurface("packages/ui/src/x.tsx")).toBe(false);
    // `packages/eslint-plugin` contains "plugin" and is tooling, not a surface.
    expect(isPluginSurface("packages/eslint-plugin/src/index.js")).toBe(false);
    // The other templates are site starters, deliberately out of scope.
    expect(isPluginSurface("templates/blog/src/app/page.tsx")).toBe(false);
  });
});

describe("isCommentLine", () => {
  it("is true only for a line that is nothing but a comment", () => {
    expect(isCommentLine("  // a note")).toBe(true);
    expect(isCommentLine("   * jsdoc continuation")).toBe(true);
    expect(isCommentLine("/* opening */")).toBe(true);
    expect(isCommentLine('const a = "x"; // trailing')).toBe(false);
    expect(isCommentLine("")).toBe(false);
  });
});

describe("colorLiteralIsExempt", () => {
  const file = "packages/plugin-seo/src/x.ts";

  it("exempts a marked line, but only with a reason", () => {
    expect(colorLiteralIsExempt('a: "#ff0000" // design-lint-ok: brand swatch', file)).toBe(true);
    expect(colorLiteralIsExempt('a: "#ff0000" // design-lint-ok', file)).toBe(false);
  });

  it("exempts mode-invariant colours and content, not real ones", () => {
    expect(colorLiteralIsExempt('a: "#fff"', file)).toBe(true);
    expect(colorLiteralIsExempt('a: "#00000033"', file)).toBe(true);
    expect(colorLiteralIsExempt('a: "rgba(0,0,0,.5)"', file)).toBe(true);
    expect(colorLiteralIsExempt('a: "#1a2b3c"', file)).toBe(false);
  });

  it("exempts a token DECLARATION in the theme source only", () => {
    const theme = "packages/ui/src/styles/theme.css";
    expect(colorLiteralIsExempt("  --nx-primary: oklch(0.6 0.2 30);", theme)).toBe(true);
    // The same line anywhere else is a second definition of a themed colour.
    expect(colorLiteralIsExempt("  --nx-primary: oklch(0.6 0.2 30);", file)).toBe(false);
  });

  it("exempts the Tailwind palette scale wherever it is declared", () => {
    expect(colorLiteralIsExempt("  --color-blue-500: #3b82f6;", file)).toBe(true);
  });
});

describe("the individual rules", () => {
  it("tokenWrapViolation reports a token wrapped in a colour function", () => {
    expect(tokenWrapViolation("f:1", "color: hsl(var(--nx-primary));")).toContain("token wrapped");
    expect(tokenWrapViolation("f:1", "color: var(--nx-primary);")).toBeNull();
  });

  it("colorLiteralViolation applies to CSS and plugin source, not admin tsx", () => {
    const line = 'const a = "#1a2b3c";';
    expect(colorLiteralViolation("f:1", line, "a.css", { isCss: true, isPlugin: false })).toContain("hardcoded color");
    expect(colorLiteralViolation("f:1", line, "p.ts", { isCss: false, isPlugin: true })).toContain("hardcoded color");
    expect(colorLiteralViolation("f:1", line, "a.tsx", { isCss: false, isPlugin: false })).toBeNull();
  });

  it("paletteViolation names the replacement scale, and skips prose and the theme", () => {
    const found = paletteViolation("f:1", '<div className="bg-red-500" />', { isThemeSource: false });
    expect(found).toContain("destructive-*");
    // A hue named in a whole-line comment styles nothing.
    expect(paletteViolation("f:1", "// we used bg-red-500 here once", { isThemeSource: false })).toBeNull();
    // The theme file is where the scales are declared.
    expect(paletteViolation("f:1", '"bg-red-500"', { isThemeSource: true })).toBeNull();
    // A marked exception with a reason.
    expect(
      paletteViolation("f:1", '"bg-red-500" // design-lint-ok: external brand', { isThemeSource: false })
    ).toBeNull();
  });
});

describe("auditFile", () => {
  it("reports across rules and returns the plugin classification", () => {
    const result = auditFile(
      "packages/plugin-seo/src/x.ts",
      ['const a = "#1a2b3c";', 'const b = "bg-red-500";'].join("\n")
    );
    expect(result.isPlugin).toBe(true);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toContain(":1");
    expect(result.violations[1]).toContain(":2");
  });

  it("BANS !important in a plugin and COUNTS it in the admin", () => {
    const plugin = auditFile("packages/plugin-seo/src/x.ts", ".a { color: red !important; }");
    expect(plugin.violations.some(v => v.includes("!important not allowed"))).toBe(true);
    expect(plugin.adminImportant).toBe(0);

    const admin = auditFile("packages/admin/src/styles/globals.css", ".a { color: red !important; }");
    expect(admin.violations.some(v => v.includes("!important not allowed"))).toBe(false);
    expect(admin.adminImportant).toBe(1);
  });

  it("is clean on token-driven source", () => {
    const result = auditFile(
      "packages/admin/src/x.tsx",
      '<div className="bg-background text-muted-foreground" />'
    );
    expect(result.violations).toEqual([]);
  });
});

describe("emptyPopulations", () => {
  it("names each population that would make the run blind", () => {
    expect(emptyPopulations({ files: 0, pluginClassified: 0 })).toEqual([
      "no files",
      "no plugin-surface files",
    ]);
    // Files read but nothing classified: every plugin-only rule is inert while
    // the summary would still read as a pass.
    expect(emptyPopulations({ files: 10, pluginClassified: 0 })).toEqual([
      "no plugin-surface files",
    ]);
    expect(emptyPopulations({ files: 10, pluginClassified: 2 })).toEqual([]);
  });
});

describe("deriveRoots", () => {
  it("discovers every plugin package rather than naming a fixed list", () => {
    const roots = deriveRoots();
    expect(roots).toContain("packages/admin/src");
    expect(roots).toContain("packages/ui/src");
    expect(roots).toContain("templates/plugin/src");
    // Discovered, not listed: these are exactly the packages a hardcoded list
    // was missing before the roots were derived.
    expect(roots).toContain("packages/plugin-sdk/src");
    expect(roots).toContain("packages/plugin-seo/src");
  });
});

describe("the script as a whole", () => {
  it("runs, passes on this repository, and prints the population it read", () => {
    const out = execFileSync("node", ["scripts/lint-design.mjs"], { encoding: "utf8" });
    expect(out).toContain("Design lint passed");
    // The population is part of the output on purpose: a scan that read nothing
    // must not be indistinguishable from a clean tree.
    expect(out).toMatch(/\d+ files across \d+ roots/);
    expect(out).toMatch(/\(\d+ plugin-surface\)/);
    expect(out).toContain("roots:");
  });
});
