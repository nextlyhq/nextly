/**
 * The admin stylesheet's one isolation sequence.
 *
 * The admin's build and the playground's compile of the admin's source both
 * run it, so what it does to a sheet is what ships and what the playground
 * shows. Pinned on the shapes Tailwind emits for the admin: a theme on
 * `:root, :host`, a reset on `html, :host`, a keyframe, a registered property.
 */

import { describe, expect, it } from "vitest";

import {
  ADMIN_NAME_PREFIX,
  isolateAdminStylesheet,
} from "./admin-stylesheet.mjs";

const SHEET = [
  "@layer theme {",
  ":root, :host {",
  "  --font-sans: Geist, sans-serif;",
  "}",
  "}",
  "@layer base {",
  "html, :host {",
  "  font-family: var(--font-sans);",
  "}",
  "}",
  "@keyframes spin {",
  "  to {",
  "    transform: rotate(360deg);",
  "  }",
  "}",
  ".animate-spin {",
  "  animation: spin 1s linear infinite;",
  "}",
  "@property --tw-rotate-x {",
  '  syntax: "*";',
  "  inherits: false;",
  "}",
  ".rotate {",
  "  rotate: var(--tw-rotate-x);",
  "}",
].join("\n");

describe("isolateAdminStylesheet", () => {
  it("puts the theme and the reset under the admin's root, not the document's", () => {
    const out = isolateAdminStylesheet(SHEET);

    expect(out).not.toMatch(/(^|[\s,}]):root\b/);
    expect(out).not.toMatch(/(^|[\s,}])html\b/);
    expect(out).toMatch(/\.nextly-admin[^{]*\{\s*--font-sans: Geist/);
    expect(out).toMatch(
      /\.nextly-admin[^{]*\{\s*font-family: var\(--font-sans\)/
    );
  });

  it("prefixes the names a document resolves globally", () => {
    const out = isolateAdminStylesheet(SHEET);

    expect(ADMIN_NAME_PREFIX).toBe("nx-");
    expect(out).toContain("@keyframes nx-spin");
    expect(out).toContain("animation: nx-spin 1s linear infinite");
    expect(out).toContain("@property --nx-tw-rotate-x");
    expect(out).toContain("var(--nx-tw-rotate-x)");
    expect(out).not.toContain("--tw-rotate-x {");
  });

  it("takes another prefix when asked", () => {
    const out = isolateAdminStylesheet(SHEET, { prefix: "zz-" });

    expect(out).toContain("@keyframes zz-spin");
    expect(out).toContain("@property --zz-tw-rotate-x");
  });

  it("refuses a sheet with a rule it could not scope, naming it", () => {
    // A selector list over several lines: the scoper reads one rule to a line,
    // so the lines before the brace stay as written and escape.
    const escaped = [".a,", ".escaped-rule {", "  color: red;", "}"].join("\n");

    expect(() => isolateAdminStylesheet(escaped)).toThrow(
      /escaped the \.nextly-admin scope: .*\.a/
    );
  });
});
