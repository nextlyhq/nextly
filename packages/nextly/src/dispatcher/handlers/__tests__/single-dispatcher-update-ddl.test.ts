/**
 * What an UPDATE request turns into on the way to the database, recorded from the request in.
 *
 * The sibling `single-dispatcher-ddl.test.ts` does this for creates and says why: a generator
 * snapshot records what a generator RENDERS and cannot record what a caller PASSES, so a handler
 * that stops forwarding `localized`, `hasStatus` or the adapter's dialect still reaches every one
 * of those assertions and they all still pass. The update path had no equivalent — its only unit
 * coverage replaces the schema service with a stub returning `""` because it is testing response
 * envelopes — so nothing observed the statements an update actually emits.
 *
 * These drive the dispatcher with a request-shaped payload and assert on what the adapter is
 * handed, plus where a failure is allowed to surface. The second half is the part with teeth: an
 * update decides, from the phase it fails in, whether to raise the error or record it against a
 * row, and both outcomes look like "the save did not work" from outside.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../helpers/di", () => ({
  getSingleRegistryFromDI: vi.fn(),
  getSingleEntryServiceFromDI: vi.fn(),
  getSingleMetadataServiceFromDI: vi.fn(),
  getComponentRegistryFromDI: vi.fn().mockReturnValue(undefined),
  getAdapterFromDI: vi.fn(),
  // Reached by the companion reconciliation a localized update runs. Omitted, calling it throws
  // and the update records a companion-provisioning failure — so the assertions below would
  // describe a FAILED migration while passing.
  getConfigFromDI: vi.fn(() => undefined),
  getSchemaRegistryFromDI: vi.fn(() => undefined),
}));

const executed: string[] = [];

/**
 * The adapter surface an update touches.
 *
 * `tableExists` is what the plan asks to decide between altering the table and rebuilding it, so
 * it is a per-test input rather than a constant: answering `false` for the main table is how a
 * single whose earlier create failed reaches the rebuild path.
 */
function makeAdapter(
  dialect: "postgresql" | "mysql" | "sqlite",
  options: {
    mainTableExists?: boolean;
    onStatement?: (sql: string) => void;
  } = {}
) {
  const { mainTableExists = true, onStatement } = options;
  return {
    dialect,
    getCapabilities: () => ({ dialect }),
    tableExists: vi.fn(async (name: string) =>
      name.includes("_locales") ? false : mainTableExists
    ),
    selectOne: vi.fn(async (): Promise<{ id: string } | null> => null),
    getDrizzle: vi.fn(() => ({})),
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      onStatement?.(sql);
      return [];
    }),
  };
}

let adapter: ReturnType<typeof makeAdapter>;

vi.mock("../../../di/container", () => ({
  container: {
    has: vi.fn((key: string) => key === "adapter" || key === "config"),
    get: vi.fn((key: string) => {
      if (key === "adapter") return adapter;
      if (key === "config")
        return { localization: { locales: ["en"], defaultLocale: "en" } };
      return undefined;
    }),
  },
}));

// The live-table facts the ALTER generator reads. Doubled because the real readers issue dialect
// specific catalog queries against a database that is not there, and what this file is recording is
// the statements the update EMITS, not how those facts are gathered.
vi.mock("../../../domains/schema/pipeline/live-table-facts", () => ({
  tableHasRows: vi.fn(async () => false),
  readForeignKeyColumns: vi.fn(async () => new Map<string, string[]>()),
  readIndexNames: vi.fn(async () => new Set<string>()),
}));

import { NextlyError } from "../../../errors";
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
  warn: vi.fn((...a: unknown[]) => console.log("LOGWARN", ...a)),
  error: vi.fn((...a: unknown[]) => console.log("LOGERR", ...a)),
};

/** The registry row an update starts from: a single that already exists and is not locked. */
function existingSingle(overrides: Record<string, unknown> = {}) {
  return {
    id: "single-1",
    slug: "page",
    label: "Page",
    tableName: "single_page",
    fields: [{ name: "heading", type: "text" }],
    locked: false,
    status: false,
    localized: false,
    migrationStatus: "applied",
    ...overrides,
  };
}

function wireRegistry(existing: Record<string, unknown>) {
  const registry = {
    listSingles: vi.fn(),
    getAllSingles: vi.fn().mockResolvedValue([]),
    getSingleBySlug: vi.fn(async () => existing),
    registerSingle: vi.fn(async (row: unknown) => row),
    updateMigrationStatus: vi.fn(),
    updateSingle: vi.fn(
      async (slug: string, data: Record<string, unknown>) => ({
        ...existing,
        ...data,
      })
    ),
    deleteSingle: vi.fn(),
  };
  vi.mocked(getSingleRegistryFromDI).mockReturnValue(
    registry as unknown as ReturnType<typeof getSingleRegistryFromDI>
  );
  vi.mocked(getSingleEntryServiceFromDI).mockReturnValue({
    get: vi.fn(),
    update: vi.fn(),
  } as unknown as ReturnType<typeof getSingleEntryServiceFromDI>);
  // The REAL service over the same doubles: what an update forwards into the DDL is decided inside
  // it, so a stub standing in for it would leave these assertions describing the stub.
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
 * Drive one update and hand back both halves of what it did.
 *
 * The recorded status is returned rather than asserted here, because unlike the create file these
 * tests deliberately cover the failing outcomes too — a shared precondition demanding "applied"
 * would make half of them unwritable.
 */
async function runUpdate(
  payload: Record<string, unknown>,
  options: {
    dialect?: "postgresql" | "mysql" | "sqlite";
    existing?: Record<string, unknown>;
    mainTableExists?: boolean;
    onStatement?: (sql: string) => void;
  } = {}
) {
  const {
    dialect = "postgresql",
    mainTableExists = true,
    onStatement,
  } = options;
  executed.length = 0;
  adapter = makeAdapter(dialect, { mainTableExists, onStatement });
  const registry = wireRegistry(options.existing ?? existingSingle());
  const result = await dispatchSingles(
    "updateSingleSchema",
    { slug: "page" },
    payload
  );
  const written = registry.updateSingle.mock.calls[0]?.[1] as
    | { migrationStatus?: string }
    | undefined;
  return { registry, result, sql: executed.join("\n"), written };
}

beforeEach(() => {
  vi.mocked(getSingleRegistryFromDI).mockReset();
  vi.mocked(getSingleEntryServiceFromDI).mockReset();
  vi.mocked(getSingleMetadataServiceFromDI).mockReset();
});

describe("updateSingleSchema — what the request forwards into the DDL", () => {
  it("alters the existing table for a field the single did not have", async () => {
    const { sql, written } = await runUpdate({
      fields: [
        { name: "heading", type: "text" },
        { name: "subtitle", type: "text" },
      ],
    });

    expect(sql).toMatch(/ALTER TABLE/i);
    expect(sql).toMatch(/subtitle/);
    expect(written?.migrationStatus).toBe("applied");
  });

  it("rebuilds a table an earlier create never left behind, rather than altering nothing", async () => {
    // The create-or-alter decision belongs to the plan, where the database's state is still safe to
    // ask about. A single whose create failed has a registry row and no table; altering it would
    // emit ADD COLUMN against something that is not there.
    const { sql, written } = await runUpdate(
      { fields: [{ name: "heading", type: "text" }] },
      { mainTableExists: false }
    );

    expect(sql).toMatch(/CREATE TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(written?.migrationStatus).toBe("applied");
  });

  it("emits no table statements for a save that only flips a flag", async () => {
    // The flag-only save is a plan that renders no SQL, not a second execution path. It still has
    // companion work to do, which is why it is a plan at all rather than an early return.
    const { sql, written } = await runUpdate({ localized: true });

    expect(sql).not.toMatch(/ALTER TABLE single_page\b/i);
    expect(written?.migrationStatus).toBe("applied");
  });

  it("does not plan a second title column for a field that already owns one", async () => {
    // The system columns are matched by the COLUMN each field becomes, not by its name. A field
    // named `Title` already owns `title`, so prepending the system declaration beside it would hand
    // the diff two fields for one column and plan an ADD COLUMN against a column that exists.
    const { sql } = await runUpdate({
      fields: [
        { name: "Title", type: "text" },
        { name: "heading", type: "text" },
      ],
    });

    expect(sql).not.toMatch(/ADD COLUMN "?title"?\s/i);
  });
});

describe("updateSingleSchema — where a failure is allowed to surface", () => {
  it("raises a refusal instead of saving the fields it refused", async () => {
    // The generator is a validator as well as a renderer: it refuses an edit it can never apply
    // before any statement runs, and at that point the table is untouched and the caller's field
    // list is unsaved. Recording that as `failed` would persist a schema the table does not have
    // and report the single as having it.
    const existing = existingSingle({
      fields: [{ name: "heading", type: "textarea", unique: true }],
    });
    let threw: unknown;
    let registry;
    try {
      ({ registry } = await runUpdate(
        {
          fields: [
            { name: "heading", type: "textarea", unique: true },
            { name: "body", type: "textarea", unique: true },
          ],
        },
        { dialect: "mysql", existing }
      ));
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeInstanceOf(NextlyError);
    expect(registry).toBeUndefined();
    expect(executed, "nothing ran against the database").toEqual([]);
  });

  it("raises a refusal that reaches it from the apply phase too", async () => {
    // 🔴 A separate rule from the phase split, not a consequence of it. The split decides that a
    // DATABASE failure after the first statement is RECORDED rather than raised, because a
    // statement may already have run. A refusal is not that: it is a guard rejecting the edit, and
    // it propagates whatever phase it arrives from. Without this, a future apply-phase refusal is
    // silently recorded as `failed` and the field list is saved against a table that never took it.
    //
    // Injected at the statement seam because no adapter raises one today — they raise
    // `DatabaseError`, which extends `Error` and not `NextlyError`. That is what makes the rule
    // cheap rather than unnecessary: the call graph is what makes it unreachable, and call graphs
    // change.
    let threw: unknown;
    let out;
    try {
      out = await runUpdate(
        {
          fields: [
            { name: "heading", type: "text" },
            { name: "subtitle", type: "text" },
          ],
        },
        {
          onStatement: () => {
            throw NextlyError.validation({
              errors: [
                {
                  path: "fields.subtitle",
                  code: "REFUSED_DURING_APPLY",
                  message: "refused while applying",
                },
              ],
            });
          },
        }
      );
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeInstanceOf(NextlyError);
    expect(out, "the update did not reach its registry write").toBeUndefined();
  });

  it("records a database failure rather than raising it, once a statement has run", async () => {
    // The other side of the same boundary, and the control for the test above: without it, a
    // service that raised EVERYTHING would satisfy the refusal cases while breaking every ordinary
    // failure. A migration that got part way leaves the table changed, so the row has to say so.
    const { written } = await runUpdate(
      {
        fields: [
          { name: "heading", type: "text" },
          { name: "subtitle", type: "text" },
        ],
      },
      {
        onStatement: () => {
          throw new Error("connection reset mid-migration");
        },
      }
    );

    expect(written?.migrationStatus).toBe("failed");
  });
});
