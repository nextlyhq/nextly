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
const FILES = ["0001_first.sql", "0002_second.sql", "0003_third.sql"];
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
      sql = ""
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
      const filename = `${name}.sql`;
      const id = await events().recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename,
      });
      await events().markApplied(id, { uniqueFilename: filename });
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
  }
);
