import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every mutation of a permission ROW goes through `writingPermissions`.
 *
 * A permission row belongs to no user and no role, so neither scoped
 * invalidation can express a change to one: `invalidatePermissionCache` takes a
 * `userId` or a `roleId` and a permission row has neither. A write that retires
 * nothing therefore leaves a role-based key holding a renamed slug and a
 * super-admin's key holding a deleted grant for the rest of their cache TTL,
 * and nothing in the writer's own tests can see it.
 *
 * The gate makes the two acts one, so the rule here is about REACHING it rather
 * than about remembering to invalidate afterwards. That is what makes the
 * question answerable: "is this write inside the gate" is a property of the
 * write itself and holds however the surrounding code is written. Asking
 * instead whether the enclosing method also invalidates requires recognising
 * the method, so a writer in any shape the search does not model reads as
 * compliant.
 *
 * The population is every call in the package, so a write inside a plain
 * function, an arrow, a callback, a class this file has never heard of, or a
 * file nobody thought to list is judged the same way.
 *
 * Two limits are worth stating rather than leaving to look like coverage.
 * A write through raw SQL is not a call on a table object and is not seen
 * here — the `no-raw-sql` case below is what stands against that, and it is a
 * text search rather than a resolution. And a table reached from another module
 * through a name this file cannot follow is not seen either, which fails in the
 * direction that asks a person to look.
 */
/** The package's whole source tree. */
const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

/** The gate. A write inside it retires the caches by construction. */
const GATE = "writingPermissions";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures seed rows directly and answer to nobody's cache.
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !/\.(test|integration\.test)(-d)?\.ts$/.test(entry.name)
      ? [full]
      : [];
  });
}

/**
 * Every file, rather than the ones a reader thought of.
 *
 * A list typed by hand is a population that agrees with whoever typed it: a
 * service missing from it is reported as compliant without ever being opened,
 * which is the failure this exists to catch, one level up. Derived from the
 * tree, a write in a file nobody anticipated is still in the population.
 */
const FILES = sourceFiles(SRC);

/** Does this expression name the permissions table? */
function namesTable(text: string, aliases: ReadonlySet<string>): boolean {
  return /(^|\.)permissions$/.test(text) || aliases.has(text);
}

/**
 * Names bound to the table within one file.
 *
 * `const { permissions } = this.tables` is how every service reaches it, and a
 * plain `const p = this.tables.permissions` is the same table under a name the
 * pattern above cannot see. Resolved as a fixed point so a name bound from
 * another bound name counts too.
 */
function aliasesIn(source: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    const visit = (n: ts.Node): void => {
      const name = boundToTable(n, aliases) ?? gateParameter(n);
      if (name && !aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return aliases;
}

/** `const p = this.tables.permissions` — the name it binds, if it binds one. */
function boundToTable(n: ts.Node, aliases: ReadonlySet<string>): string | null {
  if (!ts.isVariableDeclaration(n) || !n.initializer) return null;
  if (!ts.isIdentifier(n.name)) return null;
  return namesTable(n.initializer.getText(), aliases) ? n.name.text : null;
}

/** The gate hands the table to its callback, so the parameter is the table. */
function gateParameter(n: ts.Node): string | null {
  if (!ts.isCallExpression(n)) return null;
  if (!n.expression.getText().endsWith(GATE)) return null;
  if (n.arguments.length !== 2) return null;
  const run = n.arguments[1];
  if (!ts.isArrowFunction(run) && !ts.isFunctionExpression(run)) return null;
  if (run.parameters.length !== 1) return null;
  const param = run.parameters[0].name;
  return ts.isIdentifier(param) ? param.text : null;
}

/** The mutating builder calls, named once. */
const WRITE_CALLS = ["insert", "update", "delete"];

/** Is this node a mutation of the permissions table? */
function isTableWrite(n: ts.Node, aliases: ReadonlySet<string>): boolean {
  if (!ts.isCallExpression(n)) return false;
  if (!ts.isPropertyAccessExpression(n.expression)) return false;
  if (!WRITE_CALLS.includes(n.expression.name.text)) return false;
  if (n.arguments.length !== 1) return false;
  return namesTable(n.arguments[0].getText(), aliases);
}

/** Is this node lexically inside a call to the gate? */
function insideGate(node: ts.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText().endsWith(GATE)) {
      return true;
    }
  }
  return false;
}

/**
 * The nearest enclosing FUNCTION, for naming a site a person can find.
 *
 * Functions only. A write assigned to a local — `const insertPerm = db.insert(
 * …)` — sits inside a variable declaration as well as inside the method, and
 * naming the nearest binding labels two writes in different services by local
 * names that say nothing about where they are.
 */
function enclosingName(node: ts.Node): string {
  for (let n = node.parent; n; n = n.parent) {
    if (declaresFunction(n)) return n.name.getText();
    if (holdsFunction(n)) return n.name.text;
  }
  return "<top level>";
}

/** A function declared with a name of its own. */
function declaresFunction(
  n: ts.Node
): n is (ts.MethodDeclaration | ts.FunctionDeclaration) & { name: ts.Node } {
  if (!ts.isMethodDeclaration(n) && !ts.isFunctionDeclaration(n)) return false;
  return n.name !== undefined;
}

/** A binding whose value is a function, which is named by what holds it. */
function holdsFunction(n: ts.Node): n is (
  | ts.VariableDeclaration
  | ts.PropertyDeclaration
) & {
  name: ts.Identifier;
} {
  if (!ts.isVariableDeclaration(n) && !ts.isPropertyDeclaration(n))
    return false;
  if (!n.initializer) return false;
  if (
    !ts.isArrowFunction(n.initializer) &&
    !ts.isFunctionExpression(n.initializer)
  ) {
    return false;
  }
  return ts.isIdentifier(n.name);
}

/**
 * Run the same matcher over a source written for the purpose, and report
 * whether each write it finds is gated.
 *
 * The controls below need the real matcher rather than a description of it: a
 * reader built for the test would agree with the test and not with the rule.
 */
function gatingOf(code: string): boolean[] {
  const source = ts.createSourceFile(
    "probe.ts",
    code,
    ts.ScriptTarget.Latest,
    true
  );
  const aliases = aliasesIn(source);
  const found: boolean[] = [];
  const visit = (n: ts.Node): void => {
    if (isTableWrite(n, aliases)) found.push(insideGate(n));
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

type Write = { where: string; gated: boolean };

function writesIn(file: string): Write[] {
  const text = readFileSync(file, "utf-8");
  // Cheap reject before building a tree: the package has thousands of files and
  // only a handful mention this table at all.
  if (!text.includes("permissions")) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const aliases = aliasesIn(source);
  const out: Write[] = [];
  const visit = (n: ts.Node): void => {
    if (isTableWrite(n, aliases)) {
      out.push({
        where: `${relative(SRC, file).split(sep).join("/")}:${enclosingName(n)}`,
        gated: insideGate(n),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return out;
}

const writes = FILES.flatMap(writesIn);

/**
 * The writes, named rather than counted.
 *
 * A count agrees with itself while the selector drops the write that matters
 * and picks up an unrelated one, so the set is pinned by identity: a new write
 * fails here before it can fail the rule below, and removing one is a change
 * somebody has to make on purpose. Several entries repeat because one method
 * writes more than once.
 */
const WRITES = [
  "domains/auth/services/permission-seed-service.ts:markOrphanedPermissionsRows",
  "domains/auth/services/permission-seed-service.ts:normalizeReversedSlugs",
  "domains/auth/services/permission-seed-service.ts:retirePermissionRow",
  "domains/auth/services/permission-seed-service.ts:returnPermissionToPresets",
  "domains/auth/services/permission-service.ts:ensurePermission",
  "domains/auth/services/permission-service.ts:ensurePermission",
  "domains/auth/services/permission-service.ts:removePermissionRow",
  "domains/auth/services/permission-service.ts:updatePermission",
  "domains/auth/services/role-permission-service.ts:addPermissionToRole",
  "domains/auth/services/role-permission-service.ts:healReversedSlug",
];

describe("a write to a permission row goes through the gate", () => {
  it("finds the writes at all, so the rule below is not vacuous", () => {
    // The control. An absence check over a list that came back empty passes
    // perfectly, and this one reads a syntax tree it could stop matching.
    expect(writes.length).toBeGreaterThan(5);
  });

  it("names them, so the set cannot drift without being seen", () => {
    expect(writes.map(w => w.where).sort()).toEqual(WRITES);
  });

  it("leaves none of them outside it", () => {
    expect(
      writes
        .filter(w => !w.gated)
        .map(w => w.where)
        .sort()
    ).toEqual([]);
  });

  it("recognises a write the gate does not enclose", () => {
    // The discriminating control, and it has to exist: every assertion above is
    // satisfied by a checker that reports every write as gated, including the
    // one that would matter. This is the same matcher over a source that must
    // come out ungated, so a checker that cannot say no fails here.
    expect(
      gatingOf(`const { permissions } = this.tables;
         await this.db.delete(permissions).where(eq(permissions.id, id));`)
    ).toEqual([false]);
  });

  it("recognises the same write once the gate encloses it", () => {
    // The other half. A checker that reports everything as ungated fails here,
    // and the pair is what makes either answer mean something. The table
    // arrives as the callback's parameter, so the alias resolution has to have
    // worked for this write to be seen at all — an empty list would satisfy a
    // bare `every`, and this asserts the member.
    expect(
      gatingOf(`await writingPermissions(this.tables.permissions, table =>
           this.db.delete(table).where(eq(table.id, id))
         );`)
    ).toEqual([true]);
  });

  it("sees a write bound to a local name", () => {
    // The alias resolution, on the shape that would otherwise be invisible:
    // the table reached through a plain local rather than named at the call.
    expect(
      gatingOf(`const p = this.tables.permissions;
         await this.db.update(p).set({ slug }).where(eq(p.id, id));`)
    ).toEqual([false]);
  });

  it("leaves no raw SQL writing the table", () => {
    // The stated limit above, given something that fails rather than a
    // sentence. A statement assembled as text never becomes a call on a table
    // object, so the rule above cannot see one.
    //
    // Read from `sql` templates rather than from the file's text. English
    // prose contains these words in this order — "update permissions for the
    // new single" reads as a SQL statement to a text search — and a guard that
    // reports correct code is one somebody switches off, taking the writes it
    // would have caught with it.
    const offenders = FILES.filter(f => {
      const text = readFileSync(f, "utf-8");
      if (!text.includes("permissions")) return false;
      const source = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
      let raw = false;
      const visit = (n: ts.Node): void => {
        if (
          ts.isTaggedTemplateExpression(n) &&
          n.tag.getText().endsWith("sql") &&
          /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?permissions"?\b/i.test(
            n.template.getText()
          )
        ) {
          raw = true;
        }
        if (!raw) ts.forEachChild(n, visit);
      };
      visit(source);
      return raw;
    }).map(f => relative(SRC, f).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
