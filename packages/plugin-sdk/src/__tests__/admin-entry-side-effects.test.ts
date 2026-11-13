/**
 * The SDK's admin entry is pure re-exports, and the package says so.
 *
 * A plugin's admin module imports a few parts from `@nextlyhq/plugin-sdk/admin`,
 * and the generated component map imports that module with the admin's first
 * load. The entry re-exports each name from the kit area that holds it
 * (`@nextlyhq/admin/kit/<area>`), and `package.json` leaves it out of
 * `sideEffects`, so an application's bundler follows only the areas a plugin
 * names: a plugin using the stepper does not bring the media library.
 *
 * Both halves are held here, against the built entry. A statement in it that
 * is not an import or a re-export would run code a bundler is told it may
 * skip; a re-export from the whole kit, or from the admin's root, would bring
 * every area again; and a built file `sideEffects` does not name would be
 * declared side-effect free by omission.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = join(PACKAGE, "dist");

/** A module's top-level statements, comments removed, split at each `;`. */
function statementsOf(code: string): string[] {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .split(";")
    .map(statement => statement.trim())
    .filter(Boolean);
}

/** Whether a statement only imports bindings or re-exports them. */
function importsOrReExports(statement: string): boolean {
  return (
    /^import\s*\{[^}]*\}\s*from\s*"[^"]+"$/.test(statement) ||
    /^export\s*\{[^}]*\}(\s*from\s*"[^"]+")?$/.test(statement)
  );
}

/** The specifiers a module imports or re-exports from. */
function specifiersOf(code: string): string[] {
  return [...code.matchAll(/\bfrom\s*"([^"]+)"/g)].map(match => match[1]);
}

/** Every built module of the package, relative to it, with `./`. */
function builtModules(dir = DIST): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? builtModules(join(dir, entry.name))
      : entry.name.endsWith(".mjs")
        ? [`./${relative(PACKAGE, join(dir, entry.name))}`]
        : []
  );
}

const admin = readFileSync(join(DIST, "admin.mjs"), "utf8");
const manifest = JSON.parse(
  readFileSync(join(PACKAGE, "package.json"), "utf8")
) as { sideEffects: string[] };

describe("@nextlyhq/plugin-sdk/admin", () => {
  it("holds nothing but imports and re-exports", () => {
    expect(statementsOf(admin).filter(s => !importsOrReExports(s))).toEqual([]);
  });

  it("CONTROL: a statement that runs code is told apart", () => {
    expect(
      statementsOf(
        'import { a } from "x";\nregister(a);\nexport { a };'
      ).filter(s => !importsOrReExports(s))
    ).toEqual(["register(a)"]);
  });

  it("takes the admin's parts from its kit areas, never the whole kit or the root", () => {
    const admins = specifiersOf(admin).filter(s =>
      s.startsWith("@nextlyhq/admin")
    );
    expect(admins.length).toBeGreaterThan(1);
    expect(
      admins.filter(s => !/^@nextlyhq\/admin\/kit\/[a-z-]+$/.test(s))
    ).toEqual([]);
  });

  it("is the one built module left out of sideEffects", () => {
    const matches = (file: string) =>
      manifest.sideEffects.some(pattern =>
        pattern.endsWith("/**")
          ? file.startsWith(pattern.slice(0, -2))
          : file === pattern
      );
    expect(builtModules().filter(file => !matches(file))).toEqual([
      "./dist/admin.mjs",
    ]);
  });
});
