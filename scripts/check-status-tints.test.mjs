/**
 * Controls for the status-tint check: what it must catch, what it must leave
 * alone, and the repository itself, which must draw none.
 */

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  audit,
  isScanned,
  tintsIn,
  tintsInFile,
} from "./check-status-tints.mjs";

describe("a mixed status tint", () => {
  it.each([
    ["bg-success-100", "bg-success-100"],
    ["text-destructive-700 dark:text-destructive", "text-destructive-700"],
    ["dark:bg-success-900/70", "dark:bg-success-900/70"],
    ["hover:bg-destructive/10", "hover:bg-destructive/10"],
    ["ring-success-500/20", "ring-success-500/20"],
    ["border-warning-200", "border-warning-200"],
    [
      "data-[highlighted]:text-destructive-700",
      "data-[highlighted]:text-destructive-700",
    ],
    ["bg-warning/[0.08]", "bg-warning/[0.08]"],
    ["before:text-success-500", "before:text-success-500"],
    ["focus:ring-destructive-500", "focus:ring-destructive-500"],
    ["bg-[var(--color-warning-700)]", "--color-warning-700"],
  ])("is caught in %j", (classes, tint) => {
    expect(tintsIn(classes)).toEqual([tint]);
  });

  it.each([
    "bg-danger-surface border-danger-border text-danger-text",
    "bg-success-solid text-success-text",
    "bg-destructive-solid text-destructive-foreground hover:bg-destructive-hover",
    "text-destructive border-destructive bg-warning text-success",
    "bg-primary/10 text-muted-foreground",
    "success-100 is a shade name, not a class",
  ])("is not read into the tokens and plain colours %j", classes => {
    expect(tintsIn(classes)).toEqual([]);
  });
});

describe("what a file draws", () => {
  it("reads quoted strings and every literal part of a template", () => {
    const source = [
      'const a = "rounded bg-success-100";',
      "const b = `p-2 ${x} text-warning-700`;",
      'export const C = () => <div className="hover:bg-destructive/10" />;',
    ].join("\n");
    expect(tintsInFile("f.tsx", source)).toEqual([
      "bg-success-100",
      "text-warning-700",
      "hover:bg-destructive/10",
    ]);
  });

  it("skips comments, where a class is named but never drawn", () => {
    const source = [
      "// `bg-success-100` was the old badge fill",
      "/* text-destructive-700 dropped to 3.7:1 */",
      'export const C = () => <div className="bg-danger-surface">{/* bg-warning-50 */}</div>;',
    ].join("\n");
    expect(tintsInFile("f.tsx", source)).toEqual([]);
  });

  it("reads CSS outside its comments", () => {
    const css =
      "/* bg-success-100 */ .x { @apply bg-warning-50; color: var(--color-success-700); }";
    expect(tintsInFile("f.css", css)).toEqual([
      "bg-warning-50",
      "--color-success-700",
    ]);
  });

  it("leaves the shades' definitions, their contrast audit and tests out of the scan", () => {
    expect(isScanned("packages/ui/src/styles/theme.css")).toBe(false);
    expect(isScanned("packages/ui/src/tailwind-preset.ts")).toBe(false);
    expect(isScanned("packages/ui/src/styles/contrast/pairings.ts")).toBe(
      false
    );
    expect(isScanned("packages/admin/src/x/__tests__/y.test.tsx")).toBe(false);
    expect(isScanned("packages/admin/src/x/Thing.stories.tsx")).toBe(false);
    expect(isScanned("packages/admin/src/x/Thing.tsx")).toBe(true);
    expect(isScanned("packages/plugin-seo/src/admin/Panel.tsx")).toBe(true);
    expect(isScanned("packages/admin/src/styles/admin.css")).toBe(true);
  });
});

describe("the repository", () => {
  it("draws no mixed status tint, with nothing allowed", () => {
    const result = audit();
    // A scan that read nothing would pass for the wrong reason.
    expect(result.filesRead).toBeGreaterThan(500);
    expect(result.findings).toEqual([]);
    expect(result.unusedAllowances).toEqual([]);
    expect(ALLOWED).toEqual([]);
  });

  it("refuses an allowance nothing needs, so the list only shrinks", () => {
    const stale = {
      file: "packages/admin/src/components/ui/form/index.tsx",
      tint: "text-destructive-500",
      reason: "no longer drawn",
    };
    expect(audit(process.cwd(), [stale]).unusedAllowances).toEqual([stale]);
  });
});
