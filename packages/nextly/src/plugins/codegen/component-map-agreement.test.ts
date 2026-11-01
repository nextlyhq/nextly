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
  return compileErrorsWith(map, list, STUB_SOURCE);
}

/** {@link compileErrors}, with the declarations the map's imports resolve to. */
function compileErrorsWith(map: string, list: string, stubs: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "component-map-"));
  try {
    const files = { [MAP]: map, [LIST]: list, [STUBS]: stubs };
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

/*
 * A site whose plugins contribute blocks: the map hands each declared editor
 * entry, and each declared block inspector, to the page builder, and the entry
 * is listed beside the components so the same agreement holds for it.
 */
const blocks = {
  name: "@acme/blocks",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    declarations: {
      "@nextlyhq/plugin-page-builder": {
        blocks: [
          {
            name: "acme/hero",
            editor: { component: "@acme/blocks/editor#Hero" },
          },
        ],
        editorEntry: "@acme/blocks/editor#editorBlocks",
      },
    },
  },
} as unknown as PluginDefinition;
const pageBuilder = {
  name: "@nextlyhq/plugin-page-builder",
  version: "1.0.0",
  nextly: "*",
} as unknown as PluginDefinition;

const BLOCK_STUBS = `
declare module "@nextlyhq/admin" {
  export function registerComponents(map: Record<string, unknown>): void;
}
declare module "@nextlyhq/plugin-page-builder/admin" {
  export function registerBlockEditorModules(modules: {
    entries?: Record<string, unknown>;
    components?: Record<string, unknown>;
  }): void;
}
declare module "@acme/blocks/editor" {
  export const Hero: unknown;
  export const editorBlocks: unknown;
}
`;

describe("a map handing block modules to the page builder", () => {
  const blockMap = buildComponentImportMap([pageBuilder, blocks]);
  const blockList = buildComponentPathsModule([pageBuilder, blocks]);

  /** Runs the map with both registrars stubbed. */
  function loadBlocks(map: string, listed: readonly string[]) {
    const registerComponents = vi.fn();
    const registerBlockEditorModules = vi.fn();
    const modules: Record<string, unknown> = {
      "@nextlyhq/admin": { registerComponents },
      "@nextlyhq/plugin-page-builder/admin": { registerBlockEditorModules },
      "@acme/blocks/editor": { Hero: "Hero", editorBlocks: "editorBlocks" },
      "./plugin-admin-components.generated": {
        registeredComponentPaths: listed,
      },
    };
    const { code } = transformSync(map, {
      loader: "ts",
      format: "cjs",
      target: "es2022",
    });
    const run = new Function("require", "module", "exports", code);
    const module = { exports: {} };
    run((name: string) => modules[name], module, module.exports);
    return { registerComponents, registerBlockEditorModules };
  }

  it("lists the entry, compiles, and hands the entry and the inspector over", () => {
    expect(blockList).toContain('"@acme/blocks/editor#editorBlocks"');
    expect(compileErrorsWith(blockMap, blockList, BLOCK_STUBS)).toEqual([]);

    const { registerComponents, registerBlockEditorModules } = loadBlocks(
      blockMap,
      ["@acme/blocks/editor#Hero", "@acme/blocks/editor#editorBlocks"]
    );
    // The entry exports definitions, not a component, so the component
    // registry never receives it.
    expect(registerComponents).toHaveBeenCalledWith({
      "@acme/blocks/editor#Hero": "Hero",
    });
    expect(registerBlockEditorModules).toHaveBeenCalledWith({
      entries: { "@acme/blocks/editor#editorBlocks": "editorBlocks" },
      components: { "@acme/blocks/editor#Hero": "Hero" },
    });
  });

  it("holds the entry to the list, at build and at load", () => {
    const listMissingEntry = blockList.replace(
      '"@acme/blocks/editor#editorBlocks",',
      ""
    );
    expect(listMissingEntry).not.toBe(blockList);
    expect(
      compileErrorsWith(blockMap, listMissingEntry, BLOCK_STUBS).join("\n")
    ).toContain(COMPONENT_MAP_MISMATCH_MESSAGE);
    expect(() => loadBlocks(blockMap, ["@acme/blocks/editor#Hero"])).toThrow(
      COMPONENT_MAP_MISMATCH_MESSAGE
    );
  });
});
