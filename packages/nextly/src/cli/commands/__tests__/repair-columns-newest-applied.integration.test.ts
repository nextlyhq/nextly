/**
 * `nextly repair-columns` never converts a column from an older snapshot while a newer migration
 * is applied, whatever else the ledger, the checkout and the snapshots folder hold.
 *
 * The run is the real one, over each configured database: 0001 and 0002 are applied, the table is
 * as 0002 left it, and each case then changes one thing. A column `--apply` would convert back
 * stands for both ends: `author` became required in 0002, and `links` became text.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adapter: undefined as unknown,
  dialect: "sqlite",
  root: "",
  collections: [] as unknown[],
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    dialect: state.dialect,
    databaseUrl: "file:./unused.db",
  }),
  // The test's own database, which the command must not close: each case runs it twice.
  createCliAdapter: () =>
    Promise.resolve(
      new Proxy(state.adapter as object, {
        get(target, property) {
          if (property === "disconnect") return () => Promise.resolve();
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    ),
}));
vi.mock("../../utils/config-loader", () => ({
  loadConfig: () =>
    Promise.resolve({
      config: {
        collections: state.collections,
        db: { migrationsDir: ".", uiSchemaFile: "ui-schema.json" },
      },
      projectRoot: state.root,
    }),
}));
vi.mock("../../utils/registry-resolver", () => ({
  installRegistryResolver: () => {},
}));

import { DynamicCollectionService } from "../../../domains/dynamic-collections/services/dynamic-collection-service";
import { LOCALIZATION_MIGRATION_MARKER } from "../../../domains/i18n/migration/write-migration-file";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  f,
  tableTools,
} from "../../../domains/schema/repair-columns/__tests__/apply-fixture";
import { COLUMN_REPAIRS_TABLE } from "../../../domains/schema/repair-columns/record";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createContext } from "../../context";
import { repairColumnsAction } from "../repair-columns";

const TABLE = "dc_rnaposts";
const FILES = [
  "0001_first.sql",
  "0002_second.sql",
  "0002_second-fix.sql",
  "0003_third.sql",
  "20261101_120000_000_posts.sql",
  "get_started_only.sql",
];
const TITLE = f({ name: "title", type: "text" });
const AUTHOR = { name: "author", type: "relationship", relationTo: "users" };
/** As 0001 declared them. */
const FIRST = [
  TITLE,
  f(AUTHOR),
  f({
    name: "links",
    type: "repeater",
    fields: [{ name: "url", type: "text" }],
  }),
];
/** As 0002 declared them, and as the table stands. */
const SECOND = [
  TITLE,
  f({ ...AUTHOR, required: true }),
  f({ name: "links", type: "textarea" }),
];

describe.each(getConfiguredTestDialects())(
  "repair-columns judges by the newest applied migration (%s)",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(
      () => handle.adapter as unknown as DrizzleAdapter,
      dialect
    );
    const events = () =>
      new SchemaEventsRepository(
        (handle.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      );
    const path = (...parts: string[]) => join(state.root, ...parts);

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      state.adapter = handle.adapter;
      state.dialect = dialect;
      state.root = mkdtempSync(join(tmpdir(), "nextly-repair-newest-"));
      state.collections = [{ slug: "rnaposts", fields: SECOND }];
      mkdirSync(path("meta"));
      vi.stubEnv("CI", "");
      const adapter = handle.adapter as unknown as DrizzleAdapter;
      if (!(await adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await tools.run(statement);
        }
      }
      await tools.run(`DROP TABLE IF EXISTS ${tools.q(TABLE)}`);
      await tools.createTable(TABLE, FIRST);
      const first = await tools.definition(TABLE);
      await tools.run(`DROP TABLE ${tools.q(TABLE)}`);
      await tools.createTable(TABLE, SECOND);
      const second = await tools.definition(TABLE);
      await migration("0001_first", { fields: FIRST, tables: first.tables });
      await migration("0002_second", { fields: SECOND, tables: second.tables });
      await tools.insert(TABLE, [
        { id: "p1", title: "a", author: "u1", links: '[{"url":"z"}]' },
      ]);
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      process.exitCode = undefined;
      await tools.run(`DROP TABLE IF EXISTS ${tools.q(TABLE)}`);
      await tools.run(`DROP TABLE IF EXISTS ${tools.q(COLUMN_REPAIRS_TABLE)}`);
      await tools.run(
        `DELETE FROM nextly_schema_events WHERE filename IN (${FILES.map(name => `'${name}'`).join(", ")})`
      );
      rmSync(state.root, { recursive: true, force: true });
      await handle?.destroy();
    });

    /** Write a migration, with its snapshot unless `recorded` is null, and record it applied. */
    async function migration(
      name: string,
      recorded: { fields: unknown[]; tables: unknown[] } | null,
      sql = "",
      applied = true
    ) {
      writeFileSync(path(`${name}.sql`), sql);
      if (recorded !== null) {
        writeFileSync(
          path("meta", `${name}.snapshot.json`),
          JSON.stringify({
            version: 1,
            migrationHash: "0",
            snapshot: { tables: recorded.tables },
            entities: {
              collections: {
                rnaposts: {
                  source: "code",
                  settings: { slug: "rnaposts", fields: recorded.fields },
                },
              },
              singles: {},
              fieldGroups: {},
            },
          })
        );
      }
      if (!applied) return;
      const filename = `${name}.sql`;
      const id = await events().recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename,
      });
      await events().markApplied(id, { uniqueFilename: filename });
    }

    /** Write a migration whose snapshot records `fields`, with the table's columns as they stand. */
    async function recordedAs(name: string, fields: unknown[]) {
      const { tables } = await tools.definition(TABLE);
      const known = (await events().findFileApplies(`${name}.sql`)).length > 0;
      await migration(name, { fields, tables }, "", !known);
    }

    /** Run the command under `--json`, and return its document and exit code. */
    async function run(apply: boolean) {
      const stdout: string[] = [];
      const spies = [
        vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
          stdout.push(String(chunk));
          return true;
        }),
        vi.spyOn(process.stderr, "write").mockImplementation(() => true),
      ];
      process.exitCode = undefined;
      try {
        await repairColumnsAction(createContext)({ json: true, apply }, {
          optsWithGlobals: () => ({ cwd: state.root }),
        } as unknown as Command);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      const document = JSON.parse(stdout.join("")) as {
        result: {
          records: Array<{ table: string; column: string; outcome: string }>;
        } | null;
        errors: Array<Record<"code" | "message" | "cause" | "next", string>>;
      };
      return { document, exitCode: process.exitCode };
    }

    const columns = async () => ({
      author: await tools.columnState(TABLE, "author"),
      links: await tools.columnState(TABLE, "links"),
    });

    /** Neither run names a difference of either column, and `--apply` leaves both as they were. */
    async function expectUntouched() {
      const before = await columns();
      expect(before.author?.nullable).toBe(false);
      for (const apply of [false, true]) {
        const { document } = await run(apply);
        expect(document.errors).toEqual([]);
        expect(
          document.result?.records.filter(
            record =>
              record.table === TABLE &&
              ["author", "links"].includes(record.column)
          )
        ).toEqual([]);
      }
      expect(await columns()).toEqual(before);
    }

    it("is the control: with nothing changed since, neither column differs", async () => {
      await expectUntouched();
    });

    it.each(["failed", "in progress", "cleared"])(
      "leaves the columns alone after a later attempt that is %s",
      async outcome => {
        const id = await events().recordStart({
          eventType: "file_apply",
          source: "cli-migrate",
          filename: "0002_second.sql",
        });
        if (outcome !== "in progress") {
          await events().markFailed(id, { errorMessage: "already exists" });
        }
        if (outcome === "cleared") await events().markRolledBack(id);
        await expectUntouched();
      }
    );

    /** Both runs stop with `code`, at exit 1, with nothing converted. */
    async function expectStopped(code: string) {
      const before = await columns();
      const errors: Array<Record<string, string>> = [];
      for (const apply of [false, true]) {
        const { document, exitCode } = await run(apply);
        expect(document.result).toBeNull();
        expect(exitCode).toBe(1);
        expect(document.errors.map(error => error.code)).toEqual([code]);
        errors.push(document.errors[0]);
      }
      expect(await columns()).toEqual(before);
      expect(errors[1]).toEqual(errors[0]);
      return errors[0];
    }

    /** Take a migration out of the checkout, as one made before it was written. */
    function notCheckedOut(name: string) {
      rmSync(path(`${name}.sql`));
      rmSync(path("meta", `${name}.snapshot.json`));
    }

    it.each([
      ["the newer configuration", SECOND],
      ["its own configuration", FIRST],
    ])(
      "stops in a checkout without an applied migration, with %s",
      async (_whose, fields) => {
        state.collections = [{ slug: "rnaposts", fields }];
        notCheckedOut("0002_second");
        const error = await expectStopped("MIGRATION_MISSING");
        expect(error.message).toBe(
          "The ledger records 1 applied migration this build's migrations folder lacks (`0002_second.sql`), so `nextly repair-columns` ran nothing."
        );
        expect(error.next).toContain("`nextly migrate:resolve --removed");
      }
    );

    it("goes on where the migration's file was removed on purpose and its snapshot is there", async () => {
      rmSync(path("0002_second.sql"));
      await events().recordRemoval({
        filename: "0002_second.sql",
        sha256: "a".repeat(64),
      });
      await expectUntouched();
    });

    it("names the migration's file where its snapshot is still there", async () => {
      rmSync(path("0002_second.sql"));
      const error = await expectStopped("MISSING_MIGRATION");
      expect(error.message).toContain("`0002_second`");
    });

    it("goes on where the checkout lacks a migration that was rolled back", async () => {
      await migration("0003_third", null);
      const retired = (await events().findFileApplies("0003_third.sql")).map(
        row => row.id
      );
      const id = await events().insertEvent({
        eventType: "file_apply",
        status: "rolled_back",
        source: "cli-migrate",
        filename: "0003_third.sql",
        endedAt: new Date(),
        supersededEventIds: retired,
      });
      await events().supersede({ supersededEventIds: retired, byEventId: id });
      rmSync(path("0003_third.sql"));
      await expectUntouched();
    });

    const BLANK = "-- This is a blank migration file for custom SQL.\n";

    it("stops where the newest applied migration has lost its snapshot", async () => {
      rmSync(path("meta", "0002_second.snapshot.json"));
      const error = await expectStopped("MISSING_SNAPSHOT");
      expect(error).toMatchObject({
        message:
          "The applied migration `0002_second` has no snapshot in `meta/`.",
        cause:
          "It is newer than `0001_first`, whose snapshot is the newest applied one there is, so what the database last had applied cannot be known.",
        next: `Restore \`meta/0002_second.snapshot.json\` from version control. For SQL you wrote yourself, which has none, put its file back if it was removed and add the line \`${BLANK.trim()}\` to its header, above \`-- UP\`, then accept the edit with \`nextly migrate:resolve --applied '0002_second' --skip-verify\`. Then run \`nextly repair-columns\` again.`,
      });
    });

    it("names every newer applied migration without a snapshot", async () => {
      rmSync(path("meta", "0002_second.snapshot.json"));
      await migration("0003_third", null);
      const error = await expectStopped("MISSING_SNAPSHOT");
      expect(error.message).toBe(
        "The applied migrations `0002_second` and `0003_third` have no snapshot in `meta/`."
      );
      expect(error.next).toContain(
        "Restore `meta/0002_second.snapshot.json` and `meta/0003_third.snapshot.json` from version control."
      );
    });

    it("stops where the migration was removed on purpose and its snapshot is gone too", async () => {
      notCheckedOut("0002_second");
      await events().recordRemoval({
        filename: "0002_second.sql",
        sha256: "a".repeat(64),
      });
      await expectStopped("MISSING_SNAPSHOT");
    });

    it("goes on past a newer blank migration, which has no snapshot", async () => {
      await migration("0003_third", null, BLANK);
      await expectUntouched();
    });

    const LOCALIZATION = `${LOCALIZATION_MIGRATION_MARKER} companion (create) (i18n)\n`;
    const other = dialect === "sqlite" ? "postgresql" : "sqlite";

    /** An applied 0003 with no snapshot, as the files given, by the part of the name after it. */
    async function third(files: Record<string, string>) {
      await migration("0003_third", null);
      rmSync(path("0003_third.sql"));
      for (const [suffix, sql] of Object.entries(files)) {
        writeFileSync(path(`0003_third${suffix}.sql`), sql);
      }
    }

    it.each([
      ["its base file", { "": LOCALIZATION }],
      ["this dialect's variant", { "": "", [`.${dialect}`]: LOCALIZATION }],
      // With no file of its own and no base file, the dialect runs the variant there is.
      ["the only file there is", { [`.${other}`]: LOCALIZATION }],
    ])(
      "goes on past a newer localization migration, as %s says it is one",
      async (_file, files) => {
        await third(files as Record<string, string>);
        await expectUntouched();
      }
    );

    it.each([
      ["base file", { "": "", [`.${other}`]: LOCALIZATION }],
      ["variant", { [`.${dialect}`]: "", [`.${other}`]: LOCALIZATION }],
    ])(
      "stops where this dialect runs an ordinary %s and another's is a localization migration's",
      async (_file, files) => {
        await third(files as Record<string, string>);
        await expectStopped("MISSING_SNAPSHOT");
      }
    );

    it("says to put back a blank migration's file that was removed on purpose", async () => {
      await migration("0003_third", null, BLANK);
      rmSync(path("0003_third.sql"));
      await events().recordRemoval({
        filename: "0003_third.sql",
        sha256: "a".repeat(64),
      });
      const error = await expectStopped("MISSING_SNAPSHOT");
      expect(error.next).toContain("put its file back if it was removed");
      writeFileSync(path("0003_third.sql"), BLANK);
      await expectUntouched();
    });

    it("goes on past a hand-named migration, which predates the timestamped ones", async () => {
      // Run order alone would rank it newest, as a letter sorts after a digit.
      await migration("get_started_only", null);
      await recordedAs("20261101_120000_000_posts", SECOND);
      await expectUntouched();
    });

    it("reads the newer of two names one of which extends the other", async () => {
      rmSync(path("meta", "0002_second.snapshot.json"));
      await recordedAs("0002_second", FIRST);
      await recordedAs("0002_second-fix", SECOND);
      await expectUntouched();
    });

    it("goes on past a newer migration without a snapshot that is not applied", async () => {
      writeFileSync(path("0003_third.sql"), "");
      await expectUntouched();
    });

    it("goes on past an older migration from before snapshots were written", async () => {
      rmSync(path("meta", "0001_first.snapshot.json"));
      await expectUntouched();
    });

    it("goes on past an earlier Schema Builder's file, which is no app migration", async () => {
      // Its rows stay in the ledger, and no check counts them.
      const artifacts = (await new DynamicCollectionService(
        handle.adapter as unknown as DrizzleAdapter,
        { debug() {}, info() {}, warn() {}, error() {} }
      ).generateCollection({
        name: "rnaold",
        fields: [{ name: "title", type: "text" }],
      } as never)) as unknown as {
        migrationSQL: string;
        migrationFileName: string;
      };
      await migration(
        artifacts.migrationFileName.replace(/\.sql$/, ""),
        null,
        artifacts.migrationSQL
      );
      FILES.push(artifacts.migrationFileName);
      await expectUntouched();
    });
  }
);
