import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The epoch answers two questions, and each has exactly one place it is asked.
 *
 * Both guards here exist because the same mistake was made twice in the same
 * change, in a shape no test could see: a value declared as the single source
 * of something, and then not actually used as one.
 *
 * The first is "is this stamp still current". Three tiers asked it — the
 * in-memory caches, the shared tier's write gate, and the API key's copied
 * grants — and two of them compared the stamp without asking whether the epoch
 * was worth comparing against. Those two look identical to the correct one at a
 * glance, and the difference only shows on an install whose epoch table is not
 * yet reconciled, where the stamp being matched is one this process invented
 * and no other instance has ever seen.
 *
 * The second is what the table is called. Five places spelled it, and the
 * constant documented as the single spelling was read by none of them, so a
 * rename could move the manifest and the DDL while leaving the runtime queries
 * pointed at the old name — two tables, no error, and every cache in the
 * install answering from a counter nothing bumps.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where each answer is allowed to be authored. */
const EPOCH_MODULE = join("services", "lib", "rbac-epoch.ts");
const TABLE_NAME_MODULE = join("schemas", "rbac-epoch", "table-name.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(test|integration\.test)(-d)?\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

const FILES = sourceFiles(SRC);

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
}

/** Is this expression a call to `currentEpoch()`? */
function isCurrentEpochCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "currentEpoch"
  );
}

/** Every `x === currentEpoch()` (or `!==`, either way round) in one file. */
function stampComparisons(source: ts.SourceFile): number[] {
  const found: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind ===
          ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
      (isCurrentEpochCall(node.left) || isCurrentEpochCall(node.right))
    ) {
      found.push(source.getLineAndCharacterOfPosition(node.pos).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("whether a stamp is current is asked in one place", () => {
  it("is not compared against `currentEpoch()` anywhere else", () => {
    // A comparison written out again is a second answer to the question
    // `stampIsCurrent` exists to give, and the half it drops is the trust
    // check — which is invisible until the epoch table is missing.
    const offenders = FILES.flatMap(file => {
      const where = relative(SRC, file);
      if (where === EPOCH_MODULE) return [];
      return stampComparisons(parse(file)).map(
        line => `${where.split(sep).join("/")}:${line}`
      );
    });

    expect(offenders).toEqual([]);
  });

  it("finds one when there is one, so the case above is not vacuous", () => {
    // The control. An AST walk that matches nothing — a renamed function, a
    // visitor that never descends, a file list that resolved to an empty
    // directory — satisfies the assertion above perfectly.
    const written = ts.createSourceFile(
      "probe.ts",
      "const ok = entry.epoch === currentEpoch();\n" +
        "const no = currentEpoch() !== other;\n",
      ts.ScriptTarget.Latest,
      true
    );

    expect(stampComparisons(written)).toHaveLength(2);
  });

  it("reads a population, so an empty file list cannot pass it", () => {
    // The other half of the control: the assertion above is equally satisfied
    // by having read nothing at all.
    expect(FILES.length).toBeGreaterThan(500);
    expect(FILES.some(f => relative(SRC, f) === EPOCH_MODULE)).toBe(true);
  });
});

describe("the epoch table is named in one place", () => {
  it("is spelled literally nowhere but the module that declares it", () => {
    const offenders = FILES.filter(
      file =>
        relative(SRC, file) !== TABLE_NAME_MODULE &&
        readFileSync(file, "utf8").includes('"nextly_rbac_epoch"')
    ).map(file => relative(SRC, file).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("is spelled once where it IS declared, so the search can find it", () => {
    // The control. Searching for a string that occurs nowhere at all reports
    // the same clean result as a name that is genuinely centralised.
    const declaring = FILES.filter(
      file => relative(SRC, file) === TABLE_NAME_MODULE
    );

    expect(declaring).toHaveLength(1);
    expect(readFileSync(declaring[0], "utf8")).toContain('"nextly_rbac_epoch"');
  });
});
