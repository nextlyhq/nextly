/**
 * The generated map holds itself to its strings-only list, so the two files
 * cannot disagree unnoticed even when one is edited by hand: the server check
 * reads only the list, and only the map knows what it registers.
 *
 * - At build: a disagreeing pair fails to compile, with a readable message.
 *   `next build` type-checks, so a production build stops there.
 * - At load: the same comparison throws, with a stable code, for `next dev`,
 *   which does not type-check.
 *
 * Both are proved on the generated text itself: compiled by the TypeScript
 * command line in a directory of its own, and run with its imports stubbed.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";

import { compile } from "../../../../../scripts/tsc-cli.mjs";

import type { PluginDefinition } from "../plugin-context";

import {
  buildComponentImportMap,
  buildComponentPathsModule,
  COMPONENT_MAP_MISMATCH_MESSAGE,
} from "./component-import-map";

const shop = {
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    admin: {
      pages: [
        { path: "a", component: "@acme/shop/admin#A" },
        { path: "b", component: "@acme/shop/admin#B" },
      ],
    },
  },
} as unknown as PluginDefinition;

const MAP = "plugin-admin-imports.generated.ts";
const LIST = "plugin-admin-components.generated.ts";
const STUBS = "stubs.d.ts";
const STUB_SOURCE = `
declare module "@nextlyhq/admin" {
  export function registerComponents(map: Record<string, unknown>): void;
}
declare module "@acme/shop/admin" {
  export const A: unknown;
  export const B: unknown;
}
`;

/**
 * The errors TypeScript reports on the pair, as their message text: the three
 * files and a config are written to a directory of their own and checked by
 * the compiler's command line, which answers the same on every TypeScript
 * version. Errors in anything else the program reads are not the pair's.
 */
function compileErrors(map: string, list: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "component-map-"));
  try {
    const files = { [MAP]: map, [LIST]: list, [STUBS]: STUB_SOURCE };
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          skipLibCheck: true,
          types: [],
        },
        files: Object.keys(files),
      })
    );
    return compile(["-p", "tsconfig.json"], dir)
      .filter(diagnostic => diagnostic.file && diagnostic.file in files)
      .map(diagnostic => diagnostic.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the map as the admin's bundle would, its imports stubbed. */
function load(
  map: string,
  listed: readonly string[],
  registerComponents = vi.fn()
) {
  const modules: Record<string, unknown> = {
    "@nextlyhq/admin": { registerComponents },
    "@acme/shop/admin": { A: "A", B: "B" },
    "./plugin-admin-components.generated": {
      registeredComponentPaths: listed,
    },
  };
  // Its types stripped and its imports made `require` calls, as a bundler
  // would before running it.
  const { code } = transformSync(map, {
    loader: "ts",
    format: "cjs",
    target: "es2022",
  });
  const run = new Function("require", "module", "exports", code);
  const module = { exports: {} };
  run((name: string) => modules[name], module, module.exports);
  return registerComponents;
}

const map = buildComponentImportMap([shop]);
const list = buildComponentPathsModule([shop]);

describe("the map and its list, written together", () => {
  it("compile, and load registering every listed component", () => {
    expect(compileErrors(map, list)).toEqual([]);
    const register = load(map, ["@acme/shop/admin#A", "@acme/shop/admin#B"]);
    expect(register).toHaveBeenCalledWith({
      "@acme/shop/admin#A": "A",
      "@acme/shop/admin#B": "B",
    });
  });
});

describe("a pair edited by hand", () => {
  // One path taken out of each side in turn: the list naming less than the
  // map registers, and the map registering less than the list names.
  const listMissingB = list.replace(',"@acme/shop/admin#B"', "");
  const mapMissingB = map.replace(/^ {2}"@acme\/shop\/admin#B".*\n/m, "");

  it("fails to compile, saying what to do, whichever side was edited", () => {
    expect(listMissingB).not.toBe(list);
    expect(mapMissingB).not.toBe(map);
    for (const [editedMap, editedList] of [
      [map, listMissingB],
      [mapMissingB, list],
    ]) {
      const errors = compileErrors(editedMap, editedList);
      expect(errors.join("\n")).toContain(COMPONENT_MAP_MISMATCH_MESSAGE);
    }
  });

  it("throws when the admin loads it, with a stable code, before registering anything", () => {
    const register = vi.fn();
    let thrown: unknown;
    try {
      load(mapMissingB, ["@acme/shop/admin#A", "@acme/shop/admin#B"], register);
    } catch (error) {
      thrown = error;
    }
    expect(register).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error & { code?: string }).code).toBe(
      "NEXTLY_ADMIN_COMPONENT_MAP_MISMATCH"
    );
    expect((thrown as Error).message).toContain(COMPONENT_MAP_MISMATCH_MESSAGE);
  });
});
