/**
 * An adapter the application built itself carries its own `schema` option,
 * and `db.postgres.schema` is a second answer to the same question. Boot must
 * hold the two to one answer rather than publish the config's while the
 * adapter's `search_path` points elsewhere.
 *
 * Driven through `registerServices` rather than the helper, because the claim
 * is that BOOT asks — a correct helper nothing calls is the failure this is
 * here to catch. The fake adapter is too thin to finish registration, so every
 * boot rejects; what separates the cases is WHICH rejection, and whether the
 * schema was published before it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";

vi.mock("../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

/**
 * The schema first-run's push introspected, one entry per push.
 *
 * Read from the active value AT THE CALL, which is what the real push hands
 * drizzle-kit: that is the moment the order of boot decides the outcome.
 */
const schemasPushedInto: string[] = [];

vi.mock("../../domains/schema/pipeline/fresh-push", async () => {
  const { activePostgresSchema: active } = await import(
    "../../domains/schema/services/postgres-schema"
  );
  return {
    freshPushSchema: () => {
      schemasPushedInto.push(active());
      return Promise.resolve({ hints: [], statementsExecuted: [] });
    },
  };
});

/**
 * First-run sets up under the schema lock, which the thin adapter below cannot hold. Run the work
 * directly: what this file asserts is the order of publishing and pushing, not the exclusion,
 * which `init/__tests__/first-run-concurrent.integration.test.ts` covers on a real database.
 */
vi.mock("../../domains/schema/pipeline/schema-lock", () => ({
  withSchemaLock: async (_options: unknown, work: () => Promise<unknown>) => ({
    ran: true,
    value: await work(),
  }),
}));

const { registerServices } = await import("../register");
const {
  activePostgresSchema,
  clearActivePostgresSchema,
  setActivePostgresSchema,
} = await import("../../domains/schema/services/postgres-schema");

/**
 * A PostgreSQL adapter reporting `schema`, on a database with no tables.
 *
 * Empty, so first-run setup runs; too thin for anything after it, so boot
 * then rejects. `installedIn` is what the catalogue answers for the schemas
 * holding an installation's history: none, by default, as on a new database.
 */
function postgresAdapter(
  schema: string | undefined,
  installedIn: readonly string[] = []
): Record<string, unknown> {
  return {
    dialect: "postgresql",
    connect: () => undefined,
    getDrizzle: () => ({
      execute: () =>
        Promise.resolve({ rows: installedIn.map(name => ({ schema: name })) }),
    }),
    getCapabilities: () => ({ dialect: "postgresql" }),
    getConfiguredSchema: () => schema,
    setTableResolver: () => undefined,
    tableExists: () => Promise.resolve(false),
    executeQuery: () => Promise.resolve([]),
  };
}

async function bootError(
  adapter: Record<string, unknown>,
  schema: string | undefined
): Promise<unknown> {
  try {
    await registerServices({
      adapter,
      collections: [],
      ...(schema !== undefined ? { db: { postgres: { schema } } } : {}),
    } as unknown as Parameters<typeof registerServices>[0]);
  } catch (error) {
    return error;
  }
  throw new Error("boot completed, which the thin adapter cannot allow");
}

afterEach(() => {
  clearActivePostgresSchema();
  schemasPushedInto.length = 0;
});

describe("the first boot, and where first-run's push looks", () => {
  it("publishes the resolved schema before first-run's push reads it", async () => {
    // A stale value is the failure: whatever an earlier config or process
    // left published is what the push introspects if boot publishes after it.
    // Publishing `public` over a stale value is what separates the two orders.
    setActivePostgresSchema("stale");
    await bootError(postgresAdapter("public"), "public");

    // Non-empty first, so the assertion cannot pass by the push never having
    // been reached.
    expect(schemasPushedInto).toEqual(["public"]);
  });

  it("pushes first-run's tables into a named schema", async () => {
    const error = await bootError(postgresAdapter("cms"), "cms");

    // The thin adapter still fails later; what matters is which rejection.
    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      false
    );
    expect(schemasPushedInto).toEqual(["cms"]);
  });

  it("refuses a setting moved off an existing installation before first-run pushes anything", async () => {
    // The database holds an installation in `public`; the config now names
    // `cms`. Pushing would build a second, empty installation there.
    const error = await bootError(postgresAdapter("cms", ["public"]), "cms");

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      true
    );
    expect((error as NextlyError).publicMessage).toContain('"public"');
    expect((error as NextlyError).publicMessage).toContain('"cms"');
    expect(schemasPushedInto).toEqual([]);
  });

  it("refuses the setting removed from an installation in a named schema", async () => {
    const error = await bootError(postgresAdapter(undefined, ["cms"]), undefined);

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      true
    );
    expect(schemasPushedInto).toEqual([]);
  });

  it("starts a separate installation beside another when the flag allows it", async () => {
    vi.stubEnv("NEXTLY_POSTGRES_SCHEMA_NEW_INSTALL", "1");
    try {
      const error = await bootError(postgresAdapter("cms", ["public"]), "cms");

      expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
        false
      );
      expect(schemasPushedInto).toEqual(["cms"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("starts as usual when the named schema already holds the installation", async () => {
    // Another schema holding one too is a second site sharing the database.
    const error = await bootError(
      postgresAdapter("cms", ["cms", "public"]),
      "cms"
    );

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      false
    );
  });
});

describe("db.postgres.schema against an adapter the application supplied", () => {
  it("refuses an adapter on a schema the config does not name", async () => {
    const error = await bootError(postgresAdapter("tenant"), undefined);

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MISMATCH")).toBe(
      true
    );
    // Refused BEFORE first-run and before publishing: nothing downstream may
    // act on one schema while the adapter writes to another.
    expect(schemasPushedInto).toEqual([]);
  });

  it("refuses it as a mismatch when the config names public explicitly", async () => {
    const error = await bootError(postgresAdapter("tenant"), "public");

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MISMATCH")).toBe(
      true
    );
  });

  it.each([
    ["public", "public"],
    [undefined, "public"],
    ["public", undefined],
    [undefined, undefined],
  ])(
    "accepts an adapter on %s when the config says %s",
    async (adapterSchema, configured) => {
      // The control. Boot still fails later on the thin adapter, so what
      // shows it passed the checks is a different rejection.
      const error = await bootError(postgresAdapter(adapterSchema), configured);

      expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MISMATCH")).toBe(
        false
      );
      expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
        false
      );
      expect(activePostgresSchema()).toBe("public");
    }
  );

  it("leaves a MySQL adapter alone, ignoring the option as before", async () => {
    const error = await bootError(
      {
        connect: () => undefined,
        getDrizzle: () => ({}),
        getCapabilities: () => ({ dialect: "mysql" }),
      },
      "cms"
    );

    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MISMATCH")).toBe(
      false
    );
    expect(NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_MOVED")).toBe(
      false
    );
    expect(activePostgresSchema()).toBe("public");
  });
});
