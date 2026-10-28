/**
 * What keeps a heavy dependency where a published build is meant to keep it. Each case builds a
 * small package in a temporary directory: an entry, the chunks it loads, and the declarations it
 * publishes, with the dependency imported, bundled in, or absent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BOUNDARIES, boundaryProblems, eagerChunks, chunkGraph, publishedEntries, specifiersOf } from "./check-bundle-boundaries.mjs";

const ENGINE = { name: "engine", packageDir: "pkg", specifier: "engine", marker: "engine-wrapper", declarationDirs: ["pkg/dist"] };

let base;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "bundle-boundaries-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Writes a package at `pkg` with the given dist files and an export map naming `index.mjs`. */
function pkg(files) {
  const write = (path, text) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  write("pkg/package.json", JSON.stringify({ exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" } } }));
  for (const [path, text] of Object.entries(files)) write(`pkg/dist/${path}`, text);
}

const CLEAN_TYPES = { "index.d.ts": "export declare function Chart(): unknown;\n" };

describe("the chunks an entry loads before it renders", () => {
  it("follows static imports and stops at a dynamic one", () => {
    pkg({
      "index.mjs": 'import "./shared.mjs"; export const load = () => import("./view.mjs");',
      "shared.mjs": 'export * from "./deep.mjs";',
      "deep.mjs": "export const deep = 1;",
      "view.mjs": 'import "./view-only.mjs";',
      "view-only.mjs": "",
    });
    const graph = chunkGraph(join(base, "pkg/dist"));
    expect([...eagerChunks(graph, ["index.mjs"])].sort()).toEqual(["deep.mjs", "index.mjs", "shared.mjs"]);
  });

  it("throws on a static import of a chunk the dist does not hold, rather than reading less", () => {
    pkg({ "index.mjs": 'import "./gone.mjs";' });
    expect(() => eagerChunks(chunkGraph(join(base, "pkg/dist")), ["index.mjs"])).toThrow(/gone\.mjs/);
  });

  it("takes each entry from the export map, at any depth of conditions, and no declaration file", () => {
    expect(
      publishedEntries({
        ".": { types: "./dist/index.d.ts", import: "./dist/index.mjs" },
        "./lib/a": { node: { import: "./dist/lib/a.mjs" } },
        "./style.css": "./dist/styles/globals.css",
      })
    ).toEqual(["index.mjs", "lib/a.mjs"]);
  });
});

describe("a boundary", () => {
  it("holds when the dependency is imported only by a chunk a view loads lazily", () => {
    pkg({ "index.mjs": 'export const load = () => import("./chart.mjs");', "chart.mjs": 'import { X } from "engine"; export { X };', ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([]);
  });

  it("holds when the dependency is bundled into a lazy chunk, found by its marker", () => {
    pkg({ "index.mjs": 'export const load = () => import("./chart.mjs");', "chart.mjs": 'const c = "engine-wrapper";', ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([]);
  });

  it("fails when an entry statically reaches a chunk that imports the dependency", () => {
    pkg({ "index.mjs": 'import "./shared.mjs";', "shared.mjs": 'import "engine/sub";', ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([expect.stringMatching(/^dist\/shared\.mjs carries the engine/)]);
  });

  it("fails when the entry itself holds the bundled dependency", () => {
    pkg({ "index.mjs": 'const c = "engine-wrapper";', ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([expect.stringMatching(/^dist\/index\.mjs carries the engine/)]);
  });

  /* A check that only looked for the dependency in eager chunks would pass here and prove nothing. */
  it("fails when no chunk carries the dependency at all", () => {
    pkg({ "index.mjs": 'export const load = () => import("./chart.mjs");', "chart.mjs": "", ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([expect.stringMatching(/no chunk of pkg\/dist carries the engine/)]);
  });

  it("does not take a string that only mentions the specifier for an import of it", () => {
    pkg({ "index.mjs": 'const label = "engine"; export const load = () => import("./chart.mjs");', "chart.mjs": 'import "engine";', ...CLEAN_TYPES });
    expect(boundaryProblems(ENGINE, base)).toEqual([]);
  });

  it.each([
    ["an import", 'import type { Props } from "engine";\nexport declare const p: Props;\n'],
    ["a re-export", 'export { type Props } from "engine/types";\n'],
    ["an import type", 'export declare const p: import("engine").Props;\n'],
  ])("fails when a published declaration names the dependency through %s", (_, declaration) => {
    pkg({ "index.mjs": 'export const load = () => import("./chart.mjs");', "chart.mjs": 'import "engine";', "index.d.ts": declaration });
    expect(boundaryProblems(ENGINE, base)).toEqual([expect.stringMatching(/index\.d\.ts names engine/)]);
  });

  it("fails on an unbuilt package rather than finding nothing wrong", () => {
    pkg({});
    expect(boundaryProblems(ENGINE, base)).toEqual([expect.stringMatching(/is not built/)]);
  });

  it("reads a declaration's import type form as a specifier", () => {
    expect([...specifiersOf('export declare const p: import("engine").Props;', "x.d.ts")]).toEqual(["engine"]);
  });

  it("keeps the chart engine out of the admin's eager chunks and out of the admin's and the plugin SDK's types", () => {
    expect(BOUNDARIES).toContainEqual(
      expect.objectContaining({ packageDir: "packages/admin", specifier: "recharts", declarationDirs: ["packages/admin/dist", "packages/plugin-sdk/dist"] })
    );
  });
});
