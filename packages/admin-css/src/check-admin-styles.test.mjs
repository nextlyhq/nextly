/**
 * The admin.styles validator. Pins that scoped, token-driven CSS passes while
 * an unscoped rule or a hardcoded color on a color property is rejected — and
 * that token DEFINITIONS and `var()` usage are NOT false-flagged.
 */
import { describe, expect, it } from "vitest";

import { checkAdminStyles } from "./check-admin-styles.mjs";

describe("checkAdminStyles", () => {
  it("passes a scoped, token-driven rule", () => {
    expect(
      checkAdminStyles({
        css: ".nextly-admin .foo { color: var(--nx-primary) }",
      })
    ).toEqual([]);
  });

  it("does not flag token definitions (custom properties with literal colors)", () => {
    expect(
      checkAdminStyles({
        css: ".nextly-admin { --nx-primary: oklch(0.2 0 0); --nx-bg: #fff }",
      })
    ).toEqual([]);
  });

  it("rejects an unscoped rule", () => {
    const issues = checkAdminStyles({ css: ".foo { display: flex }" });
    expect(issues.some(i => i.severity === "error")).toBe(true);
  });

  it("rejects a hardcoded color on a color property", () => {
    const issues = checkAdminStyles({
      css: ".nextly-admin .foo { color: #ff0000 }",
    });
    expect(
      issues.some(i => i.severity === "error" && /hardcoded color/.test(i.message))
    ).toBe(true);
  });

  it("rejects an rgb() background literal", () => {
    const issues = checkAdminStyles({
      css: ".nextly-admin .foo { background-color: rgb(0,0,0) }",
    });
    expect(issues.some(i => /hardcoded color/.test(i.message))).toBe(true);
  });

  it("rejects a literal color hidden in a var() fallback", () => {
    const issues = checkAdminStyles({
      css: ".nextly-admin .foo { color: var(--nx-x, #ff0000) }",
    });
    expect(issues.some(i => /hardcoded color/.test(i.message))).toBe(true);
  });

  it("passes a var() with a token fallback (no literal)", () => {
    expect(
      checkAdminStyles({
        css: ".nextly-admin .foo { color: var(--nx-x, var(--nx-y)) }",
      })
    ).toEqual([]);
  });
});
