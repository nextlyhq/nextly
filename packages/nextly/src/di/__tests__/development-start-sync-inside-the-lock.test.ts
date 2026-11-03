/**
 * The boot runs its Builder reconcile and its code-first sync inside the development start's
 * schema lock, both of them, and neither outside it.
 *
 * `development-start-sync-takes-the-schema-lock.integration.test.ts` shows what the lock does to
 * work run inside `withDevelopmentStartSchemaLock`; this holds `registerServicesOnce` to running
 * the two steps as that work. Read from the parsed source, because the two steps need a whole
 * configured boot to run, and what matters here is where the calls sit.
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

const within = (inner: Node, outer: Node): boolean =>
  inner.start >= outer.start && inner.end <= outer.end;

describe("the development start's schema sync in registerServicesOnce", () => {
  it("is read from the function itself", () => {
    expect(registerServicesOnce).toBeDefined();
    // A positive control on the reading: the steps are found as calls where they are known to be.
    expect(
      callsTo(registerServicesOnce, "reconcileBuilderTargets")
    ).toHaveLength(1);
    expect(callsTo(registerServicesOnce, "syncCodeFirstEntities")).toHaveLength(
      1
    );
  });

  it("runs the Builder reconcile and the code-first sync as the locked work, and only there", () => {
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

    for (const step of ["reconcileBuilderTargets", "syncCodeFirstEntities"]) {
      const calls = callsTo(registerServicesOnce, step);
      expect(calls, step).toHaveLength(1);
      for (const call of calls) expect(within(call, work), step).toBe(true);
    }
  });
});
