/**
 * Handing the default from one email provider to another, on a real database.
 *
 * The ORDER of the two statements a handover is made of is decided by the
 * database, not by this service. PostgreSQL carries a partial unique index over
 * `is_default = true` and checks it as each statement runs, so a row cannot
 * take the default while the incumbent still holds it — the incumbent has to
 * give it up first. MySQL and SQLite carry no such index and accept either
 * order.
 *
 * That is precisely what an in-memory SQLite unit test cannot see. An ordering
 * that passes there fails outright on PostgreSQL, and every path that promotes
 * a provider stops working on the dialect most installations run.
 *
 * PostgreSQL only, and self-skipping without TEST_POSTGRES_URL: it is the one
 * dialect that constrains the order, so it is the one where the constraint can
 * be observed.
 */

import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The adapter is built from TEST_POSTGRES_URL directly, so the real env module
// would only add a second source of connection settings — and it refuses to
// load at all for this dialect without DATABASE_URL. The service reads it for
// one thing: the secret its configuration is encrypted under.
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-that-is-long-enough-for-derivation",
    DB_DIALECT: "postgresql",
    DATABASE_URL: process.env.TEST_POSTGRES_URL,
    NODE_ENV: "test",
  },
}));

import { getCoreSchema } from "../../../schemas";
import { createTableBody } from "../../schema/pipeline/sql-templates/create-table-body";
import { EmailProviderService } from "../services/email-provider-service";

const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? null;

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const suite = POSTGRES_URL ? describe : describe.skip;

suite("email default handover — postgresql", () => {
  let adapter: DrizzleAdapter;
  let service: EmailProviderService;

  const quote = (id: string) => `"${id}"`;

  /**
   * The real table, created only where this run does not already have one.
   *
   * `email_providers` is a fixed-name system table that the migration path and
   * other suites also create, and `email_deliveries.provider_id` references
   * it. Dropping it is therefore not available: PostgreSQL refuses while a
   * dependent object exists, and forcing it with CASCADE would take that
   * foreign key out from under whatever else runs in this sequential pass.
   *
   * So this creates what is missing and removes nothing. The suite isolates
   * itself by emptying ROWS rather than by owning the schema.
   */
  beforeAll(async () => {
    adapter = createPostgresAdapter({
      url: POSTGRES_URL as string,
    }) as unknown as DrizzleAdapter;
    await adapter.connect();

    const { tables } = getCoreSchema("postgresql");
    const spec = tables.find(table => table.name === "email_providers");
    if (!spec) {
      expect.fail("email_providers is absent from the core schema");
    }

    await adapter.executeQuery(
      `CREATE TABLE IF NOT EXISTS ${quote(spec.name)} (\n${createTableBody(spec, quote)}\n)`
    );

    // The partial unique index is what makes the ordering matter, and it is
    // declared in the Drizzle schema rather than in the table body — so a
    // table built from the body alone is a fixture that cannot fail the way
    // production does. Created only if absent, because a run whose schema came
    // from the migration path already has it.
    await adapter.executeQuery(
      `CREATE UNIQUE INDEX IF NOT EXISTS email_providers_default_unique_idx ON ${quote(spec.name)} (is_default) WHERE is_default = true`
    );

    service = new EmailProviderService(adapter, logger);
  });

  afterAll(async () => {
    // Rows, not the table. What this suite created it may empty; what it found
    // it leaves standing for whatever else this sequential pass runs.
    await adapter.executeQuery(`DELETE FROM ${quote("email_providers")}`);
    await adapter.disconnect();
  });

  beforeEach(async () => {
    await adapter.executeQuery(`DELETE FROM ${quote("email_providers")}`);
  });

  function input(name: string, isDefault: boolean) {
    return {
      name,
      type: "smtp" as const,
      fromEmail: "noreply@example.com",
      fromName: null,
      configuration: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "postmaster", pass: "secret-value" },
      },
      isDefault,
      isActive: true,
    };
  }

  /** Every provider the table currently records as the default. */
  async function defaultIds(): Promise<string[]> {
    const providers = await service.listProviders();
    return providers.filter(p => p.isDefault).map(p => p.id);
  }

  it("promotes through setDefault while another provider holds it", async () => {
    const first = await service.createProvider(input("First", true));
    const second = await service.createProvider(input("Second", false));

    await service.setDefault(second.id);

    expect(await defaultIds()).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
  });

  it("promotes through createProvider while another provider holds it", async () => {
    await service.createProvider(input("First", true));
    const second = await service.createProvider(input("Second", true));

    expect(await defaultIds()).toEqual([second.id]);
  });

  it("promotes through updateProvider while another provider holds it", async () => {
    await service.createProvider(input("First", true));
    const second = await service.createProvider(input("Second", false));

    await service.updateProvider(second.id, { isDefault: true });

    expect(await defaultIds()).toEqual([second.id]);
  });

  it("leaves exactly one default after a chain of handovers", async () => {
    // Asserted on the data rather than on the absence of a thrown error: a
    // handover that half-committed satisfies every assertion above while
    // leaving two rows claiming the default, or none at all.
    await service.createProvider(input("First", true));
    const second = await service.createProvider(input("Second", false));
    const third = await service.createProvider(input("Third", false));

    await service.setDefault(second.id);
    await service.updateProvider(third.id, { isDefault: true });
    await service.setDefault(second.id);

    expect(await defaultIds()).toEqual([second.id]);
  });
});
