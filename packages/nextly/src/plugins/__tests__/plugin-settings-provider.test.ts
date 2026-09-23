/**
 * Which dialect a plugin's `ctx.settings` actually builds SQL for.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { PluginDefinition } from "../plugin-context";
import { createPluginSettings } from "../plugin-settings-provider";

process.env.NEXTLY_SECRET_KEYS ??= "c".repeat(32);

/** Records which upsert spelling the store reached for. */
function recordingDb() {
  const spelling: string[] = [];
  const writer = {
    // The store READS inside its transaction before writing, so the fake has
    // to answer a select as the real builders do — awaitable, and carrying
    // `.for` for the dialects that lock.
    select: () => ({
      from: () => ({
        where: () => {
          const p = Promise.resolve([]) as Promise<never[]> & {
            for: (s: "update") => Promise<never[]>;
          };
          p.for = () => Promise.resolve([]);
          return p;
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        // The store CLAIMS each key before reading, and that claim is a
        // no-op `DO UPDATE` on every dialect — told apart from the real
        // upsert by what it sets, since only the upsert writes a value.
        onConflictDoUpdate: async (args: unknown) => {
          const set = (args as { set: Record<string, unknown> }).set;
          if ("value" in set) spelling.push("onConflictDoUpdate");
        },
        // The store CLAIMS each key before reading, and on MySQL that claim
        // is spelled `onDuplicateKeyUpdate` as well — told apart by what it
        // sets, since only the real upsert writes a value.
        onDuplicateKeyUpdate: async (args: unknown) => {
          const set = (args as { set: Record<string, unknown> }).set;
          if ("value" in set) spelling.push("onDuplicateKeyUpdate");
        },
        delete: async () => undefined,
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  };
  return {
    spelling,
    db: {
      ...writer,
      transaction: async <T>(run: (tx: typeof writer) => Promise<T>) =>
        run(writer),
    },
  };
}

const plugin = {
  name: "@acme/thing",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: { settings: z.object({ port: z.number().default(443) }) },
} as unknown as PluginDefinition;

describe("createPluginSettings builds for the dialect it is GIVEN", () => {
  it("uses MySQL's upsert on MySQL", async () => {
    // The database handle a plugin receives is a restricted wrapper carrying
    // only four query methods, so reading `db.dialect` always answered
    // `undefined` and every install fell back to SQLite. On MySQL that meant
    // calling `onConflictDoUpdate`, which MySQL does not have.
    const fake = recordingDb();
    await createPluginSettings(plugin, fake.db, "mysql").set({ port: 8443 });
    expect(fake.spelling).toEqual(["onDuplicateKeyUpdate"]);
  });

  it("uses the conflict-target upsert on Postgres", async () => {
    // The control: answering MySQL's spelling for every dialect would satisfy
    // the assertion above and break the other two.
    const fake = recordingDb();
    await createPluginSettings(plugin, fake.db, "postgresql").set({
      port: 8443,
    });
    expect(fake.spelling).toEqual(["onConflictDoUpdate"]);
  });
});

describe("the adapter transaction the plugin context hands the store", () => {
  it("invokes the ADAPTER's method, bound, not an extracted function", async () => {
    // The context resolves the runner lazily as the adapter's `transaction`
    // METHOD. Returning it extracted loses the class receiver, and the real
    // SQLite adapter reaches for instance state before opening the
    // transaction — a failure the boot-time test harness cannot see, because
    // it replaces `transaction` with a bound closure. This adapter is a
    // class-style method using `this`, the shape production has.
    const calls: string[] = [];
    class Adapter {
      async transaction<T>(work: () => Promise<T>): Promise<T> {
        // `this` is required to get here at all: an extracted call throws
        // before the work runs.
        if (!(this instanceof Adapter)) throw new TypeError("unbound");
        calls.push("begin");
        try {
          return await work();
        } finally {
          calls.push("commit");
        }
      }
    }
    const adapter = new Adapter();
    const db = {
      select: () => ({
        from: () => ({ where: async () => [] }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => undefined,
          onDuplicateKeyUpdate: async () => undefined,
        }),
      }),
      delete: () => ({ where: async () => undefined }),
    };

    const api = createPluginSettings(
      {
        name: "@a/p",
        version: "1.0.0",
        nextly: "*",
        contributes: { settings: z.object({ port: z.number().default(1) }) },
      } as never,
      db,
      "sqlite",
      // Exactly what plugin-context does: hand back the method from a
      // resolver. The bug was returning `adapter.transaction` itself.
      () => work => adapter.transaction(work)
    );

    await api.set({ port: 2 });
    expect(calls).toEqual(["begin", "commit"]);
  });
});
