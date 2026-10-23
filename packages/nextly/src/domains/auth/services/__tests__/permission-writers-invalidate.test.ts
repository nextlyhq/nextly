import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node, Program } from "oxc-parser";
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

/** One parsed file: its program, and the text its nodes' offsets point into. */
interface Source {
  readonly text: string;
  readonly program: Program;
}

function read(text: string, fileName: string): Source {
  return { text, program: parseSource(text, fileName).program };
}

/** The source text of one node, as it is written. */
function textOf(source: Source, node: Node): string {
  return source.text.slice(node.start, node.end);
}

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
function aliasesIn(source: Source): Set<string> {
  const aliases = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    walk(source.program, n => {
      const name = boundToTable(source, n, aliases) ?? gateParameter(source, n);
      if (name && !aliases.has(name)) {
        aliases.add(name);
        changed = true;
      }
    });
  }
  return aliases;
}

/** `const p = this.tables.permissions` — the name it binds, if it binds one. */
function boundToTable(
  source: Source,
  n: Node,
  aliases: ReadonlySet<string>
): string | null {
  if (n.type !== "VariableDeclarator" || !n.init) return null;
  if (n.id.type !== "Identifier") return null;
  return namesTable(textOf(source, n.init), aliases) ? n.id.name : null;
}

/** Is this node a call to the gate? */
function isGateCall(source: Source, n: Node): boolean {
  return n.type === "CallExpression" && textOf(source, n.callee).endsWith(GATE);
}

/** The gate hands the table to its callback, so the parameter is the table. */
function gateParameter(source: Source, n: Node): string | null {
  if (n.type !== "CallExpression" || !isGateCall(source, n)) return null;
  if (n.arguments.length !== 2) return null;
  const run = n.arguments[1];
  if (
    run.type !== "ArrowFunctionExpression" &&
    run.type !== "FunctionExpression"
  ) {
    return null;
  }
  if (run.params.length !== 1) return null;
  const param = run.params[0];
  return param.type === "Identifier" ? param.name : null;
}

/** The mutating builder calls, named once. */
const WRITE_CALLS = ["insert", "update", "delete"];

/** Is this node a mutation of the permissions table? */
function isTableWrite(
  source: Source,
  n: Node,
  aliases: ReadonlySet<string>
): boolean {
  if (n.type !== "CallExpression") return false;
  const callee = n.callee;
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.property.type !== "Identifier") return false;
  if (!WRITE_CALLS.includes(callee.property.name)) return false;
  if (n.arguments.length !== 1) return false;
  return namesTable(textOf(source, n.arguments[0]), aliases);
}

/**
 * The nearest enclosing FUNCTION, for naming a site a person can find.
 *
 * Functions only. A write assigned to a local — `const insertPerm = db.insert(
 * …)` — sits inside a variable declaration as well as inside the method, and
 * naming the nearest binding labels two writes in different services by local
 * names that say nothing about where they are. A function is named by its own
 * name, a method (class or object-literal) by its key, and a function held by
 * a variable or a class field by what holds it.
 */
function enclosingName(source: Source, ancestors: readonly Node[]): string {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const name = functionNameAt(source, ancestors[i]);
    if (name !== null) return name;
  }
  return "<top level>";
}

/** The name this node gives a function it declares or holds, or null if it gives none. */
function functionNameAt(source: Source, n: Node): string | null {
  return declaredName(source, n) ?? holderName(n);
}

/** A function or method named by its own name or key. */
function declaredName(source: Source, n: Node): string | null {
  if (n.type === "FunctionDeclaration") return n.id?.name ?? null;
  const isMethod =
    n.type === "MethodDefinition" || (n.type === "Property" && n.method);
  return isMethod ? textOf(source, n.key) : null;
}

/** A function held by a variable or a class field, named by what holds it. */
function holderName(n: Node): string | null {
  const [name, value] =
    n.type === "VariableDeclarator"
      ? [n.id, n.init]
      : n.type === "PropertyDefinition"
        ? [n.key, n.value]
        : [null, null];
  return name?.type === "Identifier" && holdsFunction(value) ? name.name : null;
}

/** Whether a binding's value is a function, so the binding names it. */
function holdsFunction(value: Node | null): boolean {
  return (
    value?.type === "ArrowFunctionExpression" ||
    value?.type === "FunctionExpression"
  );
}

/** Every table write in one source, whether the gate encloses it, and where it sits. */
function tableWrites(source: Source): { gated: boolean; enclosing: string }[] {
  const aliases = aliasesIn(source);
  const found: { gated: boolean; enclosing: string }[] = [];
  walk(source.program, (n, ancestors) => {
    if (!isTableWrite(source, n, aliases)) return;
    found.push({
      gated: ancestors.some(above => isGateCall(source, above)),
      enclosing: enclosingName(source, ancestors),
    });
  });
  return found;
}

/**
 * Run the same matcher over a source written for the purpose, and report
 * whether each write it finds is gated.
 *
 * The controls below need the real matcher rather than a description of it: a
 * reader built for the test would agree with the test and not with the rule.
 */
function gatingOf(code: string): boolean[] {
  return tableWrites(read(code, "probe.ts")).map(write => write.gated);
}

type Write = { where: string; gated: boolean };

function writesIn(file: string): Write[] {
  const text = readFileSync(file, "utf-8");
  // Cheap reject before building a tree: the package has thousands of files and
  // only a handful mention this table at all.
  if (!text.includes("permissions")) return [];
  const where = relative(SRC, file).split(sep).join("/");
  return tableWrites(read(text, file)).map(write => ({
    where: `${where}:${write.enclosing}`,
    gated: write.gated,
  }));
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
  "domains/auth/services/permission-seed-service.ts:createWithGrants",
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
      const source = read(text, f);
      let raw = false;
      walk(source.program, n => {
        if (
          n.type === "TaggedTemplateExpression" &&
          textOf(source, n.tag).endsWith("sql") &&
          /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?permissions"?\b/i.test(
            textOf(source, n.quasi)
          )
        ) {
          raw = true;
        }
        return !raw;
      });
      return raw;
    }).map(f => relative(SRC, f).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });
});
