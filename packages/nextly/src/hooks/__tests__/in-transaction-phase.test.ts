/**
 * The in-transaction phase's store in the registry, and the runner that
 * executes it, without a database: what runs, in what order, for whom, and
 * what a failure turns into. The integration suite
 * (`plugins/__tests__/in-transaction-phase.integration.test.ts`) proves the
 * same handlers share the write's transaction on every dialect.
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import { isWriteIntegrityFailure } from "../../shared/write-integrity";
import { HookRegistry } from "../hook-registry";
import {
  detachedContext,
  MAX_IN_TRANSACTION_DEPTH,
  runInTransactionPhase,
} from "../in-transaction-phase";
import type { InTransactionRunner, InTransactionWrite } from "../types";

/** The phase never touches the transaction itself: it hands it on. */
const tx = {} as TransactionContext;

const write = {
  collection: "orders",
  operation: "create" as const,
  id: "o1",
  data: { title: "x" },
  context: { shared: 1 },
};

/** A runner that records its name and what it was handed. */
function recorder(name: string, seen: string[]): InTransactionRunner {
  return (_tx, handed) => {
    seen.push(`${name}:${handed.collection}`);
    return Promise.resolve();
  };
}

describe("the in-transaction store", () => {
  it("runs '*' handlers first, then the collection's own, each in order", async () => {
    const registry = new HookRegistry();
    const seen: string[] = [];
    registry.registerInTransaction("orders", recorder("own-1", seen));
    registry.registerInTransaction("*", recorder("all", seen));
    registry.registerInTransaction("orders", recorder("own-2", seen));
    registry.registerInTransaction("notes", recorder("other", seen));

    await runInTransactionPhase(
      registry.inTransactionEntries("orders"),
      tx,
      write
    );

    expect(seen).toEqual(["all:orders", "own-1:orders", "own-2:orders"]);
    expect(registry.hasInTransaction("orders")).toBe(true);
    expect(registry.hasInTransaction("pages")).toBe(true);
    registry.unregisterInTransaction(
      "*",
      registry.inTransactionRunners("*")[0]
    );
    expect(registry.hasInTransaction("pages")).toBe(false);
  });

  it("removes only the owner's own registration of a runner", () => {
    const registry = new HookRegistry();
    const seen: string[] = [];
    const shared = recorder("shared", seen);
    registry.registerInTransaction("orders", shared, "plugin:a");
    registry.registerInTransaction("orders", shared, "app");

    registry.unregisterInTransaction("orders", shared, "plugin:a");

    expect(registry.inTransactionRunners("orders")).toEqual([shared]);
    expect(registry.registeredOwners()).toEqual(["app"]);
  });

  it("skips a suspended owner's runners, and counts it as an owner", () => {
    const registry = new HookRegistry();
    registry.registerInTransaction("orders", recorder("a", []), "plugin:a");

    expect(registry.registeredOwners()).toEqual(["plugin:a"]);
    registry.setSuspendedOwners(["plugin:a"]);

    expect(registry.hasInTransaction("orders")).toBe(false);
    expect(registry.inTransactionRunners("orders")).toEqual([]);
  });

  it("is cleared by an owner's clear, a collection's clear and a full clear", () => {
    const registry = new HookRegistry();
    const mine = recorder("mine", []);
    const theirs = recorder("theirs", []);
    registry.registerInTransaction("orders", mine, "code");
    registry.registerInTransaction("orders", theirs, "plugin:a");
    expect(registry.collectionsOwnedBy("code")).toEqual(["orders"]);

    registry.clearCollectionOwnedBy("orders", "code");
    expect(registry.inTransactionRunners("orders")).toEqual([theirs]);

    registry.clearCollection("orders");
    expect(registry.hasInTransaction("orders")).toBe(false);

    registry.registerInTransaction("*", mine);
    registry.clear();
    expect(registry.hasInTransaction("orders")).toBe(false);
  });

  it("is left alone by a config rebuild that declares none", () => {
    // A rebuild of the config's handlers names every phase it owns; a
    // plugin's in-transaction runner under the same collection is not its.
    const registry = new HookRegistry();
    const plugin = recorder("plugin", []);
    registry.registerInTransaction("orders", plugin, "plugin:a");

    registry.replaceCollectionOwnedBy("orders", "code", {
      byPhase: [],
      beforeOperation: [],
    });

    expect(registry.inTransactionRunners("orders")).toEqual([plugin]);
  });
});

describe("runInTransactionPhase", () => {
  it("hands every handler the same frozen copy of the shared context", async () => {
    const registry = new HookRegistry();
    const handed: InTransactionWrite[] = [];
    registry.registerInTransaction("orders", (_tx, w) => {
      handed.push(w);
      return Promise.resolve();
    });
    registry.registerInTransaction("orders", (_tx, w) => {
      handed.push(w);
      return Promise.resolve();
    });
    const shared: Record<string, unknown> = { shared: 1 };

    await runInTransactionPhase(registry.inTransactionEntries("orders"), tx, {
      ...write,
      context: shared,
    });

    expect(handed[0].context).toBe(handed[1].context);
    expect(handed[0].context).not.toBe(shared);
    expect(Object.isFrozen(handed[0].context)).toBe(true);
    expect(handed[0].context).toEqual({ shared: 1 });
  });

  it("hands a detached, deeply frozen copy of plain data, leaving out the rest", () => {
    class Marker {
      label = "instance";
    }
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    const shared: Record<string, unknown> = {
      nested: { count: 1, tags: ["a", { deep: true }] },
      bare: Object.assign(Object.create(null) as object, { kept: 1 }),
      when: new Date(0),
      lookup: new Map([["k", 1]]),
      instance: new Marker(),
      callback: () => undefined,
      mixed: [1, new Date(0), "x"],
      loop,
    };

    const copy = detachedContext(shared);

    expect(copy).toEqual({
      nested: { count: 1, tags: ["a", { deep: true }] },
      bare: { kept: 1 },
      mixed: [1, undefined, "x"],
      loop: { name: "loop" },
    });
    const nested = copy.nested as { count: number; tags: unknown[] };
    expect(nested).not.toBe(shared.nested);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.tags)).toBe(true);
    expect(Object.isFrozen(nested.tags[1])).toBe(true);
    expect(() => {
      nested.count = 2;
    }).toThrow(TypeError);
    expect(shared.nested).toEqual({ count: 1, tags: ["a", { deep: true }] });
    // An empty context costs nothing: one shared frozen object.
    expect(detachedContext({})).toBe(detachedContext({}));
  });

  it("throws a handler's typed error as it was, marked to abort a batch", async () => {
    const registry = new HookRegistry();
    const refusal = NextlyError.forbidden({});
    const later: string[] = [];
    registry.registerInTransaction("orders", () => Promise.reject(refusal));
    registry.registerInTransaction("orders", recorder("later", later));

    const caught = await runInTransactionPhase(
      registry.inTransactionEntries("orders"),
      tx,
      write
    ).catch((error: unknown) => error);

    expect(caught).toBe(refusal);
    expect(isWriteIntegrityFailure(caught)).toBe(true);
    // The first failure stops the phase: the write is aborted anyway.
    expect(later).toEqual([]);
  });

  it("turns a plain error into an internal one carrying it as the cause", async () => {
    const registry = new HookRegistry();
    const broken = new Error("broken");
    registry.registerInTransaction("orders", () => Promise.reject(broken));

    const caught = await runInTransactionPhase(
      registry.inTransactionEntries("orders"),
      tx,
      write
    ).catch((error: unknown) => error);

    expect(NextlyError.is(caught)).toBe(true);
    expect(caught).toMatchObject({ statusCode: 500, cause: broken });
    expect(isWriteIntegrityFailure(caught)).toBe(true);
  });

  it(`refuses a phase nested more than ${String(MAX_IN_TRANSACTION_DEPTH)} deep`, async () => {
    // Each handler starts a write whose own phase runs the handler again, as
    // two plugins writing to each other's collections would.
    const registry = new HookRegistry();
    let depth = 0;
    registry.registerInTransaction("orders", async () => {
      depth += 1;
      await runInTransactionPhase(
        registry.inTransactionEntries("orders"),
        tx,
        write
      );
    });

    const caught = await runInTransactionPhase(
      registry.inTransactionEntries("orders"),
      tx,
      write
    ).catch((error: unknown) => error);

    expect(depth).toBe(MAX_IN_TRANSACTION_DEPTH);
    expect(caught).toMatchObject({
      statusCode: 500,
      logContext: { reason: "in-transaction-phase-too-deep" },
    });
  });
});
