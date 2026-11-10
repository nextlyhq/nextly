/**
 * The boot runs every development schema write inside the development start's schema lock, in one
 * hold, and none of them outside it: the schema registry's initialisation, which creates a
 * translated entity's missing translation table, the Builder reconcile, the code-first sync, and
 * the extension tables' preparation.
 *
 * `development-start-sync-takes-the-schema-lock.integration.test.ts` shows what the lock does to
 * work run inside `withDevelopmentStartSchemaLock`; this holds `registerServicesOnce` to running
 * the steps as that work. Read from the parsed source, because the steps need a whole configured
 * boot to run, and what matters here is where the calls sit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseSource } from "@nextlyhq/module-specifiers/parse-source";
import { describe, expect, it } from "vitest";

const registerFile = fileURLToPath(new URL("../register.ts", import.meta.url));
const registerText = readFileSync(registerFile, "utf8");
const registerAst = parseSource(registerText, registerFile);

interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { start?: unknown }).start === "number"
  );
}

/** Every node under `root`, itself included. */
function* walk(root: unknown): Generator<Node> {
  if (Array.isArray(root)) {
    for (const item of root) yield* walk(item);
    return;
  }
  if (!isNode(root)) return;
  yield root;
  for (const [key, value] of Object.entries(root)) {
    if (key === "parent") continue;
    if (typeof value === "object" && value !== null) yield* walk(value);
  }
}

/** The calls under `root` to a function named `name`. */
function callsTo(root: unknown, name: string): Node[] {
  return [...walk(root)].filter(node => {
    if (node.type !== "CallExpression") return false;
    const callee = node.callee as Node | undefined;
    return callee?.type === "Identifier" && callee.name === name;
  });
}

const registerServicesOnce = [...walk(registerAst.program.body)].find(
  node =>
    node.type === "FunctionDeclaration" &&
    (node.id as { name?: string } | undefined)?.name === "registerServicesOnce"
);

/** Every step of the boot that changes the schema outside production, in the order it runs. */
const SCHEMA_WRITE_STEPS = [
  "initializeSchemaRegistry",
  "reconcileBuilderTargets",
  "syncCodeFirstEntities",
  "prepareExtensionTablesForInit",
] as const;

const within = (inner: Node, outer: Node): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

/** Whether `call` is the operand of an `await` itself, not merely started inside one's reach. */
const awaited = (call: Node, root: unknown): boolean =>
  [...walk(root)].some(
    node =>
      node.type === "AwaitExpression" &&
      (node.argument as Node | undefined)?.start === call.start &&
      (node.argument as Node | undefined)?.end === call.end
  );

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/** The innermost function under `root` that contains `node`. */
function innermostFunction(node: Node, root: unknown): Node | undefined {
  return [...walk(root)]
    .filter(fn => FUNCTION_TYPES.has(fn.type) && within(node, fn))
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
}

describe("the development start's schema sync in registerServicesOnce", () => {
  it("is read from the function itself", () => {
    expect(registerServicesOnce).toBeDefined();
    // A positive control on the reading: the steps are found as calls where they are known to be.
    for (const step of SCHEMA_WRITE_STEPS) {
      expect(callsTo(registerServicesOnce, step), step).toHaveLength(1);
    }
  });

  it("runs every development schema write as the locked work, and only there", () => {
    const locks = callsTo(
      registerServicesOnce,
      "withDevelopmentStartSchemaLock"
    );
    expect(locks).toHaveLength(1);
    const [lock] = locks;
    const args = (lock?.arguments ?? []) as Node[];
    const work = args.at(-1);
    expect(work?.type).toBe("ArrowFunctionExpression");
    if (work === undefined) return;

    // Soft, so a run names every step outside the work rather than only the first.
    for (const step of SCHEMA_WRITE_STEPS) {
      const calls = callsTo(registerServicesOnce, step);
      expect.soft(calls, step).toHaveLength(1);
      for (const call of calls) {
        expect.soft(within(call, work), step).toBe(true);
      }
    }
  });

  it("awaits the lock, and each step inside the locked work itself", () => {
    // Inside the lock's reach is not enough: an un-awaited lock lets registration go on while the
    // sync runs, and a step started without an await, or from a function nested in the work, can
    // still be writing when the work returns and the lock is released.
    const [lock] = callsTo(
      registerServicesOnce,
      "withDevelopmentStartSchemaLock"
    );
    expect(lock).toBeDefined();
    if (lock === undefined) return;
    expect(awaited(lock, registerServicesOnce)).toBe(true);
    const work = ((lock.arguments ?? []) as Node[]).at(-1);
    if (work === undefined) return;

    for (const step of SCHEMA_WRITE_STEPS) {
      const [call] = callsTo(work, step);
      expect.soft(call, step).toBeDefined();
      if (call === undefined) continue;
      expect.soft(awaited(call, work), `${step} is awaited`).toBe(true);
      expect
        .soft(innermostFunction(call, work), `${step} runs in the work itself`)
        .toBe(work);
    }
  });
});
