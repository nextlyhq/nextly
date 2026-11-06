// The lazy singles runtime-table registration. Three behaviours are pinned
// here: a resolver miss registers from the row (the multi-worker gap this
// exists for); a registration made by boot/create-time/the reconcile is
// ADOPTED, never overridden on first touch (they build from config, this
// builds from the row, and the row can lag); and a row that moves after
// this helper accounted for the table re-registers main + companion. A
// broken resolver degrades to a no-op instead of throwing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

// Readiness is a question about the physical database — whether the companion
// table exists yet — answered upstream by introspecting the live schema.
// Driving it directly states which case each test is in, instead of encoding
// it in a fake that has to survive real introspection.
vi.mock("../../i18n/runtime/companion-readiness", () => ({
  resolveCompanionReadiness: vi.fn(async () => "ready"),
}));

import { resolveCompanionReadiness } from "../../i18n/runtime/companion-readiness";
import { ensureSingleRuntimeTable } from "./ensure-runtime-table";

const readiness = vi.mocked(resolveCompanionReadiness);

beforeEach(() => {
  // The migrated steady state, which is what most of these tests assume.
  readiness.mockResolvedValue("ready");
});

/** Minimal adapter double: a dialect and a Map-backed resolver. */
function makeAdapter(prefill?: Record<string, unknown>) {
  const tables = new Map<string, unknown>(Object.entries(prefill ?? {}));
  const registered: string[] = [];
  const adapter = {
    dialect: "sqlite",
    tableResolver: {
      getTable: (name: string) => tables.get(name) ?? null,
      registerDynamicSchema: (name: string, table: unknown) => {
        tables.set(name, table);
        registered.push(name);
      },
    },
  } as unknown as DrizzleAdapter;
  return { adapter, tables, registered };
}

const localizedMeta = {
  slug: "test-page",
  tableName: "single_test_page",
  fields: [
    { name: "title", type: "text" }, // text-like → localized by default
    { name: "views", type: "number" }, // shared → stays on main
  ],
  status: true,
  localized: true,
};

describe("ensureSingleRuntimeTable", () => {
  it("registers the main table and companion on a resolver miss", async () => {
    const { adapter, tables, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([
      "single_test_page",
      "single_test_page_locales",
    ]);
    expect(tables.get("single_test_page")).toBeTruthy();
    expect(tables.get("single_test_page_locales")).toBeTruthy();
  });

  it("omits translatable columns from the lazily registered main table", async () => {
    const { adapter, tables } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    const main = tables.get("single_test_page") as Record<string, unknown>;
    // Drizzle tables expose columns as own properties: the shared field is a
    // column, the translatable one is not (it lives on the companion).
    expect(main.views).toBeTruthy();
    expect(main.title).toBeUndefined();
  });

  it("registers nothing on a repeat call with an unchanged shape", async () => {
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    const afterFirst = registered.length;
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    await ensureSingleRuntimeTable(adapter, { ...localizedMeta });
    expect(registered.length).toBe(afterFirst);
  });

  it("adopts a registration made elsewhere instead of overriding it", async () => {
    // Boot / create-time / the HMR reconcile build from the CONFIG; this
    // helper builds from the ROW, and the row can lag. A registration this
    // helper did not make is left in place on first touch.
    const sentinel = { already: true };
    const companionSentinel = { alsoAlready: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
      single_test_page_locales: companionSentinel,
    });
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual([]);
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("still catches a row change that lands after adopting a foreign registration", async () => {
    // Adopting records the baseline, so the localization toggle another
    // worker performs later is detected on the next read.
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
      single_test_page_locales: sentinel,
    });
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 3,
    });
    expect(registered).toEqual([]);

    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 4,
    });
    expect(registered).toContain("single_test_page");
    expect(tables.get("single_test_page")).not.toBe(sentinel);
  });

  it("backfills only the missing companion, leaving a foreign main table", async () => {
    // A localized row whose companion is not registered does NOT prove the
    // foreign registration predates the enable: the supported pre-migration
    // window looks exactly the same, and there the translatable columns are
    // still on the main table and must stay reachable. Re-deriving main as
    // localized would drop them from the runtime shape and lose the write,
    // so the foreign registration is adopted and only the companion added.
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
    });
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    expect(registered).toEqual(["single_test_page_locales"]);
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("still adopts a foreign NON-localized registration untouched", async () => {
    const sentinel = { already: true };
    const { adapter, registered, tables } = makeAdapter({
      single_test_page: sentinel,
    });
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      localized: false,
    });
    expect(registered).toEqual([]);
    expect(tables.get("single_test_page")).toBe(sentinel);
  });

  it("uses schemaVersion as the signature when the row carries one", async () => {
    // The cheap key: the same saves that change the field set bump it, so
    // an unchanged version short-circuits without stringifying the fields.
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 7,
    });
    const afterFirst = registered.length;
    // Different field payload, same version → treated as unchanged.
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 7,
      fields: [{ name: "totally", type: "text" }],
    });
    expect(registered.length).toBe(afterFirst);

    // Bumped version → re-registered.
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      schemaVersion: 8,
    });
    expect(registered.length).toBeGreaterThan(afterFirst);
  });

  it("re-registers when a storage-affecting field OPTION changes (same type)", async () => {
    // The column generator branches on more than name/type — a relationship
    // flipping to hasMany stores JSON instead of an FK column — so the
    // signature must move when any field property does.
    const relMeta = {
      ...localizedMeta,
      localized: false,
      fields: [{ name: "author", type: "relationship", relationTo: "users" }],
    };
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, relMeta);
    const afterFirst = registered.length;
    await ensureSingleRuntimeTable(adapter, {
      ...relMeta,
      fields: [
        {
          name: "author",
          type: "relationship",
          relationTo: "users",
          hasMany: true,
        },
      ],
    });
    expect(registered.length).toBeGreaterThan(afterFirst);
  });

  it("re-registers when the row's shape changes (localization toggled)", async () => {
    const { adapter, registered, tables } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      localized: false,
    });
    // Non-localized: the full field set lives on the main table.
    const before = tables.get("single_test_page") as Record<string, unknown>;
    expect(before.title).toBeTruthy();

    // Another worker enables localization: the row now says localized and
    // the physical main table no longer carries the translatable column.
    await ensureSingleRuntimeTable(adapter, localizedMeta);
    const after = tables.get("single_test_page") as Record<string, unknown>;
    expect(after.title).toBeUndefined();
    expect(registered).toContain("single_test_page_locales");
  });

  it("registers no companion for a non-localized single", async () => {
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, {
      ...localizedMeta,
      localized: false,
    });
    expect(registered).toEqual(["single_test_page"]);
  });

  it("is a no-op when the adapter has no resolver", async () => {
    const adapter = { dialect: "sqlite" } as unknown as DrizzleAdapter;
    await expect(
      ensureSingleRuntimeTable(adapter, localizedMeta)
    ).resolves.toBeUndefined();
  });

  it("swallows registration failures but leaves a trace for the next reader", async () => {
    const adapter = {
      dialect: "sqlite",
      tableResolver: {
        getTable: () => null,
        registerDynamicSchema: () => {
          throw new Error("registry exploded");
        },
      },
    } as unknown as DrizzleAdapter;
    const debug = vi.fn();
    const logger = {
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    await expect(
      ensureSingleRuntimeTable(adapter, localizedMeta, logger)
    ).resolves.toBeUndefined();
    // Degrading is intended; degrading silently is what hid the original
    // registration gap.
    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[1]).toMatchObject({
      tableName: "single_test_page",
      error: "registry exploded",
    });
  });
});

// The pre-migration window: the row says localized, but `nextly migrate` has
// not run, so the companion does not physically exist and the translatable
// columns are STILL on the main table. Registering main as localized there
// omits exactly those columns from the runtime shape, so reads drop them and
// a default-locale write has nothing to target — the values are lost with no
// error. Which shape to build is therefore a question about the database, not
// about what the resolver happens to hold.
describe("ensureSingleRuntimeTable — pre-migration window", () => {
  it("keeps translatable columns on main while the companion is absent", async () => {
    readiness.mockResolvedValue("pre-migration");
    const { adapter, tables, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, localizedMeta);

    const main = tables.get("single_test_page") as Record<string, unknown>;
    // Both columns, because both are physically on the main table here.
    expect(main.views).toBeTruthy();
    expect(main.title).toBeTruthy();
    // And no companion is registered: giving the read path a table the
    // database cannot answer for would turn a recoverable window into an
    // error on every localized read.
    expect(registered).toEqual(["single_test_page"]);
  });

  it("moves them to the companion once it exists", async () => {
    const { adapter, tables, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, localizedMeta);

    const main = tables.get("single_test_page") as Record<string, unknown>;
    expect(main.views).toBeTruthy();
    expect(main.title).toBeUndefined();
    expect(registered).toEqual([
      "single_test_page",
      "single_test_page_locales",
    ]);
  });
});

// A write in production to a Single this instance did not register at boot or
// create time is refused rather than recovered: the instance predates the
// deploy that added or changed the Single, so its code may not match what the
// database now holds. Reads keep recovering, and development keeps recovering
// both, since a second dev worker or an HMR reload is the case the recovery
// exists for.
describe("ensureSingleRuntimeTable — writes in production", () => {
  const meta = { ...localizedMeta, localized: false };
  const write = { intent: "write" } as const;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (error: unknown) => error
    );

  it("refuses a write on a resolver miss, naming the table, and registers nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, registered } = makeAdapter();
    const error = await refusal(
      ensureSingleRuntimeTable(adapter, meta, undefined, write)
    );
    expect(error).toMatchObject({ code: "NEXTLY_TABLE_NOT_REGISTERED" });
    expect((error as Error).message).toContain('"single_test_page"');
    expect(registered).toEqual([]);
  });

  it("recovers the same write in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, meta, undefined, write);
    expect(registered).toEqual(["single_test_page"]);
  });

  it("still registers for a read, and refuses a write after it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, meta);
    expect(registered).toEqual(["single_test_page"]);
    const error = await refusal(
      ensureSingleRuntimeTable(adapter, meta, undefined, write)
    );
    expect(error).toMatchObject({ code: "NEXTLY_TABLE_NOT_REGISTERED" });
  });

  it("lets a write through to a table boot or create time registered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, registered } = makeAdapter({
      single_test_page: { foreign: true },
    });
    await ensureSingleRuntimeTable(adapter, meta, undefined, write);
    expect(registered).toEqual([]);
  });

  it("keeps letting writes through after it rebuilds a table boot registered", async () => {
    // This instance changed the Single's fields (the Builder in production):
    // the row moves on, and the next touch rebuilds a registration that was
    // never a recovery.
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, registered } = makeAdapter({
      single_test_page: { foreign: true },
    });
    await ensureSingleRuntimeTable(adapter, { ...meta, schemaVersion: 1 });
    const moved = { ...meta, schemaVersion: 2 };
    await ensureSingleRuntimeTable(adapter, moved);
    expect(registered).toEqual(["single_test_page"]);
    for (const attempt of [1, 2]) {
      await expect(
        ensureSingleRuntimeTable(adapter, moved, undefined, write),
        `write ${attempt}`
      ).resolves.toBeUndefined();
    }
  });

  it("still refuses a write after it rebuilds a table only a read recovered", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, registered } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, { ...meta, schemaVersion: 1 });
    const moved = { ...meta, schemaVersion: 2 };
    await ensureSingleRuntimeTable(adapter, moved);
    expect(registered).toEqual(["single_test_page", "single_test_page"]);
    const error = await refusal(
      ensureSingleRuntimeTable(adapter, moved, undefined, write)
    );
    expect(error).toMatchObject({ code: "NEXTLY_TABLE_NOT_REGISTERED" });
  });

  it("lets a write through once a registration of its own replaces the read's", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { adapter, tables } = makeAdapter();
    await ensureSingleRuntimeTable(adapter, meta);
    // A reload after a migration registers the table again, from config.
    tables.set("single_test_page", { reloaded: true });
    await expect(
      ensureSingleRuntimeTable(adapter, meta, undefined, write)
    ).resolves.toBeUndefined();
  });
});
