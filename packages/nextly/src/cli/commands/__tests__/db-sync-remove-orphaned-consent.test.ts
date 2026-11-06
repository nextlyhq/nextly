/**
 * `nextly db:sync --remove-orphaned` deletes the tables, registry entries and
 * permissions of collections, Singles and field groups no longer in the
 * config, so it takes the data-loss consent: every orphan is collected first
 * and judged once, before the first deletion of any kind. In this release a
 * run that cannot be asked still deletes, as it always has, and says that the
 * next release needs the consent; at a terminal it lists what goes and asks,
 * and a no stops it before anything is deleted.
 *
 * The database, the registries and the permission service are faked. Each
 * fake records the deletion it stands in for, in the order it happened, so
 * "nothing was deleted" is an empty record rather than an absent call.
 */
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { dbSyncAction } from "../db-sync";

/** Every deletion and every question, in the order the run made them. */
const events = vi.hoisted(() => [] as string[]);
const lines = vi.hoisted(() => [] as string[]);

/** What the fake database holds that the config no longer declares. */
const orphans = vi.hoisted(() => ({
  collections: [] as Array<{ slug: string; tableName: string }>,
  singles: [] as Array<{ slug: string; tableName: string }>,
  fieldGroups: [] as Array<{ slug: string; tableName: string }>,
  permissions: [] as Array<{ id: string; slug: string; resource: string }>,
}));

const confirm = vi.hoisted(() =>
  vi.fn(async () => {
    events.push("ask");
    return false;
  })
);

vi.mock("@clack/prompts", () => ({
  confirm,
  isCancel: () => false,
}));

// `../program` imports every command; the action needs only its context factory.
vi.mock("../../program", () => {
  const push = (m: unknown) => {
    lines.push(String(m));
  };
  return {
    createContext: () => ({
      options: {},
      logger: {
        header: push,
        info: push,
        warn: push,
        error: push,
        success: push,
        debug: () => {},
        keyValue: () => {},
        newline: () => {},
        divider: () => {},
        item: push,
        getOptions: () => ({ noColor: true }),
      },
    }),
  };
});

const adapter = vi.hoisted(() => ({
  getCapabilities: () => ({ dialect: "sqlite" }),
  setTableResolver: () => {},
  disconnect: async () => {},
  tableExists: async () => false,
  transaction: async (work: (tx: unknown) => Promise<unknown>) => work({}),
  executeQuery: async (statement: string) => {
    events.push(`statement: ${statement}`);
  },
  delete: async (table: string) => {
    events.push(`delete rows of ${table}`);
  },
}));

vi.mock("../../utils/adapter", () => ({
  createCliAdapter: async () => adapter,
  getDialectDisplayName: () => "SQLite",
}));

vi.mock("../../utils/command-prerequisites", () => ({
  requireDatabaseEnv: () => ({ dialect: "sqlite", databaseUrl: ":memory:" }),
  loadConfigOrExit: async () => ({
    configPath: "nextly.config.ts",
    fieldTypes: undefined,
    config: {
      collections: [],
      singles: [],
      fieldGroups: [],
      plugins: [],
      users: { fields: [] },
      typescript: {},
      db: {},
    },
  }),
}));

vi.mock("../../utils/config-loader", () => ({
  watchConfig: () => {},
  clearConfigCache: () => {},
}));

vi.mock("../../../database/index", () => ({ getDialectTables: () => ({}) }));
vi.mock("../../../database/schema-registry", () => ({
  SchemaRegistry: class {
    registerStaticSchemas() {}
  },
}));
vi.mock("../../../di/load-dynamic-tables", () => ({
  loadBuilderEntities: async () => [],
}));
vi.mock("../../../domains/field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: async (_args: unknown, work: () => Promise<unknown>) =>
    work(),
}));
vi.mock(
  "../../../domains/field-groups/services/register-field-group-schemas",
  () => ({ registerComponentSchemas: async () => {} })
);
vi.mock("../../../domains/field-groups/storage/registry-schemas", () => ({
  getFieldGroupRegistryAliases: () => ({}),
}));
vi.mock("../../../domains/field-groups/storage/resolve-storage-names", () => ({
  resolveFieldGroupRegistryName: async () => "dynamic_components",
}));
vi.mock("../../../domains/i18n/migration/recorded-before", () => ({
  readRecordedEntities: async () => undefined,
  recordedBeforeOf: () => undefined,
}));
vi.mock("../../../domains/schema/field-types/field-type-scope", () => ({
  runWithFieldTypes: async (_types: unknown, work: () => Promise<unknown>) =>
    work(),
}));
vi.mock("../../../domains/schema/sibling-fields", () => ({
  assertConfiguredSiblingFields: async () => {},
}));
vi.mock("../../../shared/address-rule", () => ({
  assertConfiguredAddresses: async () => {},
}));
vi.mock("../../../shared/lib/assert-plugin-field-declarations", () => ({
  assertPluginFieldDeclarations: () => {},
}));
vi.mock("../../../domains/schema/extension/publish", () => ({
  compileAndPublishExtensionSchema: async () => {},
}));
vi.mock("../../../domains/schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: async (
    _args: unknown,
    work: () => Promise<unknown>
  ) => work(),
}));
vi.mock("../../../domains/dashboard/dashboard-pins", () => ({
  dashboardPinsPresent: async () => false,
}));
vi.mock("../../../domains/versions/entity-teardown", () => ({
  mediaUsageTablePresent: async () => false,
  deleteEntityRegistryRow: async (_tx: unknown, kind: string, slug: string) => {
    events.push(`delete registry entry of ${kind} ${slug}`);
    return { deleted: 1, expire: undefined };
  },
}));
vi.mock(
  "../../../domains/field-groups/services/teardown-entity-field-group-data",
  () => ({
    teardownEntityComponentData: async (args: { parentTable: string }) => {
      events.push(`delete field group data of ${args.parentTable}`);
    },
  })
);
vi.mock("../../../domains/i18n/migration/teardown-entity-i18n", () => ({
  teardownEntityI18n: async (args: { tableName: string }) => {
    events.push(`delete translations of ${args.tableName}`);
  },
}));

const emptySync = { created: [], updated: [], unchanged: [], errors: [] };

// The collection service's own deletion of its orphans, which runs only when
// the sync is told to delete them.
vi.mock("../../../services/collections/collection-sync-service", () => ({
  CollectionSyncService: class {
    async detectRemovedCollections() {
      return orphans.collections;
    }
    async syncWithValidation(
      _config: unknown,
      options: { onRemoved?: string }
    ) {
      if (options.onRemoved === "delete") {
        for (const { slug } of orphans.collections) {
          events.push(`delete collection ${slug}`);
        }
      }
      return {
        sync: emptySync,
        removedCollections: [],
        warnings: [],
        relationshipValidation: { valid: true, errors: [], warnings: [] },
      };
    }
  },
}));

vi.mock("../../../services/singles/single-registry-service", () => ({
  SingleRegistryService: class {
    async syncCodeFirstSingles() {
      return emptySync;
    }
    async getAllSingles() {
      return orphans.singles;
    }
  },
}));

vi.mock("../../../services/field-groups/field-group-registry-service", () => ({
  FieldGroupRegistryService: class {
    async syncCodeFirstComponents() {
      return emptySync;
    }
    async getAllComponents() {
      return orphans.fieldGroups;
    }
  },
}));

vi.mock("../../../services/users/user-field-definition-service", () => ({
  UserFieldDefinitionService: class {
    async syncCodeFields() {
      throw new Error("no user field table in this fake");
    }
  },
}));
vi.mock("../../../services/users/user-ext-schema-service", () => ({
  UserExtSchemaService: class {},
}));

vi.mock("../../../domains/auth/services/permission-seed-service", () => {
  const seeded = { created: 0, total: 0, newPermissionIds: [] };
  return {
    PermissionSeedService: class {
      async seedSystemPermissions() {
        return seeded;
      }
      async seedAllCollectionPermissions() {
        return seeded;
      }
      async seedAllSinglePermissions() {
        return seeded;
      }
      async assignNewPermissionsToSuperAdmin() {}
      async findOrphanedPermissions() {
        return orphans.permissions;
      }
      async cleanupOrphanedPermissions() {
        for (const { slug } of orphans.permissions) {
          events.push(`delete permission ${slug}`);
        }
        return {
          total: orphans.permissions.length,
          created: orphans.permissions.length,
          skipped: 0,
          errors: 0,
        };
      }
    },
  };
});

vi.mock("../dev-display", () => ({
  displayComponentsSyncResults: () => {},
  displaySinglesSyncResults: () => {},
  displaySyncResults: () => {},
}));
vi.mock("../dev-server", () => ({
  ensureCoreTables: async () => {},
  performAutoSync: async () => {},
  performComponentsAutoSync: async () => {},
  performSinglesAutoSync: async () => {},
  performSinglesReconcile: async () => {},
}));
vi.mock("../dev-watcher", () => ({ createDebouncedSync: () => () => {} }));

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`exit ${String(code)}`);
  }
}

const cmd = { optsWithGlobals: () => ({}) } as unknown as Command;

/** Every exit the run asked for, in order. */
const exits: Array<number | undefined> = [];

/**
 * Runs `db:sync --remove-orphaned` (without the schema push, which is not
 * what is judged here), returning the exit code and what it printed. A run
 * that ends without asking to exit ended with 0.
 */
async function run(options: Record<string, unknown> = {}) {
  lines.length = 0;
  exits.length = 0;
  events.length = 0;
  await dbSyncAction(
    { removeOrphaned: true, autoSync: false, ...options },
    cmd
  ).catch((error: unknown) => {
    if (!(error instanceof Exited)) throw error;
  });
  return { code: exits[0] ?? 0, output: lines.join("\n") };
}

/** The recorded events that delete something. */
function deletions(): string[] {
  return events.filter(e => e !== "ask");
}

// A test worker's streams carry no `isTTY` of their own, so each run sets it
// and the original descriptor is put back after.
const ttyDescriptors = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
};

/** Sets both ends of the run to terminals, or not, until `restoreTerminal`. */
function terminal(attached: boolean) {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", {
      value: attached,
      configurable: true,
    });
  }
}

function restoreTerminal() {
  for (const [stream, was] of [
    [process.stdin, ttyDescriptors.stdin],
    [process.stdout, ttyDescriptors.stdout],
  ] as const) {
    if (was) Object.defineProperty(stream, "isTTY", was);
    else delete (stream as { isTTY?: boolean }).isTTY;
  }
}

const NEXT_RELEASE =
  /next release needs --accept-data-loss \(or NEXTLY_ACCEPT_DATA_LOSS\)/;

/** One orphan of every kind the run deletes, and one stray permission. */
function orphanOfEveryKind() {
  orphans.collections = [{ slug: "posts", tableName: "dc_posts" }];
  orphans.singles = [{ slug: "home", tableName: "single_home" }];
  orphans.fieldGroups = [{ slug: "hero", tableName: "comp_hero" }];
  orphans.permissions = [{ id: "p1", slug: "read-legacy", resource: "legacy" }];
}

/** What a run that deleted every orphan recorded, kind by kind. */
function expectEveryOrphanDeleted() {
  const done = deletions();
  expect(done).toContain("delete collection posts");
  expect(done).toContain("delete registry entry of single home");
  expect(done).toContain("delete rows of dynamic_components");
  expect(done).toContain("delete permission read-legacy");
}

describe("db:sync --remove-orphaned and the data-loss consent", () => {
  let saved: { consent?: string; ci?: string };

  beforeEach(() => {
    confirm.mockClear();
    orphanOfEveryKind();
    saved = {
      consent: process.env.NEXTLY_ACCEPT_DATA_LOSS,
      ci: process.env.CI,
    };
    delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
    delete process.env.CI;
    terminal(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The error a run ends with is printed in the error shape on standard error.
    vi.spyOn(console, "error").mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    vi.spyOn(process, "exit").mockImplementation(code => {
      const status = code === undefined ? undefined : Number(code);
      exits.push(status);
      throw new Exited(status);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreTerminal();
    setNonInteractive(false);
    for (const [name, value] of [
      ["NEXTLY_ACCEPT_DATA_LOSS", saved.consent],
      ["CI", saved.ci],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it.each([
    ["with no terminal", () => terminal(false)],
    [
      "with CI set at a terminal",
      () => {
        terminal(true);
        process.env.CI = "true";
      },
    ],
    [
      "with --non-interactive at a terminal",
      () => {
        terminal(true);
        setNonInteractive(true);
      },
    ],
  ])(
    "deletes as before %s and no consent, saying the next release needs it",
    async (_case, arrange) => {
      arrange();
      const { code, output } = await run();
      expect(code).toBe(0);
      expect(confirm).not.toHaveBeenCalled();
      expectEveryOrphanDeleted();
      expect(output).toMatch(NEXT_RELEASE);
    }
  );

  it("deletes with --accept-data-loss, listing what goes, with no notice", async () => {
    const { code, output } = await run({ acceptDataLoss: true });
    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expectEveryOrphanDeleted();
    expect(output).toContain("with consent:");
    for (const table of ["dc_posts", "single_home", "comp_hero"]) {
      expect(output).toContain(`table ${table}`);
    }
    expect(output).toContain("rows of permissions");
    expect(output).not.toMatch(NEXT_RELEASE);
  });

  it("deletes with NEXTLY_ACCEPT_DATA_LOSS, listing what goes, with no notice", async () => {
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    const { code, output } = await run();
    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expectEveryOrphanDeleted();
    expect(output).toContain("with consent:");
    expect(output).toContain("table dc_posts");
    expect(output).not.toMatch(NEXT_RELEASE);
  });

  it("asks once at a terminal, before the first deletion, and deletes on yes", async () => {
    terminal(true);
    confirm.mockImplementationOnce(async () => {
      events.push("ask");
      return true;
    });
    const { code, output } = await run();
    expect(code).toBe(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(events[0]).toBe("ask");
    expectEveryOrphanDeleted();
    // The question listed every orphan of every kind, not one kind at a time.
    for (const table of ["dc_posts", "single_home", "comp_hero"]) {
      expect(output).toContain(`table ${table}`);
    }
    expect(output).toContain("rows of permissions");
  });

  it("exits 1 on a no at the terminal, deleting nothing of any kind", async () => {
    terminal(true);
    const { code, output } = await run();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(code).toBe(1);
    expect(deletions()).toEqual([]);
    expect(output).toContain("(DATA_LOSS_DECLINED)");
    expect(output).toContain("the deletion was not confirmed");
  });

  it.each([
    ["with no terminal", () => terminal(false)],
    ["at a terminal", () => terminal(true)],
  ])(
    "refuses a consent that leaves an orphan out %s, deleting nothing and naming it",
    async (_case, arrange) => {
      arrange();
      const { code, output } = await run({
        acceptDataLoss: "dc_posts,comp_hero,permissions,role_permissions",
      });
      expect(code).toBe(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(deletions()).toEqual([]);
      expect(output).toContain("table single_home");
      expect(output).toContain("(DATA_LOSS_CONSENT_NOT_COVERED)");
      expect(output).not.toMatch(NEXT_RELEASE);
    }
  );

  it("asks nothing at a terminal when nothing is orphaned", async () => {
    orphans.collections = [];
    orphans.singles = [];
    orphans.fieldGroups = [];
    orphans.permissions = [];
    terminal(true);
    const { code, output } = await run();
    expect(code).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(deletions()).toEqual([]);
    expect(output).not.toMatch(NEXT_RELEASE);
    expect(output).toContain("Dev sync completed");
  });
});
