import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every method that changes a permission ROW must retire the answers copied
 * from it.
 *
 * A permission row belongs to no user and no role, so neither scoped
 * invalidation can express a change to one, and for a long time nothing did:
 * `PermissionService`'s update and both deletes called nothing at all. Review
 * found the writers one at a time, three and then three more, which is what a
 * rule with nothing enforcing it looks like.
 *
 * Read from the SYNTAX TREE rather than by matching source text. The first
 * version of this file found method bodies by counting braces from the
 * signature, and a signature containing an object type — `Promise<{ id: string
 * }>` — gave it the return type's brace, so the body it measured ended before
 * the method did. `ensurePermission` mutates the table twice and read as
 * compliant. A tree cannot have that failure; nesting is what it represents.
 *
 * The remaining limit is worth stating: this sees a mutation and a call in one
 * method body. It cannot follow a write made through a helper, and it cannot
 * tell a correctly placed call from one on a branch that never runs. What it
 * catches is the case that has happened twice — a new writer with no
 * invalidation anywhere near it.
 */
const SERVICES = dirname(fileURLToPath(import.meta.url)).replace(
  "__tests__",
  ""
);
const FILES = ["permission-service.ts", "permission-seed-service.ts"];

/** `x.insert|update|delete(<permissions table>)`, however the file names it. */
function mutatesPermissions(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ["insert", "update", "delete"].includes(n.expression.name.text) &&
      n.arguments.length === 1 &&
      /(^|\.)permissions$/.test(n.arguments[0].getText())
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function callsInvalidator(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText() === "invalidateAllPermissionCaches"
    ) {
      found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

type Method = { where: string; mutates: boolean; invalidates: boolean };

function methodsOf(file: string): Method[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(SERVICES, file), "utf-8"),
    ts.ScriptTarget.Latest,
    true
  );
  const out: Method[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.body) {
      out.push({
        where: `${file}:${node.name.getText()}`,
        mutates: mutatesPermissions(node.body),
        invalidates: callsInvalidator(node.body),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const methods = FILES.flatMap(methodsOf);

describe("a method that changes a permission row invalidates the caches", () => {
  it("reads the methods at all, so the rule below is not vacuous", () => {
    // The control. An absence check over a list that came back empty passes
    // perfectly, and this one reads a syntax tree it could stop matching.
    expect(methods.length).toBeGreaterThan(10);
  });

  it("names the writers, so the set cannot drift without being seen", () => {
    // Named rather than counted: a count agrees with itself while the selector
    // drops the writer that matters and picks up an unrelated one. This list
    // gained three entries the moment it was read off the tree instead of off
    // the text, which is the whole argument for pinning it.
    expect(
      methods
        .filter(m => m.mutates)
        .map(m => m.where)
        .sort()
    ).toEqual([
      "permission-seed-service.ts:cleanupOrphanedPermissions",
      "permission-seed-service.ts:deletePermissionsForResource",
      "permission-seed-service.ts:markOrphanedPermissions",
      "permission-seed-service.ts:normalizeReversedSlugs",
      "permission-seed-service.ts:returnPermissionToPresets",
      "permission-service.ts:deletePermission",
      "permission-service.ts:deletePermissionById",
      "permission-service.ts:ensurePermission",
      "permission-service.ts:updatePermission",
    ]);
  });

  it("leaves none of them without an invalidation", () => {
    expect(
      methods
        .filter(m => m.mutates && !m.invalidates)
        .map(m => m.where)
        .sort()
    ).toEqual([]);
  });
});
