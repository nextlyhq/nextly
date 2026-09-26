/**
 * The one registration boot and an HMR reload share.
 */
import { describe, expect, it } from "vitest";

import type { ExtensionSchema } from "../build-extension-schema";
import {
  registerExtensionTables,
  type ExtensionTableRegistry,
} from "../register-tables";

function fakeRegistry() {
  const held = new Map<string, unknown>();
  const edges = new Map<string, unknown>();
  const registry: ExtensionTableRegistry = {
    registerDynamicSchema: (name, table, tableEdges) => {
      held.set(name, table);
      edges.set(name, tableEdges);
    },
    retractDynamicSchema: name => {
      held.delete(name);
    },
  };
  return { registry, held, edges };
}

function schema(input: {
  drizzle?: Record<string, unknown>;
  adopted?: Record<string, unknown>;
}): ExtensionSchema {
  return {
    drizzle: input.drizzle ?? {},
    adopted: input.adopted ?? {},
    relations: new Map([["fx__notes", [{ key: "owner" }]]]),
    adoptedRelations: new Map(),
  } as unknown as ExtensionSchema;
}

describe("registerExtensionTables", () => {
  it("registers compiled and adopted tables, with their edges", () => {
    const { registry, held, edges } = fakeRegistry();
    registerExtensionTables(
      registry,
      schema({ drizzle: { fx__notes: "N" }, adopted: { legacy: "L" } })
    );
    expect([...held.keys()].sort()).toEqual(["fx__notes", "legacy"]);
    expect(edges.get("fx__notes")).toEqual([{ key: "owner" }]);
  });

  it("retracts what a later registration no longer declares", () => {
    const { registry, held } = fakeRegistry();
    registerExtensionTables(
      registry,
      schema({ drizzle: { fx__notes: "N", fx__gone: "G" } })
    );
    registerExtensionTables(registry, schema({ drizzle: { fx__notes: "N" } }));
    expect([...held.keys()]).toEqual(["fx__notes"]);
  });

  it("retracts everything when nothing declares a table any more", () => {
    const { registry, held } = fakeRegistry();
    registerExtensionTables(registry, schema({ drizzle: { fx__notes: "N" } }));
    registerExtensionTables(registry, undefined);
    expect(held.size).toBe(0);
  });

  it("keeps each registry's record separate", () => {
    // A second registry in the same process — a test boot — must not retract
    // on the strength of what another one held.
    const first = fakeRegistry();
    const second = fakeRegistry();
    registerExtensionTables(first.registry, schema({ drizzle: { a: 1 } }));
    registerExtensionTables(second.registry, schema({ drizzle: { b: 2 } }));
    expect([...first.held.keys()]).toEqual(["a"]);
  });
});
