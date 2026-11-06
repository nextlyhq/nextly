/**
 * The frame a call made as a plugin-defined person runs in, and what reads
 * it: the API-key scope it hides, the hooks it reaches and the field rules it
 * reaches.
 */
import { describe, expect, it, vi } from "vitest";

// A call made as no person and no user is a visitor, whose field rules are
// handed what the Public role grants: nothing here, read with no database.
vi.mock("../services/lib/permissions", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/lib/permissions")>()),
  listPublicGrants: async () => [],
}));

import { HookRegistry } from "../hooks/hook-registry";
import { makePrincipal } from "../plugins/principals/principal";
import {
  applyFieldReadAccess,
  registerFieldFunctions,
} from "../shared/lib/field-level-registry";

import type { AuthenticatedScope } from "./authenticated-scope";
import { effectiveCallerScope, runWithCallerScope } from "./caller-scope";
import {
  currentPrincipal,
  runAsPrincipal,
  withCurrentPrincipal,
} from "./principal-scope";

const person = makePrincipal("accounts:account", "acc_1", { verified: true });
const KEY: AuthenticatedScope = { actorType: "apiKey", permissions: [] };

describe("the person frame", () => {
  it("names the person inside it and nobody outside it", async () => {
    expect(currentPrincipal()).toBeNull();
    await runAsPrincipal(person, async () => {
      await Promise.resolve();
      expect(currentPrincipal()).toBe(person);
    });
    expect(currentPrincipal()).toBeNull();
  });

  it("clears an enclosing person with a frame of its own", () => {
    runAsPrincipal(person, () => {
      runAsPrincipal(null, () => expect(currentPrincipal()).toBeNull());
    });
  });
});

describe("an API key around a call made as a person", () => {
  it("does not apply to the person", () => {
    runWithCallerScope(KEY, () => {
      runAsPrincipal(person, () => {
        expect(effectiveCallerScope(undefined)).toBeUndefined();
      });
    });
  });

  it("still applies to a call made as no person", () => {
    // The control: the key reaches every other call, as it always did.
    runWithCallerScope(KEY, () => {
      runAsPrincipal(null, () => {
        expect(effectiveCallerScope(undefined)).toBe(KEY);
      });
    });
  });
});

describe("hooks for a call made as a person", () => {
  it("receive the person", async () => {
    const registry = new HookRegistry();
    let seen: unknown;
    registry.register("afterRead", "orders", ctx => {
      seen = ctx.principal;
    });
    await runAsPrincipal(person, () =>
      registry.execute("afterRead", {
        collection: "orders",
        operation: "read",
        data: {},
        context: {},
      })
    );
    expect(seen).toBe(person);
  });

  it("add nothing to a hook for anyone else", async () => {
    // Its context is exactly what it was before persons existed.
    const registry = new HookRegistry();
    let keys: string[] = [];
    registry.register("afterRead", "orders", ctx => {
      keys = Object.keys(ctx);
    });
    await registry.execute("afterRead", {
      collection: "orders",
      operation: "read",
      data: {},
      context: {},
    });
    expect(keys).not.toContain("principal");
  });

  it("add the key only for a person", () => {
    expect(withCurrentPrincipal({ a: 1 })).toEqual({ a: 1 });
    runAsPrincipal(person, () =>
      expect(withCurrentPrincipal({ a: 1 })).toEqual({
        a: 1,
        principal: person,
      })
    );
  });
});

describe("field rules for a call made as a person", () => {
  it("see the person, with no user and no grants", async () => {
    let seen: Record<string, unknown> | undefined;
    registerFieldFunctions("collection", "person-scope-orders", [
      {
        name: "note",
        type: "text",
        access: {
          read: (args: Record<string, unknown>) => {
            seen = args;
            return args.principal === person;
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = { id: "o1", note: "kept" };
    await runAsPrincipal(person, () =>
      applyFieldReadAccess({
        kind: "collection",
        slug: "person-scope-orders",
        entry,
      })
    );
    expect(entry.note).toBe("kept");
    expect(seen).toMatchObject({
      req: { user: undefined },
      permissions: [],
      roles: [],
      principal: person,
    });
  });

  it("see no person for anyone else", async () => {
    let principal: unknown = "unset";
    registerFieldFunctions("collection", "person-scope-orders-2", [
      {
        name: "note",
        type: "text",
        access: {
          read: (args: Record<string, unknown>) => {
            principal = args.principal;
            return true;
          },
        },
      },
    ]);
    await applyFieldReadAccess({
      kind: "collection",
      slug: "person-scope-orders-2",
      entry: { id: "o1", note: "x" },
    });
    expect(principal).toBeNull();
  });
});
