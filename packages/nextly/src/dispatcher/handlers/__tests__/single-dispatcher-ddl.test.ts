/**
 * What a create REQUEST turns into on the way to the database, recorded from the request in.
 *
 * The generators' own output is pinned elsewhere, per set of options. That records what each
 * generator RENDERS and cannot record what a caller PASSES: a handler that stops forwarding
 * `localized`, `hasStatus` or the adapter's dialect still reaches every one of those assertions with
 * the options spelled out correctly, and they all still pass.
 *
 * So these drive the dispatcher with a request-shaped payload and assert on the SQL the adapter is
 * actually handed. That is the half no snapshot can cover, and it is the half a change which moves
 * this code somewhere else can silently break.
 *
 * Deliberately a separate file from `single-dispatcher-shapes.test.ts`, which defeats both halves on
 * purpose: it replaces the schema service with a stub returning `""` and reports no adapter, because
 * it is testing response envelopes rather than DDL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
  // Reached by the companion reconciliation a localized create runs. Omitted, calling it throws and
  // the handler catches that as a companion-provisioning failure — so the assertions below would
  // describe a FAILED migration while passing.
  getConfigFromDI: vi.fn(() => undefined),
  // Reached by the companion's runtime registration. Answering `undefined` is what a server with no
  // schema registry does; omitting it throws inside the registration instead, which is a different
  // path and not one a create ever takes.
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

const executed: string[] = [];

/**
 * The adapter surface a create actually touches: the dialect it reports decides which DDL is
 * generated, `tableExists` decides whether the create is recorded as applied, and every statement
 * passes through `executeQuery`.
 *
 * `tableResolver` is deliberately absent. The handler reads it defensively, so leaving it out skips
 * runtime re-registration and keeps this focused on the statements.
 */
function makeAdapter(dialect: "postgresql" | "mysql" | "sqlite") {
  // A single's schema change runs inside the storage migration's lock, so the double has to answer
  // the lock's reads and writes as well as its own. Added rather than stubbed: a surface that let
  // every claim succeed would certify an exclusion that is not there.
  return withMigrationLockSurface({
    dialect,
    getCapabilities: () => ({ dialect }),
    // Answers the way a fresh create finds the database: the main table is there once its CREATE
    // has run, and the companion is NOT — so the companion path CREATEs it rather than altering
    // one that does not exist. A blanket `true` here made the companion look pre-existing, which
    // is not a state a create ever starts from.
    tableExists: vi.fn(async (name: string) => !name.includes("_locales")),
    // Read by the slug guard the create runs before any DDL, to find whether another resource
    // already owns this slug. `null` is "nobody does", which is the state a successful create
    // starts from. The return type names the owner case too, so the conflict test can replace this
    // without widening the double's shape from outside it.
    selectOne: vi.fn(async (): Promise<{ id: string } | null> => null),
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      return [];
    }),
  });
}

let adapter: ReturnType<typeof makeAdapter>;

vi.mock("../../../di/container", () => ({
  container: {
    // The adapter, plus a config carrying a `localization` block: creating a
    // localized single is refused without one, so the localized cases below
    // would never reach the DDL they are asserting on. Permission seeding and
    // every other optional service stay absent so this exercises the DDL path
    // and nothing else.
    has: vi.fn((key: string) => key === "adapter" || key === "config"),
    get: vi.fn((key: string) => {
      if (key === "adapter") return adapter;
      if (key === "config")
        return { localization: { locales: ["en"], defaultLocale: "en" } };
      return undefined;
    }),
  },
}));

import { withMigrationLockSurface } from "../../../domains/field-groups/migration/__tests__/helpers/migration-lock-double";
import { SingleMetadataService } from "../../../domains/singles/services/single-metadata-service";
import type { SingleRegistryService } from "../../../domains/singles/services/single-registry-service";
import type { Logger } from "../../../shared/types";
import {
  getSingleEntryServiceFromDI,
  getSingleMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchSingles } from "../single-dispatcher";

/** Silent: these tests read the statements, not the log. */
const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function wireRegistry() {
  const registry = {
    listSingles: vi.fn(),
    // Answers "no single owns that table" so the create reaches the DDL path.
    getAllSingles: vi.fn().mockResolvedValue([]),
    getSingleBySlug: vi.fn(),
    registerSingle: vi.fn(async (row: unknown) => row),
    // The confirm write. A create persists its intent as `pending` before touching the table and
    // records the outcome here afterwards, so a double without it fails the whole create.
    updateMigrationStatus: vi.fn(),
    updateSingle: vi.fn(),
    deleteSingle: vi.fn(),
  };
  vi.mocked(getSingleRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getSingleRegistryFromDI>
  );
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue({
    get: vi.fn(),
    update: vi.fn(),
  } as unknown as ReturnType<typeof getSingleEntryServiceFromDI>);
  // The REAL service over the same doubles, because the create path's behaviour IS this service's
  // behaviour: what the request forwards into the DDL is decided inside it, and a stub standing in
  // for it would leave these assertions describing the stub.
  vi.mocked(getSingleMetadataServiceFromDI).mockReturnValue(
    new SingleMetadataService(
      registry as unknown as SingleRegistryService,
      logger,
      adapter as unknown as ConstructorParameters<
        typeof SingleMetadataService
      >[2]
    )
  );
  return registry;
}

/**
 * Everything the adapter was asked to run, as one string.
 *
 * 🔴 The create's OWN recorded outcome is checked before any of it is returned, and that check is
 * here rather than in each test because it is a precondition of the entire file: statements that
 * ran on the way to a failure prove nothing about what a working create emits. Breaking a rule
 * shows a test CAN fail; it does not show the code reached the state the test describes. A create
 * that gave up part-way still leaves its earlier statements in `executed`, so every assertion below
 * would keep passing while describing a run that never finished.
 *
 * `migration_status` is the product's own success signal — the value the admin reads back — so
 * nothing is computed here that does not already exist, and a regression names itself:
 * `expected 'failed' to be 'applied'`.
 */
async function ddlFor(
  payload: Record<string, unknown>,
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
): Promise<string> {
  executed.length = 0;
  adapter = makeAdapter(dialect);
  const registry = wireRegistry();
  await dispatchSingles("createSingle", {}, payload);

  const recorded = (
    registry.registerSingle.mock.calls[0]?.[0] as
      | { migrationStatus?: string }
      | undefined
  )?.migrationStatus;
  expect(recorded, "the create recorded its own outcome").toBe("applied");

  return executed.join("\n");
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
  vi.mocked(getSingleMetadataServiceFromDI).mockReset();
});

describe("createSingle — what the request forwards into the DDL", () => {
  const base = {
    slug: "page",
    label: "Page",
    fields: [
      { name: "body", type: "text" },
      { name: "views", type: "number" },
    ],
  };

  it("creates the table the request names, with its fields", async () => {
    const sql = await ddlFor(base);

    expect(sql).toContain("single_page");
    expect(sql).toContain("body");
    expect(sql).toContain("views");
  });

  /**
   * A single gets no owner column.
   *
   * 🔴 This does NOT cover the forwarding of `isSingle`, and must not be read as if it did.
   * `generateMigrationSQL` takes the single branch for any table whose name begins with `single_`,
   * whatever that option says — so dropping it entirely leaves every assertion in this file
   * passing. Verified by removing it: 6 passed.
   *
   * Kept because the property is worth pinning on its own, renamed because the previous name
   * claimed a guarantee the assertion cannot make. A relocation cannot break `isSingle` through
   * this path; the table name decides.
   */
  it("gives a single no owner column", async () => {
    const sql = await ddlFor(base);

    expect(sql).not.toContain("created_by");
  });

  // Draft/Published has to reach the generator, or the runtime schema expects a column the DDL
  // never created.
  it("emits the status column only when the request asks for it", async () => {
    expect(await ddlFor({ ...base, status: true })).toContain("status");
    expect(await ddlFor(base)).not.toContain("status");
  });

  /**
   * A localized single keeps its translatable columns in the companion `_locales` table, so the
   * main CREATE must omit them. Forwarding this wrongly leaves two homes for one value and the
   * companion holding nothing — and every generator snapshot still passes, because they are called
   * with `localized` spelled out.
   */
  it("omits translatable columns from the main table when localized", async () => {
    const localized = {
      ...base,
      localized: true,
      fields: [
        { name: "body", type: "text", localized: true },
        { name: "views", type: "number" },
      ],
    };

    await ddlFor(localized);

    // Scoped to the statement that creates each table. The companion's own CREATE legitimately
    // names the translatable column, so asserting over all the SQL either contradicts that or
    // passes only because the companion never ran.
    const mainCreate = executed.find(
      s =>
        s.includes("CREATE TABLE") &&
        s.includes("single_page") &&
        !s.includes("_locales")
    );
    const companionCreate = executed.find(
      s => s.includes("CREATE TABLE") && s.includes("single_page_locales")
    );

    expect(mainCreate, "the main table is created").toBeDefined();
    expect(companionCreate, "the companion is created").toBeDefined();

    expect(mainCreate).not.toContain("body");
    // The non-translatable field stays on the main table.
    expect(mainCreate).toContain("views");
    // And the translatable one is on the companion — proving it MOVED rather than was dropped.
    expect(companionCreate).toContain("body");
  });

  /**
   * A slug another resource already owns is refused with NOTHING created.
   *
   * The registry makes this check too, but it makes it while inserting the row, which happens after
   * the table has been created. A create rejected there answered with a duplicate error and left
   * `single_<slug>` behind, described by nothing and found only by guessing at table names.
   *
   * Asserting the rejection alone would not cover it: the rejection happened before this change as
   * well, just later. What is new is that no statement runs, so that is what is asserted.
   */
  it("refuses a slug another resource owns before running any DDL", async () => {
    executed.length = 0;
    adapter = makeAdapter("postgresql");
    // A dynamic collection already holds this slug. The guard reads the two registry tables in
    // turn, so answering every lookup is enough to make the first one own it.
    adapter.selectOne = vi.fn(async () => ({ id: "col_1" }));
    wireRegistry();

    await expect(dispatchSingles("createSingle", {}, base)).rejects.toThrow();

    expect(executed, "a rejected create must leave no table behind").toEqual(
      []
    );
  });

  /**
   * The dialect comes from the adapter that will run the statements, never from the service's own
   * default. That default is `postgresql` and the environment variable behind it is optional, so an
   * app configured with only a MySQL URL would otherwise have its table created as PostgreSQL.
   */
  it.each([
    ["mysql", "`single_page`"],
    ["postgresql", '"single_page"'],
  ] as const)(
    "generates for the adapter's dialect (%s)",
    async (dialect, quoted) => {
      const sql = await ddlFor(base, dialect);

      expect(sql).toContain(quoted);
    }
  );
});
