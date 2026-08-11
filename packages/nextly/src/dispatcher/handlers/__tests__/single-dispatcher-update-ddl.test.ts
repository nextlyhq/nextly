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

/** Every main-table shape the apply bound, in order, so registration timing is observable. */
const registeredShapes = vi.fn();
/** Every table the apply retracted, so the recovery path is observable rather than inferred. */
const retractedTables = vi.fn();

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
  // Whether the main table has been CREATED during this run. The apply confirms the table exists
  // before recording "applied", so a double answering a flat `false` would report every rebuild as
  // failed — the test would then pass for the wrong reason, describing a create that did not work.
  let created = false;
  return {
    dialect,
    getCapabilities: () => ({ dialect }),
    tableExists: vi.fn(async (name: string) =>
      name.includes("_locales") ? false : mainTableExists || created
    ),
    selectOne: vi.fn(async (): Promise<{ id: string } | null> => null),
    // Present so runtime registration is OBSERVABLE. The create-side sibling omits it deliberately
    // to skip re-registration; here the order of that call against the companion reconcile is the
    // property under test, so it has to be visible.
    tableResolver: {
      registerDynamicSchema: registeredShapes,
      retractDynamicSchema: retractedTables,
    },
    // The companion reconcile reaches the database through Drizzle rather than `executeQuery`, so
    // its own statements are NOT visible in `executed`. That is why the flag-only assertion below
    // is phrased as "no statement naming the MAIN table" rather than "no statements at all": the
    // claim under test is that the plan rendered no migration SQL, not that the companion did
    // nothing — the companion doing something is the reason that plan exists at all.
    //
    // Shaped the way node-postgres answers through Drizzle — a result object carrying `rows` —
    // rather than a bare array, which satisfies the call and then fails inside the copy with
    // "rows is not iterable", a failure that reads as a defect in the code under test.
    getDrizzle: vi.fn(() => ({
      execute: async () => ({ rows: [] }),
    })),
    executeQuery: vi.fn(async (sql: string) => {
      executed.push(sql);
      onStatement?.(sql);
      if (/CREATE TABLE/i.test(sql)) created = true;
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
const liveTableHasRows = { value: false };
vi.mock("../../../domains/schema/pipeline/live-table-facts", () => ({
  tableHasRows: vi.fn(async () => liveTableHasRows.value),
  readForeignKeyColumns: vi.fn(async () => new Map<string, string[]>()),
  readIndexNames: vi.fn(async () => new Set<string>()),
}));

/**
 * A failure raised by the companion reconcile, injected per test, on either side of the real call.
 *
 * `when: "before"` stands for a reconcile that stopped at its first statement — an enable whose
 * companion CREATE was rejected, so nothing moved. `when: "after"` stands for one that completed
 * its DDL and failed on the tail: a disable restores the columns, archives them, DROPS the
 * companion, and only then clears the transition marker, which refuses a dotted slug.
 *
 * Both are needed because they leave the table in OPPOSITE states, and a double that can only
 * produce one of them cannot show that the recovery treats them alike.
 */
/**
 * How many times the REAL reconcile actually ran.
 *
 * Without this the two parameterized rows are indistinguishable from outside: both end in the same
 * recovery, so both stay green even if one of them never reaches the state it names. This is the
 * assertion that makes "before" mean before.
 */
const realReconcileCalls = { count: 0 };
const companionFailure: { error: unknown; when: "before" | "after" } = {
  error: undefined,
  when: "after",
};
vi.mock(
  "../../../domains/singles/services/reconcile-single-companion",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../domains/singles/services/reconcile-single-companion")
    >("../../../domains/singles/services/reconcile-single-companion");
    return {
      ...actual,
      reconcileSingleCompanion: vi.fn(
        async (args: Parameters<typeof actual.reconcileSingleCompanion>[0]) => {
          // BEFORE the real call: the reconcile is rejected at its first statement, so nothing it
          // owns has moved. AFTER: it completed its DDL and failed on the tail. The two leave the
          // table in opposite states, which is the whole reason both are driven.
          if (
            companionFailure.error !== undefined &&
            companionFailure.when === "before"
          ) {
            throw companionFailure.error;
          }
          realReconcileCalls.count += 1;
          const result = await actual.reconcileSingleCompanion(args);
          if (companionFailure.error !== undefined)
            throw companionFailure.error;
          return result;
        }
      ),
    };
  }
);

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
  warn: vi.fn(),
  error: vi.fn(),
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
    tableHasRows?: boolean;
    companionFailure?: unknown;
    companionFailureWhen?: "before" | "after";
    onStatement?: (sql: string) => void;
  } = {}
) {
  const {
    dialect = "postgresql",
    mainTableExists = true,
    tableHasRows = false,
    onStatement,
  } = options;
  executed.length = 0;
  registeredShapes.mockClear();
  retractedTables.mockClear();
  liveTableHasRows.value = tableHasRows;
  companionFailure.error = options.companionFailure;
  companionFailure.when = options.companionFailureWhen ?? "after";
  realReconcileCalls.count = 0;
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

  it("emits no main-table statements for a save that only flips a flag", async () => {
    // The flag-only save is a plan that renders no SQL, not a second execution path. It still has
    // companion work — saving Draft/Published on a localized single ADDs or DROPs the companion's
    // own `_status` — which is why it is a plan at all rather than an early return.
    //
    // 🔴 Driven by SAVING the toggle at a value it already holds. That is the case `statusRequested`
    // exists for and the one a derived `hasStatus !== wasStatus` would collapse: provisioning is
    // idempotent, so this save is what repairs a localized single whose companion `_status` was
    // never created. Were it treated as a no-op the repair would silently stop happening.
    const { sql, written } = await runUpdate(
      { status: false },
      { existing: existingSingle({ localized: true, status: false }) }
    );

    expect(sql).not.toMatch(/ALTER TABLE\s+"?single_page"?\s/i);
    expect(sql).not.toMatch(/CREATE TABLE\s+"?single_page"?\s/i);
    expect(written?.migrationStatus).toBe("applied");
  });

  it("emits nothing destructive when a field group is named after a system column", async () => {
    // A field group stores its values in its own table and declares NO column, so one named `title`
    // must not be mistaken for the table's own `title`. The normaliser keys the system declarations
    // on the COLUMN each field becomes rather than on its name, which is what keeps them apart.
    //
    // 🔴 This asserts the OUTCOME, not that mechanism, and the distinction is worth stating: keying
    // on the name instead was measured against this same input and produced byte-identical SQL,
    // because the generator does not DROP a system column that goes missing from the desired list.
    // So the two keyings are indistinguishable at this seam and no assertion here can separate
    // them — `columnsDeclaredBy` is where that choice is decidable and tested. What this does hold
    // is the outcome a future generator could break: adding a field group beside a system column
    // must never emit DDL against that column.
    const { sql, written } = await runUpdate({
      fields: [
        { name: "heading", type: "text" },
        { name: "title", type: "component", component: "seo" },
      ],
    });

    expect(sql).not.toMatch(/DROP COLUMN\s+"?title"?/i);
    expect(sql).not.toMatch(/ADD COLUMN\s+"?title"?/i);
    expect(written?.migrationStatus).toBe("applied");
  });
});

describe("updateSingleSchema — where a failure is allowed to surface", () => {
  it("raises a refusal instead of saving the fields it refused", async () => {
    // The generator is a validator as well as a renderer: a REQUIRED column has no value for the
    // rows already there, so it refuses before any statement runs. At that point the table is
    // untouched and the caller's field list is unsaved — recording that as `failed` would persist a
    // schema the table does not have and report the single as having it.
    let threw: unknown;
    let out;
    try {
      out = await runUpdate(
        {
          fields: [
            { name: "heading", type: "text" },
            {
              name: "author",
              type: "relationship",
              required: true,
              relationTo: "users",
            },
          ],
        },
        { tableHasRows: true }
      );
    } catch (error) {
      threw = error;
    }

    expect(threw).toBeInstanceOf(NextlyError);
    expect(out, "the update did not reach its registry write").toBeUndefined();
    expect(executed, "nothing ran against the database").toEqual([]);
  });

  it("records a refusal raised after the schema has already changed, rather than raising it", async () => {
    // 🔴 The phase decides this, NOT the error type, and the distinction is the whole point of the
    // split. Before anything runs, a refusal means the request was rejected and nothing was
    // touched, so it is raised. Once a statement has run, raising SKIPS the registry write — and a
    // row that never learns what happened leaves the registry describing storage that no longer
    // matches it.
    //
    // The reachable case is a localization disable: the companion is restored, archived and
    // DROPPED, and only then does clearing the transition marker refuse a dotted slug. Raise there
    // and the companion is gone while the row still says the single is localized, so every later
    // read targets a table that is not there — with nothing recording the state.
    const { written } = await runUpdate(
      { localized: false },
      {
        existing: existingSingle({ localized: true }),
        companionFailure: NextlyError.internal({
          logContext: { reason: "raised after the companion was dropped" },
        }),
      }
    );

    expect(written?.migrationStatus).toBe("failed");
  });

  it.each([
    ["before its DDL ran", "before" as const],
    ["after its DDL completed", "after" as const],
  ])(
    "retracts the runtime shape when the companion fails %s",
    async (_label, when) => {
      // 🔴 The recovery RETRACTS rather than rebinding, and these two cases are why. A reconcile
      // that stops at its first statement leaves the translatable columns on main; one that stops
      // on its tail — a disable that restored the columns, dropped the companion and then failed
      // clearing its transition marker — leaves them somewhere else entirely. Every fixed shape is
      // correct for one of these and wrong for the other, and which one happened is not observable
      // from outside the reconcile.
      //
      // Retracting is the claim that holds for both: no longer describable from here. The rebuild
      // in `ensure-runtime-table.ts` then PROBES the database for where the columns physically
      // live, which is the fact any bound shape would have been guessing.
      const { written } = await runUpdate(
        { localized: true },
        {
          existing: existingSingle({ localized: false }),
          companionFailure: new Error("companion reconcile rejected"),
          companionFailureWhen: when,
        }
      );

      expect(written?.migrationStatus).toBe("failed");
      // The rows must reach DIFFERENT states, or the parameterization is decoration: "before" must
      // not have run the reconcile at all, "after" must have run it to completion.
      expect(realReconcileCalls.count).toBe(when === "before" ? 0 : 1);
      expect(retractedTables).toHaveBeenCalledWith("single_page");
      // Binding anything here would be adopted by the next reader instead of rebuilt.
      expect(registeredShapes).not.toHaveBeenCalled();
    }
  );

  it("binds the runtime shape once the companion has taken", async () => {
    // The control. Without it, an apply that never registered at all would satisfy the case above
    // while silently dropping the rebinding a successful save depends on.
    const { written } = await runUpdate({
      fields: [
        { name: "heading", type: "text" },
        { name: "subtitle", type: "text" },
      ],
    });

    expect(written?.migrationStatus).toBe("applied");
    expect(registeredShapes).toHaveBeenCalledTimes(1);
    // The control's other half: a service that retracted unconditionally would satisfy both cases
    // above while throwing away the rebinding every successful save depends on.
    expect(retractedTables).not.toHaveBeenCalled();
  });

  it("leaves a failed single failed when the save only describes a change to it", async () => {
    // A create that got its `CREATE TABLE` through and then failed on an index leaves the table
    // PRESENT but incomplete. Every later save takes the alter branch, and an ALTER re-establishes
    // nothing it does not mention, so the missing artifact stays missing.
    const { sql, written } = await runUpdate(
      { fields: [{ name: "heading", type: "text" }] },
      { existing: existingSingle({ migrationStatus: "failed" }) }
    );

    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(written?.migrationStatus).toBe("failed");
  });

  it("leaves a failed single failed even when its alter runs statements", async () => {
    // 🔴 The case "did anything run?" gets wrong, and the reason the rule asks what the plan
    // DESCRIBES instead. An unrelated field edit against the same incomplete table emits a real
    // ALTER and runs it — plenty of statements, none of them anywhere near the index that never
    // got created. Counting statements would clear the one durable record that something is wrong.
    const { sql, written } = await runUpdate(
      {
        fields: [
          { name: "heading", type: "text" },
          { name: "subtitle", type: "text" },
        ],
      },
      { existing: existingSingle({ migrationStatus: "failed" }) }
    );

    expect(sql, "the alter really did run").toMatch(/ALTER TABLE/i);
    expect(written?.migrationStatus).toBe("failed");
  });

  it("clears a failed single when the save rebuilds the whole table", async () => {
    // The control, and the case the rule must NOT block: the table is absent, so the plan renders
    // it from the desired spec in full — every column, index and junction table. Reaching the end
    // of that does mean the schema is whole, which is what makes the repair recordable at all.
    // Without this, a rule that simply never cleared `failed` would satisfy both cases above.
    const { sql, written } = await runUpdate(
      { fields: [{ name: "heading", type: "text" }] },
      {
        existing: existingSingle({ migrationStatus: "failed" }),
        mainTableExists: false,
      }
    );

    expect(sql).toMatch(/CREATE TABLE/i);
    expect(written?.migrationStatus).toBe("applied");
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
