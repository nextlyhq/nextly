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

  it("refuses a name two `export *` provide, and lets a name of its own shadow one", () => {
    // Exported by neither under the language's rules when the two bindings
    // differ, and this reader does not trace bindings.
    const ambiguous = declarations({
      "index.d.ts": "export * from './a.js';\nexport * from './b.js';\n",
      "a.d.ts": "export declare const same: 1;\n",
      "b.d.ts": "export declare const same: 2;\n",
    });
    expect(() => exportedNames(ambiguous)).toThrow(
      /two `export \*` provide same/
    );
    // A name the file exports itself is never ambiguous: it wins.
    const shadowed = declarations({
      "own.d.ts":
        "export * from './a.js';\nexport * from './b.js';\nexport declare const same: 3;\n",
    });
    expect([...exportedNames(shadowed)]).toEqual(["same"]);
    // One module two stars both reach is one binding, read once.
    const shared = declarations({
      "top.d.ts": "export * from './left.js';\nexport * from './right.js';\n",
      "left.d.ts": "export * from './a.js';\n",
      "right.d.ts": "export * from './a.js';\n",
    });
    expect([...exportedNames(shared)]).toEqual(["same"]);
  });

  it("reads an exported import alias as the name it binds", () => {
    const entry = declarations({
      "index.d.ts":
        "declare namespace N { const x: number; }\nexport import Foo = N.x;\n",
    });
    expect([...exportedNames(entry)]).toEqual(["Foo"]);
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

  it("picks the declaration of the runtime extension's format, beside the others", () => {
    // A dual-format build writes all three; each runtime file has its own.
    declarations({
      "chunk.d.ts": "export {};\n",
      "chunk.d.mts": "export {};\n",
      "chunk.d.cts": "export {};\n",
    });
    const importer = join(dir, "index.d.ts");
    expect(declarationFor("./chunk.mjs", importer)).toBe(
      join(dir, "chunk.d.mts")
    );
    expect(declarationFor("./chunk.cjs", importer)).toBe(
      join(dir, "chunk.d.cts")
    );
    expect(declarationFor("./chunk.js", importer)).toBe(
      join(dir, "chunk.d.ts")
    );
  });

  it("refuses a runtime file whose own format has no declaration", () => {
    declarations({ "only.d.ts": "export {};\n" });
    expect(() =>
      declarationFor("./only.mjs", join(dir, "index.d.mts"))
    ).toThrow(/incomplete/);
  });
});
