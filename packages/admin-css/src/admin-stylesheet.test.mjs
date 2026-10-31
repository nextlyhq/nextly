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
  hasHostElementShield,
  isolateAdminStylesheet,
} from "./admin-stylesheet.mjs";

/** The shield's selectors' common start, as the source and a minifier print it. */
const WEIGHTED = ":is(*,x x x x x x x x x x)";

/**
 * The shield as the admin's minified build ships it: the Tailwind CLI's
 * lightningcss prints the `::before`/`::after` selectors with one colon and
 * the `::marker` selector as a rule of its own.
 */
const MINIFIED_SHIELD =
  `:where(.nextly-admin)${WEIGHTED},:where(.nextly-admin) ${WEIGHTED},` +
  `:where(.nextly-admin) ${WEIGHTED}:before,:where(.nextly-admin) ${WEIGHTED}:after,` +
  `:where(.nextly-admin) ${WEIGHTED}::placeholder{all:revert-layer}` +
  `:where(.nextly-admin) ${WEIGHTED}::marker{all:revert-layer}`;

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

  it("adds the shield that reverts a host's element rules inside the admin", () => {
    const out = isolateAdminStylesheet(SHEET);

    // The control: the sheet before isolation has no shield, so the check
    // below can tell a sheet with one from a sheet without.
    expect(hasHostElementShield(SHEET)).toBe(false);
    expect(hasHostElementShield(out)).toBe(true);
    // Unlayered: outside every `@layer` block, after the last of them closes.
    const shield = out.slice(out.lastIndexOf("}\n", out.indexOf("all:")));
    expect(shield).not.toContain("@layer");
    expect(out.trimEnd().endsWith("all: revert-layer;\n}")).toBe(true);
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

describe("hasHostElementShield", () => {
  it("finds the shield in the minified form the admin's build ships", () => {
    expect(
      hasHostElementShield(`.nextly-admin .a{color:red}${MINIFIED_SHIELD}`)
    ).toBe(true);
  });

  it("refuses a shield a minifier simplified to the universal selector", () => {
    // The rule kept, its weight gone: (0,0,0) loses to a host's `h2` (0,0,1).
    const unweighted = MINIFIED_SHIELD.replaceAll(WEIGHTED, "*");

    expect(unweighted).toContain("{all:revert-layer}");
    expect(hasHostElementShield(unweighted)).toBe(false);
  });

  it("refuses a shield missing one of its selectors", () => {
    const withoutMarker = MINIFIED_SHIELD.replace(
      `:where(.nextly-admin) ${WEIGHTED}::marker{all:revert-layer}`,
      ""
    );

    expect(hasHostElementShield(withoutMarker)).toBe(false);
  });

  it("refuses the selectors when they revert nothing", () => {
    const otherDeclaration = MINIFIED_SHIELD.replaceAll(
      "all:revert-layer",
      "all:revert"
    );

    expect(hasHostElementShield(otherDeclaration)).toBe(false);
  });
});
