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
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
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
  return {
    dialect,
    getCapabilities: () => ({ dialect }),
    tableExists: vi.fn().mockResolvedValue(true),
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      return [];
    }),
  };
}

let adapter: ReturnType<typeof makeAdapter>;

vi.mock("../../../di/container", () => ({
  container: {
    // Only the adapter is registered. Permission seeding and every other optional service stay
    // absent so this exercises the DDL path and nothing else.
    has: vi.fn((key: string) => key === "adapter"),
    get: vi.fn((key: string) => (key === "adapter" ? adapter : undefined)),
  },
}));

import {
  getSingleEntryServiceFromDI,
  getSingleRegistryFromDI,
} from "../../helpers/di";
import { dispatchSingles } from "../single-dispatcher";

function wireRegistry() {
  const registry = {
    listSingles: vi.fn(),
    // Answers "no single owns that table" so the create reaches the DDL path.
    getAllSingles: vi.fn().mockResolvedValue([]),
    getSingleBySlug: vi.fn(),
    registerSingle: vi.fn(async (row: unknown) => row),
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
  return registry;
}

/** Everything the adapter was asked to run, as one string. */
async function ddlFor(
  payload: Record<string, unknown>,
  dialect: "postgresql" | "mysql" | "sqlite" = "postgresql"
): Promise<string> {
  executed.length = 0;
  adapter = makeAdapter(dialect);
  wireRegistry();
  await dispatchSingles("createSingle", {}, payload);
  return executed.join("\n");
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
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

    const sql = await ddlFor(localized);

    expect(sql).not.toContain("body");
    // The non-translatable field stays on the main table.
    expect(sql).toContain("views");
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
