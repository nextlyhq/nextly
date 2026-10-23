// Nothing in the repository loads the TypeScript compiler as a library.
//
// TypeScript 7 publishes no programmatic API before 7.1. Its package's root
// export holds only the version, so `import ts from "typescript"` still
// loads, `ts.createProgram` is undefined, and the code fails only where that
// line runs. The `typescript/unstable/*` entries may change in any release.
// The compiler is used through its command line (`scripts/tsc-cli.mjs`) and its
// language server (`scripts/language-server.mjs`) instead.
//
// Read from each module's parse rather than its text, so a mention in a
// comment or a string is not a load, and a load spelled across lines is one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** The compiler's package, or any entry inside it. */
const COMPILER = /^typescript(?:\/|$)/;

/** Where each kind of node names the module it loads, if it loads one. */
const SPECIFIER_OF = {
  ImportDeclaration: node => node.source,
  ExportNamedDeclaration: node => node.source,
  ExportAllDeclaration: node => node.source,
  ImportExpression: node => node.source,
  TSImportType: node => node.source,
  TSExternalModuleReference: node => node.expression,
  CallExpression: node =>
    node.callee.type === "Identifier" && node.callee.name === "require"
      ? node.arguments[0]
      : undefined,
};

/** `"<line>: <specifier>"` for each load of the compiler `source` makes. */
export function compilerLoadsIn(source, fileName) {
  const loads = [];
  walk(parseSource(source, fileName).program, node => {
    const specifier = literalText(SPECIFIER_OF[node.type]?.(node));
    if (specifier !== null && COMPILER.test(specifier)) {
      const line = source.slice(0, node.start).split("\n").length;
      loads.push(`${String(line)}: ${specifier}`);
    }
  });
  return loads;
}

/**
 * The tracked modules whose text mentions the compiler's name. A load names
 * its module in a string the parse reads, so every module that loads the
 * compiler is among these; the rest cannot, and are not parsed.
 */
function mentioningModules() {
  let listed = "";
  try {
    listed = execFileSync(
      "git",
      [
        "grep",
        "-l",
        "-z",
        "typescript",
        "--",
        ...["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"].map(
          extension => `*.${extension}`
        ),
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
  } catch (error) {
    // `git grep` exits 1 for no match, which is an answer; anything else is not.
    if (error.status !== 1) throw error;
  }
  return listed.split("\0").filter(Boolean);
}

describe("the TypeScript compiler as a library", () => {
  it("is loaded by no tracked module", () => {
    const files = mentioningModules();
    // The scan reaches the repository: the command-line helper names the
    // compiler's package, so it is among what is read.
    expect(files).toContain("scripts/tsc-cli.mjs");
    const loads = files.flatMap(file =>
      compilerLoadsIn(readFileSync(join(ROOT, file), "utf8"), file).map(
        load => `${file}:${load}`
      )
    );
    expect(loads).toEqual([]);
  });

  it("reads every way a module can load it, and nothing that only mentions it", () => {
    const source = [
      'import ts from "typescript";',
      'import type { Node } from "typescript";',
      'export { version } from "typescript";',
      'export * from "typescript/unstable/ast";',
      'const later = import("typescript");',
      'const required = require("typescript");',
      'type Program = import("typescript").Program;',
      'import api = require("typescript");',
      "const tagged = await import(`typescript`);",
      '// import ts from "typescript";',
      'const said = "typescript";',
      'import other from "typescript-eslint";',
    ].join("\n");
    expect(compilerLoadsIn(source, "probe.ts")).toEqual([
      "1: typescript",
      "2: typescript",
      "3: typescript",
      "4: typescript/unstable/ast",
      "5: typescript",
      "6: typescript",
      "7: typescript",
      "8: typescript",
      "9: typescript",
    ]);
  });
});
