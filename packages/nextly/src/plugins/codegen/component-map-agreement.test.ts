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
 * Both are proved on the generated text itself: compiled by TypeScript over
 * virtual files, and run with its imports stubbed.
 */
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

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

const MAP = "/app/plugin-admin-imports.generated.ts";
const LIST = "/app/plugin-admin-components.generated.ts";
const STUBS = "/app/stubs.d.ts";
const STUB_SOURCE = `
declare module "@nextlyhq/admin" {
  export function registerComponents(map: Record<string, unknown>): void;
}
declare module "@acme/shop/admin" {
  export const A: unknown;
  export const B: unknown;
}
`;

/** The errors TypeScript reports on the pair, as their message text. */
function compileErrors(map: string, list: string): string[] {
  const files = new Map([
    [MAP, map],
    [LIST, list],
    [STUBS, STUB_SOURCE],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const realGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    files.has(name)
      ? ts.createSourceFile(name, files.get(name)!, version)
      : realGet(name, version);
  const realExists = host.fileExists.bind(host);
  host.fileExists = name => files.has(name) || realExists(name);
  const realRead = host.readFile.bind(host);
  host.readFile = name => files.get(name) ?? realRead(name);
  // Module resolution asks whether the importing file's directory exists
  // before it looks for the file, so the virtual one has to exist too, or
  // the map's import of its list resolves to nothing.
  const realDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = dir =>
    dir === "/app" || (realDirectoryExists?.(dir) ?? false);
  const program = ts.createProgram([MAP, LIST, STUBS], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      diagnostic => diagnostic.file && files.has(diagnostic.file.fileName)
    )
    .map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    );
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
  const { outputText } = ts.transpileModule(map, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const run = new Function("require", "exports", outputText);
  run((name: string) => modules[name], {});
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
