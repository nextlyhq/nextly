import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node, Program } from "oxc-parser";
import { describe, expect, it } from "vitest";

/**
 * Every announcement of a change to what a role grants runs inside
 * `changingRoleGrants`.
 *
 * The announcement (`afterRoleGrantsChanged`, or `invalidatePermissionCache`
 * naming a role) is where the content expiry the change owes is reached, after
 * the change has committed. The gate around it queues that expiry as a job
 * before the write starts, so it is owed in the database before the change
 * commits and a process stopped in between still leaves it to the jobs queue.
 * An announcement outside the gate leaves that window open, and nothing in the
 * writer's own tests can see it.
 *
 * As in `permission-writers-invalidate.test.ts`, the rule is about where the
 * call sits rather than what the method around it remembers to do: "is this
 * call inside the gate" is a property of the call, judged the same way for
 * every call in the package, in any file. Permission-row writes are held to
 * their own gate, `writingPermissions`, which queues the same expiry, by that
 * test.
 */
const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

/** The gate. */
const GATE = "changingRoleGrants";

/** Where the announcement is defined, and so reaches the role-scoped invalidation itself. */
const DEFINITION = "domains/auth/services/role-grants-changed.ts";

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

interface Source {
  readonly text: string;
  readonly program: Program;
}

function read(text: string, fileName: string): Source {
  return { text, program: parseSource(text, fileName).program };
}

function textOf(source: Source, node: Node): string {
  return source.text.slice(node.start, node.end);
}

function calls(source: Source, n: Node, name: string): boolean {
  return (
    n.type === "CallExpression" &&
    new RegExp(`(^|\\.)${name}$`).test(textOf(source, n.callee))
  );
}

/**
 * An announcement of a role's changed grants: `afterRoleGrantsChanged(...)`,
 * or `invalidatePermissionCache(...)` given a `roleId`. One given only a
 * `userId` changes whose roles a user holds, not what a role grants.
 */
function isAnnouncement(source: Source, n: Node): boolean {
  if (calls(source, n, "afterRoleGrantsChanged")) return true;
  if (n.type !== "CallExpression") return false;
  if (!calls(source, n, "invalidatePermissionCache")) return false;
  const [hint] = n.arguments;
  return hint !== undefined && /\broleId\b/.test(textOf(source, hint));
}

/** The nearest enclosing named function or method, for naming a site. */
function enclosingName(source: Source, ancestors: readonly Node[]): string {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const name = nameAt(source, ancestors[i]);
    if (name !== null) return name;
  }
  return "<top level>";
}

/** The name this node gives a function: declared, a method's key, or what holds it. */
function nameAt(source: Source, n: Node): string | null {
  if (n.type === "FunctionDeclaration") return n.id?.name ?? null;
  if (n.type === "MethodDefinition") return textOf(source, n.key);
  return heldFunctionName(n);
}

/** A function held by a variable, named by the variable. */
function heldFunctionName(n: Node): string | null {
  if (n.type !== "VariableDeclarator" || n.id.type !== "Identifier") {
    return null;
  }
  return isFunction(n.init) ? n.id.name : null;
}

function isFunction(value: Node | null | undefined): boolean {
  return (
    value?.type === "ArrowFunctionExpression" ||
    value?.type === "FunctionExpression"
  );
}

function announcements(
  source: Source
): { gated: boolean; enclosing: string }[] {
  const found: { gated: boolean; enclosing: string }[] = [];
  walk(source.program, (n, ancestors) => {
    if (!isAnnouncement(source, n)) return;
    found.push({
      gated: ancestors.some(above => calls(source, above, GATE)),
      enclosing: enclosingName(source, ancestors),
    });
  });
  return found;
}

/** The same matcher over a source written for the purpose. */
function gatingOf(code: string): boolean[] {
  return announcements(read(code, "probe.ts")).map(found => found.gated);
}

const sites = sourceFiles(SRC).flatMap(file => {
  const text = readFileSync(file, "utf-8");
  // Cheap reject before building a tree.
  if (
    !text.includes("afterRoleGrantsChanged") &&
    !text.includes("invalidatePermissionCache")
  ) {
    return [];
  }
  const where = relative(SRC, file).split(sep).join("/");
  if (where === DEFINITION) return [];
  return announcements(read(text, file)).map(found => ({
    where: `${where}:${found.enclosing}`,
    gated: found.gated,
  }));
});

/** The announcements, named rather than counted, so the set cannot drift unseen. */
const SITES = [
  "domains/auth/services/role-inheritance-service.ts:addRoleInheritance",
  "domains/auth/services/role-inheritance-service.ts:removeRoleInheritance",
  "domains/auth/services/role-permission-service.ts:addPermissionToRole",
  "domains/auth/services/role-permission-service.ts:addPermissionToRole",
  "domains/auth/services/role-permission-service.ts:addRolePermissionsOnce",
  "domains/auth/services/role-permission-service.ts:convertRetiredManage",
  "domains/auth/services/role-permission-service.ts:removePermissionFromRole",
  "domains/auth/services/role-permission-service.ts:setRolePermissions",
  "domains/auth/services/role-permission-service.ts:withdrawRolePermissions",
  "domains/auth/services/role/role-mutation-service.ts:createRole",
  "domains/auth/services/role/role-mutation-service.ts:deleteRole",
  "domains/auth/services/role/role-mutation-service.ts:moveRoleOffPublicSlug",
  "domains/auth/services/role/role-mutation-service.ts:unlinkPublicRole",
  "domains/auth/services/role/role-mutation-service.ts:updateRole",
];

describe("a change to what a role grants is announced inside the gate", () => {
  it("finds the announcements at all, so the rule below is not vacuous", () => {
    expect(sites.length).toBeGreaterThan(5);
  });

  it("names them, so the set cannot drift without being seen", () => {
    expect(sites.map(site => site.where).sort()).toEqual(SITES);
  });

  it("leaves none of them outside it", () => {
    expect(
      sites
        .filter(site => !site.gated)
        .map(site => site.where)
        .sort()
    ).toEqual([]);
  });

  it("recognises an announcement the gate does not enclose", () => {
    // A checker that reports every call as gated fails here.
    expect(
      gatingOf(`await this.adapter.transaction(async tx => write(tx));
         await afterRoleGrantsChanged(roleId);
         await invalidatePermissionCache({ roleId: id });`)
    ).toEqual([false, false]);
  });

  it("recognises the same announcements once the gate encloses them", () => {
    // A checker that reports every call as ungated fails here.
    expect(
      gatingOf(`await changingRoleGrants(async () => {
           await this.adapter.transaction(async tx => write(tx));
           await afterRoleGrantsChanged(roleId);
           await invalidatePermissionCache({ roleId: id });
         });`)
    ).toEqual([true, true]);
  });

  it("does not count a change to whose roles a user holds", () => {
    expect(gatingOf(`await invalidatePermissionCache({ userId });`)).toEqual(
      []
    );
  });
});
