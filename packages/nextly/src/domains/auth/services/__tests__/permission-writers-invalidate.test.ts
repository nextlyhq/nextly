import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every method that changes a permission ROW must retire the answers copied
 * from it.
 *
 * A permission row belongs to no user and no role, so neither scoped
 * invalidation can express a change to one: `invalidatePermissionCache` takes a
 * `userId` or a `roleId` and a permission row has neither. A writer that
 * forgets therefore leaves a role-based key holding a renamed slug and a
 * super-admin's key holding a deleted grant for the rest of their cache TTL,
 * and nothing in the writer's own tests can see it.
 *
 * The writers are spread across services and nothing structural marks one, so
 * the rule is enforced here rather than left to be remembered.
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
/** The package's whole source tree. */
const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.test(-d)?\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

/**
 * Every file, rather than the ones a reader thought of.
 *
 * A list typed by hand is a population that agrees with whoever typed it. An
 * earlier form of this check named two services, so it reported a third as
 * compliant without ever opening it — the same failure it exists to catch, one
 * level up. Derived from the tree, a writer in a file nobody anticipated is
 * still in the population.
 */
const FILES = sourceFiles(SRC);

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

/**
 * EITHER invalidator, not one of them.
 *
 * A scoped `invalidatePermissionCache({ roleId })` is enough where the write is
 * additive and confined to one role — adding a permission a role grants changes
 * nothing any other caller has already been told — and it advances the revision
 * too, so derived caches retire with it. Demanding the table-wide form
 * everywhere would push a correct, cheaper call into an unfiltered rewrite of
 * the whole cache table.
 *
 * What the rule is really about is a writer that invalidates NOTHING, which is
 * what every instance found here has been.
 */
const INVALIDATORS = [
  "invalidateAllPermissionCaches",
  "invalidatePermissionCache",
];

/** Every function this body calls, by the text of the callee. */
function calleesOf(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      out.add(callee);
      // `this.foo(...)` names the same method as `foo` within one file.
      out.add(callee.replace(/^this\./, ""));
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

type Method = {
  where: string;
  file: string;
  mutates: boolean;
  callees: Set<string>;
};

function methodsOf(file: string): Method[] {
  const text = readFileSync(file, "utf-8");
  // Cheap reject before building a tree: the package has thousands of files and
  // only a handful mention this table at all.
  if (!text.includes("permissions")) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: Method[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.body) {
      out.push({
        where: `${relative(SRC, file)}:${node.name.getText()}`,
        file: relative(SRC, file),
        mutates: mutatesPermissions(node.body),
        callees: calleesOf(node.body),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * The methods that mutate a permission row, named rather than counted.
 *
 * A count agrees with itself while the selector drops the writer that matters
 * and picks up an unrelated one, so the set is pinned by identity: a new writer
 * fails here before it can fail the rule below, and removing one is a change
 * somebody has to make on purpose.
 */
const WRITERS = [
  "domains/auth/services/permission-seed-service.ts:cleanupOrphanedPermissions",
  "domains/auth/services/permission-seed-service.ts:deletePermissionsForResource",
  "domains/auth/services/permission-seed-service.ts:markOrphanedPermissions",
  "domains/auth/services/permission-seed-service.ts:normalizeReversedSlugs",
  "domains/auth/services/permission-seed-service.ts:returnPermissionToPresets",
  "domains/auth/services/permission-service.ts:ensurePermission",
  "domains/auth/services/permission-service.ts:removePermissionRow",
  "domains/auth/services/permission-service.ts:updatePermission",
  "domains/auth/services/role-permission-service.ts:addPermissionToRole",
  "domains/auth/services/role-permission-service.ts:healReversedSlug",
];

const methods = FILES.flatMap(methodsOf);

/**
 * The methods that retire the caches, directly or through one of their own
 * file's methods that does.
 *
 * A writer is allowed to delegate — four passes in the seeder share one
 * "did this write anything" helper rather than asking it four times — and a
 * check that only looked for a direct call would report every one of them as
 * invalidating nothing. Resolved as a fixed point over the file, so a helper
 * calling a helper counts too.
 *
 * Names are resolved WITHIN the file, which is where these helpers live. A call
 * into another module is not followed, so a writer that hides its invalidation
 * there reads here as having none — which fails in the direction that asks a
 * person to look.
 */
function invalidatingMethods(): Set<string> {
  const known = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of methods) {
      if (known.has(m.where)) continue;
      const reaches = [...m.callees].some(
        callee =>
          INVALIDATORS.includes(callee) || known.has(`${m.file}:${callee}`)
      );
      if (reaches) {
        known.add(m.where);
        changed = true;
      }
    }
  }
  return known;
}

const invalidates = invalidatingMethods();

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
    ).toEqual(WRITERS);
  });

  it("leaves none of them without an invalidation", () => {
    expect(
      methods
        .filter(m => m.mutates && !invalidates.has(m.where))
        .map(m => m.where)
        .sort()
    ).toEqual([]);
  });
});
