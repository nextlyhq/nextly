/**
 * Asserts that the package's own documentation stays true to what it ships:
 * every design token it names exists in `theme.css`, and it never shows an
 * import from an entry point that does not export that symbol.
 *
 * Docs are the contract external plugin authors build against, and both failure
 * modes are silent. A token that does not exist resolves to nothing, so a stale
 * name renders unstyled UI with no error anywhere; an import from the wrong
 * entry point only surfaces once someone follows the instructions.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = resolve(HERE, "../theme.css");

/** Every doc that documents the package's public surface. */
const DOCS = {
  "plugin-ui-authoring.md": resolve(
    HERE,
    "../../../docs/plugin-ui-authoring.md"
  ),
  "README.md": resolve(HERE, "../../../README.md"),
} as const;

const theme = readFileSync(THEME, "utf8");

/** Custom properties the theme actually declares, e.g. `--nx-card`. */
const declared = new Set(
  [...theme.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1])
);

/**
 * Token names a doc tells authors to use. Wildcard stubs (`--nx-sidebar-*`
 * written as prose) and the generic `--token` placeholder are not real names.
 */
function tokensIn(source: string): string[] {
  return [
    ...new Set([...source.matchAll(/--[a-z0-9-]+/g)].map(match => match[0])),
  ].filter(token => !token.endsWith("-") && token !== "--token");
}

/** Exports that deliberately do not live on the client-stamped root barrel. */
const SUBPATH_ONLY = [
  { name: "cn", subpath: "@nextlyhq/ui/utils" },
  { name: "uiPreset", subpath: "@nextlyhq/ui/tailwind-preset" },
];

describe.each(Object.entries(DOCS))("%s", (_name, path) => {
  const doc = readFileSync(path, "utf8");

  it("references only tokens that theme.css declares", () => {
    const missing = tokensIn(doc).filter(token => !declared.has(token));

    expect(
      missing,
      `Documented but not declared in theme.css, so CSS using them silently ` +
        `resolves to nothing: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it.each(SUBPATH_ONLY)(
    "does not show $name being imported from the root barrel",
    ({ name, subpath }) => {
      // e.g. `import { cn } from "@nextlyhq/ui"` — the root is published with
      // "use client" and no longer exports these, so following that fails.
      const rootImport = new RegExp(
        `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']@nextlyhq/ui["']`
      );

      expect(
        rootImport.test(doc),
        `${name} must be documented as coming from ${subpath}, not the root.`
      ).toBe(false);
    }
  );
});

describe("plugin authoring guide", () => {
  const doc = readFileSync(DOCS["plugin-ui-authoring.md"], "utf8");

  it("documents the scope class the admin actually renders", () => {
    // The admin root renders `.nextly-admin`, and the admin stylesheet is
    // scoped to it; any other class leaves plugin CSS inert.
    expect(doc).toContain(".nextly-admin");
    expect(doc).not.toContain("adminapp");
  });

  it("names at least one real token, so the check cannot pass vacuously", () => {
    const tokens = tokensIn(doc);
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens).toContain("--nx-primary");
  });
});
