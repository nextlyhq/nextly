import { describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import type { Logger } from "../shared/types";
import { createPluginContext, PLUGIN_SERVICE_NAMES } from "./plugin-context";
import { wrapSinglesForPlugin } from "./plugin-singles";

/**
 * A registry that records every method reached through it.
 *
 * A `vi.fn()` per method would only observe the methods the test remembered to
 * declare, and the property being checked is about the ones it did NOT — so the
 * double is a Proxy, and any access at all is recorded whether or not this file
 * knows the name.
 */
function recordingRegistry(): {
  registry: SingleRegistryService;
  touched: string[];
} {
  const touched: string[] = [];
  const registry = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        touched.push(prop);
        return vi.fn().mockResolvedValue({ data: [], total: 0 });
      },
    }
  ) as SingleRegistryService;
  return { registry, touched };
}

/** The hook registry shape `createPluginContext` requires. */
function hookRegistryDouble(): Parameters<typeof createPluginContext>[1] {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    registerBeforeOperation: vi.fn(),
    unregisterBeforeOperation: vi.fn(),
  } as unknown as Parameters<typeof createPluginContext>[1];
}

describe("wrapSinglesForPlugin", () => {
  it("forwards a list to the registry's listSingles", async () => {
    const listSingles = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const registry = { listSingles } as unknown as SingleRegistryService;

    await wrapSinglesForPlugin(registry).list({ source: "code" });

    // The ARGUMENT is asserted, not just the call: a wrapper that dropped its
    // options would still be "called once" while silently listing everything.
    expect(listSingles).toHaveBeenCalledWith({ source: "code" });
  });

  it("reaches nothing on the registry except the listing", async () => {
    // The surface is public API, so what it does NOT expose is the load-bearing
    // part. The registry can register, lock and rewrite migration status; a
    // wrapper that handed the service through would publish all of that, and
    // the mistake would be invisible at the call site.
    const { registry, touched } = recordingRegistry();

    await wrapSinglesForPlugin(registry).list();

    expect(touched).toEqual(["listSingles"]);
  });

  it("exposes exactly one method", async () => {
    // Pairs with the test above, which watches what the wrapper REACHES. This
    // watches what a plugin can CALL — a method added here that forwards
    // nowhere would satisfy the other test and still widen the surface.
    const { registry } = recordingRegistry();

    const surface = wrapSinglesForPlugin(registry);

    expect(Object.keys(surface)).toEqual(["list"]);
  });
});

describe("listing Singles creates nothing", () => {
  /**
   * An adapter that records every operation asked of it.
   *
   * The point of reaching past the wrapper to the real `SingleRegistryService`
   * is that the property being guarded lives THERE, not here. The wrapper tests
   * above show it calls `listSingles` and nothing else; they cannot show what
   * `listSingles` itself does, and that is where a lazy-materialise would be
   * added — by someone changing the registry for an unrelated reason, with no
   * idea a plugin surface depends on this read staying a read.
   */
  function recordingAdapter(): { adapter: DrizzleAdapter; ops: string[] } {
    const ops: string[] = [];
    const adapter = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            ops.push(prop);
            // Shapes the read path needs back. Anything else returns undefined,
            // which is fine: this test is about WHICH operations are issued.
            if (prop === "select") return Promise.resolve([]);
            if (prop === "selectOne") return Promise.resolve(null);
            if (prop === "tableExists") return Promise.resolve(true);
            void args;
            return Promise.resolve(undefined);
          };
        },
      }
    ) as DrizzleAdapter;
    return { adapter, ops };
  }

  const silentLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  } as unknown as Logger;

  it("issues only read operations against the database", async () => {
    // The boundary the founder ruling asked for, in place of a docblock
    // promising it. A read-shaped call on the Single path is not free of side
    // effects in general — the readable half of the preview check creates a
    // Single's row when absent — so a plugin walking every Single to build an
    // index would materialise every Single in the app while appearing to work.
    const { adapter, ops } = recordingAdapter();
    const registry = new SingleRegistryService(adapter, silentLogger);

    await wrapSinglesForPlugin(registry).list();

    // Asserted against the whole class of write-shaped names rather than a list
    // of the ones that exist today, so an operation added later is caught by
    // this test rather than by whoever is debugging a site full of Singles
    // nobody created.
    const writes = ops.filter(op =>
      /insert|update|delete|upsert|create|drop|alter|execute|transaction/i.test(
        op
      )
    );
    expect(writes).toEqual([]);
  });

  it("actually reached the database, so the assertion above is not vacuous", async () => {
    // The positive control. "No writes were issued" is satisfied perfectly by a
    // call that issued NOTHING — a registry that threw early, a double wired to
    // the wrong method, a listing short-circuited before it queried. Without
    // this, the test above passes against all three.
    const { adapter, ops } = recordingAdapter();
    const registry = new SingleRegistryService(adapter, silentLogger);

    await wrapSinglesForPlugin(registry).list();

    expect(ops).toContain("select");
  });
});

describe("the context's service names and the resolver that answers them", () => {
  it("names every service the context may ask for", () => {
    // Pinned exhaustively because this list is the contract BETWEEN the context
    // and whatever resolver is passed to it. A member added here without a
    // matching case stops the resolver compiling, which is the guard; this test
    // is what makes the list itself deliberate rather than incidental.
    expect([...PLUGIN_SERVICE_NAMES]).toEqual([
      "collectionService",
      "userService",
      "mediaService",
      "emailService",
      "versionsService",
      "singleRegistryService",
      "db",
      "logger",
      "config",
    ]);
  });

  it("exposes singles by ACCESSING the property, not by listing keys", () => {
    // The assertion that was missing, and its absence is why a broken feature
    // shipped green: `Object.keys(ctx.services)` reports a getter WITHOUT
    // invoking it, so an enumeration passes while every real read throws
    // `Unknown service`. Reading the property is the whole point.
    const asked: string[] = [];
    const registry = { listSingles: async () => ({ data: [], total: 0 }) };
    const getServiceFn = ((name: string) => {
      asked.push(name);
      if (name === "singleRegistryService") return registry;
      if (name === "config") return { plugins: [] };
      return {};
    }) as unknown as Parameters<typeof createPluginContext>[0];

    const ctx = createPluginContext(getServiceFn, hookRegistryDouble());

    // The ACCESS is the test. A getter wired to a name nothing provides throws
    // here and cannot throw during an enumeration.
    expect(typeof ctx.services.singles.list).toBe("function");
    expect(asked).toContain("singleRegistryService");
  });
});

describe("the published record says what the registry can actually return", () => {
  /**
   * A registry row as it really comes back: timestamps normalised to strings
   * and cast to `Date` by the deserializer, `admin` round-tripped through JSON
   * so its `preview.url` function is gone. Built to mirror the runtime value,
   * not the declared type — the gap between those two is the whole subject.
   */
  function rowAsStored() {
    return {
      id: "s1",
      slug: "homepage",
      label: "Homepage",
      tableName: "single_homepage",
      fields: [{ name: "content", type: "blocks" }],
      source: "code",
      // `normalizeDbTimestamp` returns `string | null`; the registry casts the
      // result to `Date` with `as unknown as Date`.
      createdAt: "2026-08-24T20:00:00.000Z",
      updatedAt: "2026-08-24T21:00:00.000Z",
      // Survived JSON, so `preview.url` — declared `(doc) => string | null` —
      // is not here any more.
      admin: { preview: {} },
      schemaVersion: 1,
      migrationStatus: "applied",
    };
  }

  async function listOne() {
    const registry = {
      listSingles: async () => ({ data: [rowAsStored()], total: 1 }),
    } as unknown as SingleRegistryService;
    const result = await wrapSinglesForPlugin(registry).list();
    return result.data[0]!;
  }

  it("reports timestamps as the strings they are", async () => {
    // `DynamicSingleRecord` declares these `Date`, and the value is a string,
    // so `record.createdAt.getTime()` compiled and threw. Asserting the TYPE
    // of the value rather than its content: the content was never wrong.
    const record = await listOne();

    expect(typeof record.createdAt).toBe("string");
    expect(record.createdAt).toBe("2026-08-24T20:00:00.000Z");
  });

  it("converts a timestamp that arrives as a Date, rather than passing it on", async () => {
    // The assertion above does NOT separate a projection from a pass-through:
    // its fixture already holds a string, so forwarding the row untouched
    // satisfies it. `normalizeDbTimestamp` is typed `unknown -> string | null`
    // and the registry's own deserializer types the raw column as
    // `Date | string | number`, so a Date reaching here is a shape the code
    // already admits — and it is the one that makes the conversion do work.
    const registry = {
      listSingles: async () => ({
        data: [
          { ...rowAsStored(), createdAt: new Date("2026-01-02T03:04:05Z") },
        ],
        total: 1,
      }),
    } as unknown as SingleRegistryService;

    const [record] = (await wrapSinglesForPlugin(registry).list()).data;

    // ISO, not `Date.prototype.toString()`. The same column yields ISO text
    // when a driver hands back a string, so a `String(date)` conversion would
    // make the published FORMAT depend on which dialect answered — different
    // shape, same field, no error anywhere.
    expect(record!.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("reports an unreadable timestamp as absent rather than as text", async () => {
    // `String(value)` on an object produces "[object Object]" — a string that
    // looks like data and is not, and one a caller cannot tell from a real
    // timestamp. Null is visible; mangled text is not.
    const registry = {
      listSingles: async () => ({
        data: [{ ...rowAsStored(), createdAt: { nested: true } }],
        total: 1,
      }),
    } as unknown as SingleRegistryService;

    const [record] = (await wrapSinglesForPlugin(registry).list()).data;

    expect(record!.createdAt).toBeNull();
  });

  it("keeps a null timestamp null instead of stringifying it", async () => {
    // The other side of the same conversion. `normalizeDbTimestamp` returns
    // `string | null`, and a naive `String(value)` turns the null half into the
    // four-character string "null" — which is truthy, parses as a date to
    // `Invalid Date`, and is worse than the absence it replaced.
    const registry = {
      listSingles: async () => ({
        data: [{ ...rowAsStored(), createdAt: null }],
        total: 1,
      }),
    } as unknown as SingleRegistryService;

    const [record] = (await wrapSinglesForPlugin(registry).list()).data;

    expect(record!.createdAt).toBeNull();
  });

  it("does not carry `admin`, whose preview URL cannot survive storage", async () => {
    // `SinglePreviewConfig.url` is `(document) => string | null`. It is read
    // back through `JSON.parse`, so a plugin calling it gets a TypeError from a
    // member the type promised was callable. Absent beats present-and-broken.
    const record = await listOne();

    expect(record).not.toHaveProperty("admin");
  });

  it("publishes exactly the members it can honour", async () => {
    // Pinned exhaustively, and this is the assertion that outlives the two
    // above. They cover the members that were wrong TODAY; this one fails when
    // a member is added, which is how both of those arrived — inherited from
    // the registry record without anyone deciding they belonged.
    const record = await listOne();

    expect(Object.keys(record).sort()).toEqual([
      "createdAt",
      "description",
      "fields",
      "id",
      "label",
      "slug",
      "source",
      "updatedAt",
    ]);
  });
});
