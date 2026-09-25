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
 * then rejects.
 */
function postgresAdapter(schema: string | undefined): Record<string, unknown> {
  return {
    dialect: "postgresql",
    connect: () => undefined,
    getDrizzle: () => ({}),
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
    // `public` is the only schema accepted today, so staleness is what can
    // separate the two orders here.
    setActivePostgresSchema("stale");
    await bootError(postgresAdapter("public"), "public");

    // Non-empty first, so the assertion cannot pass by the push never having
    // been reached.
    expect(schemasPushedInto).toEqual(["public"]);
  });

  it("refuses a schema other than public before first-run pushes anything", async () => {
    // The push cannot yet create tables in another schema — drizzle-kit reads
    // every desired table as `public` and proposes dropping the configured
    // schema — so the refusal has to land before it runs at all.
    const error = await bootError(postgresAdapter("cms"), "cms");

    expect(
      NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED")
    ).toBe(true);
    expect(schemasPushedInto).toEqual([]);
    expect(activePostgresSchema()).toBe("public");
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
      expect(
        NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED")
      ).toBe(false);
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
    expect(
      NextlyError.isCode(error, "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED")
    ).toBe(false);
    expect(activePostgresSchema()).toBe("public");
  });
});
