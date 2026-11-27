/**
 * The CLI's error catalogue, which every command loads before its work, loads
 * no database code.
 *
 * A command imports the catalogue to print its failure, so whatever the
 * catalogue imports, every command pays for at start-up. Each area of it names
 * the reasons and advice the code it speaks for gives, and those names live in
 * modules of their own that import nothing heavy: naming one from the module
 * that throws it once brought drizzle's three dialects into every command.
 *
 * What would separate a light catalogue from a heavy one:
 * - an area that imports a module of the schema pipeline for a name, however
 *   many modules away the database code is;
 * - a package of any kind beyond the one that colours the output, named here
 *   so that adding one is a decision;
 * - a walk that reads nothing, which the controls below would show.
 */
import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { inputName, runtimeImportsOf } from "./helpers/runtime-imports";

/** The packages `entry` loads, each with the modules that lead to it. */
async function packagesOf(entry: string): Promise<Record<string, string>> {
  const { packages } = await runtimeImportsOf(entry);
  return Object.fromEntries(
    [...packages].map(([name, chain]) => [name, chain.join(" > ")])
  );
}

const DIALECT_CORES = [
  "drizzle-orm/mysql-core",
  "drizzle-orm/pg-core",
  "drizzle-orm/sqlite-core",
];

describe("what the CLI's error catalogue loads", () => {
  it("is its own words and the package that colours them", async () => {
    const packages = await packagesOf("cli/errors/index.ts");
    expect(Object.keys(packages), JSON.stringify(packages, null, 2)).toEqual([
      "picocolors",
    ]);
  });

  it("covers every area of the catalogue", async () => {
    const { modules } = await runtimeImportsOf("cli/errors/index.ts");
    const areas = readdirSync(new URL("../errors/areas/", import.meta.url))
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => `cli/errors/areas/${name}`);
    expect(areas).toContain("cli/errors/areas/migrations.ts");
    expect(areas.filter(area => !modules.includes(area))).toEqual([]);
  });
});

describe("the walk of what a module loads", () => {
  it("names a module as esbuild does, whatever the platform's separator", () => {
    expect(inputName("cli\\errors\\index.ts", "\\")).toBe(
      "cli/errors/index.ts"
    );
    expect(inputName("cli/errors/index.ts", "/")).toBe("cli/errors/index.ts");
  });

  it("finds the dialects, in the module itself and in one it imports", async () => {
    // The core schema names them only through the conversion it imports.
    for (const entry of [
      "schemas/_internal/drizzle-to-tablespec.ts",
      "schemas/core-schema.ts",
    ]) {
      const packages = Object.keys(await packagesOf(entry));
      expect(packages, entry).toEqual(expect.arrayContaining(DIALECT_CORES));
    }
  });

  it("leaves out what is imported only when its code runs", async () => {
    // The adapter's module imports the factory, and through it the resolver
    // above, inside the function that connects.
    const { modules } = await runtimeImportsOf("cli/utils/adapter.ts");
    expect(modules).toContain("cli/environment.ts");
    expect(modules).not.toContain("cli/utils/registry-resolver.ts");
  });
});
