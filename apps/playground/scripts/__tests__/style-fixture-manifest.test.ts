/**
 * `contributes.admin.styles` declares a stylesheet; the admin entry's
 * side-effect import is what actually loads it. Nothing at runtime reconciles
 * the two, so a plugin can declare one file and import another (or forget the
 * import entirely) and simply render unstyled — no error, in the host app or
 * here.
 *
 * This fixture is the first-party example plugin authors copy, so the two
 * statements are asserted to agree, and the declared file is asserted to exist
 * and to be the scoped, precompiled artifact the contract calls for.
 *
 * It sits with the other harness checks rather than beside the fixture because
 * the playground app itself is not unit-tested at that layer.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkAdminStyles } from "@nextlyhq/admin-css";
import { describe, expect, it } from "vitest";

import { styleFixturePlugin } from "../../src/plugins/style-fixture/plugin";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/plugins/style-fixture"
);

/** The single stylesheet this fixture declares. */
function declaredStylesheet(): string {
  const declared = styleFixturePlugin.contributes?.admin?.styles;
  expect(declared, "the fixture must declare admin.styles").toBeTruthy();
  return Array.isArray(declared) ? declared[0] : (declared as string);
}

describe("style-fixture admin.styles", () => {
  it("declares the file the admin entry actually imports", () => {
    const entry = readFileSync(resolve(FIXTURE, "admin.tsx"), "utf8");
    const sideEffectImports = [
      ...entry.matchAll(/^import\s+"([^"]+\.css)";/gm),
    ].map(m => m[1]);

    // The declaration is package-relative; the import is module-relative. Both
    // must name the same file, which is the part nothing else checks.
    const declaredFile = declaredStylesheet().split("/").pop();
    const importedFiles = sideEffectImports.map(p => p.split("/").pop());

    expect(
      importedFiles,
      `admin.tsx imports ${importedFiles.join(", ") || "no stylesheet"} but ` +
        `the manifest declares ${declaredStylesheet()}`
    ).toContain(declaredFile);
  });

  it("declares a file that exists", () => {
    const file = declaredStylesheet().split("/").pop() as string;
    expect(existsSync(resolve(FIXTURE, file))).toBe(true);
  });

  it("declares a scoped, token-driven artifact rather than raw source", () => {
    const file = declaredStylesheet().split("/").pop() as string;
    const css = readFileSync(resolve(FIXTURE, file), "utf8");

    // The same validator nextly-build-admin-css gates on, rather than a
    // substring check: one `.nextly-admin` rule alongside an unscoped rule or a
    // hardcoded color would satisfy the latter while breaking both invariants
    // this fixture exists to demonstrate.
    const issues = checkAdminStyles({ css });
    expect(
      issues.map(i => i.message),
      "the fixture stylesheet must pass the admin.styles validator"
    ).toEqual([]);

    // And that it is compiled output, not the Tailwind source it was built from.
    expect(css).not.toMatch(/@import\s+["']tailwindcss["']/);
  });
});
