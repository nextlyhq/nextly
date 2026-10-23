/**
 * What a built declaration publishes, read from its export statements. Each
 * case is a form the bundler emits or one the reader must refuse: a form it
 * misses reports a name as absent, and a form it skips silently reports a
 * shorter list, both of which read as a clean answer.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  declarationFor,
  exportStatements,
  exportedNames,
} from "./declaration-exports.mjs";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "declaration-exports-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes declaration files into the scratch directory; returns the first's path. */
function declarations(files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return join(dir, Object.keys(files)[0] ?? "");
}

describe("exportedNames", () => {
  it("reads every export form the bundler emits", () => {
    // The alias form is why this is a parser: `export { a as BlockRenderArgs }`
    // exports the RIGHT-hand name, and the left is a generated letter.
    const entry = declarations({
      "index.d.ts":
        "export { a as BlockRenderArgs, type b as NodeStyles };\n" +
        "export type { PageStyles } from './styles.js';\n" +
        "export interface DerivedPageSeo {}\n" +
        "export declare function createBlocksPage(): void;\n" +
        "export declare const a: number, b: string;\n" +
        "export declare class Store {}\n" +
        "export declare enum Mode { A }\n" +
        "export type Alias = string;\n" +
        "export declare namespace Ns { const x: number; }\n",
    });
    expect([...exportedNames(entry)]).toEqual([
      "BlockRenderArgs",
      "NodeStyles",
      "PageStyles",
      "DerivedPageSeo",
      "createBlocksPage",
      "a",
      "b",
      "Store",
      "Mode",
      "Alias",
      "Ns",
    ]);
  });

  it("does not count a name that is only mentioned", () => {
    const entry = declarations({
      "index.d.ts": "interface BlockDocument {}\n",
    });
    expect([...exportedNames(entry)]).toEqual([]);
  });

  it("follows each `export *` hop, without the default it never carries", () => {
    const entry = declarations({
      "index.d.ts":
        "export * from './a.js';\nexport * as helpers from './c.js';\n",
      "a.d.ts": "export * from './b.js';\nexport declare const fromA: 1;\n",
      "b.d.ts": "export declare const fromB: 1;\nexport default fromB;\n",
      "c.d.ts": "export declare const inC: 1;\n",
    });
    expect([...exportedNames(entry)].sort()).toEqual(
      ["fromA", "fromB", "helpers"].sort()
    );
  });

  it("refuses an `export *` it cannot follow, rather than reading a shorter list", () => {
    const fromPackage = declarations({
      "index.d.ts": "export * from 'another-package';\n",
    });
    expect(() => exportedNames(fromPackage)).toThrow(/another package/);
    const missing = declarations({
      "gone.d.ts": "export * from './chunk.js';\n",
    });
    expect(() => exportedNames(missing)).toThrow(/incomplete/);
  });

  it("refuses an export form it does not read", () => {
    const assignment = declarations({
      "index.d.ts": "declare const a: number;\nexport = a;\n",
    });
    expect(() => exportStatements(assignment)).toThrow(/TSExportAssignment/);
  });
});

describe("declarationFor", () => {
  it("finds the declaration a runtime specifier stands for", () => {
    declarations({ "chunk.d.mts": "export {};\n" });
    expect(declarationFor("./chunk.mjs", join(dir, "index.d.mts"))).toBe(
      join(dir, "chunk.d.mts")
    );
  });
});
