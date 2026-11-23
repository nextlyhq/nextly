/**
 * One field type change judged the same on the Schema Builder's roads: the same class, the same
 * reasons and the same counts, in the same words (`describeClassed`). The Builder's schema dialog
 * and the collection update (through the save writer) each refuse `price` changing from text to
 * number over "1", "1.5", "abc" and an empty value: blocked, with each reason and its count. Each
 * keys the rows by its own ids, so the judgement is compared with them masked and its reasons in
 * one order (`judgementIn`). `nextly migrate`, applying the Builder's file to another database,
 * names it too (`migrate-judges-type-changes.integration.test.ts`).
 *
 * The code-first roads judge, as the Builder does and in its words, the type changes their own rule
 * never sees, which plan no statement: a field inside a group's JSON, and a field whose column keeps
 * its type. The reload holds its entity back and `db:sync` refuses, each naming the field by its
 * path and changing nothing. A change of a column's type stays the code-first rule's.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { resetSessionStandingForTests } from "../../../../../auth/session/session-standing";
import { runDbSync } from "../../../../../cli/commands/db-sync";
import type { CommandContext } from "../../../../../cli/program";
import { createLogger } from "../../../../../cli/utils/logger";
import { defineCollection, defineConfig } from "../../../../../config";
import { createAdapter } from "../../../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../../../database/test-database-ddl";
import { getService } from "../../../../../di/service-access";
import { dispatchCollections } from "../../../../../dispatcher/handlers/collection-dispatcher";
import { reloadNextlyConfig } from "../../../../../init/reload-config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../../services";
import { _resetEnvCache } from "../../../../../shared/lib/env";
import { consoleLogger } from "../../../../../shared/types";
import { setNonInteractive } from "../../../migrate/can-prompt";
import { takeRecordedAtStart } from "../../../pipeline/recorded-fields";

import { judgementIn, refusalText } from "./helpers/judgement-in";

const SLUG = "tsr_items";
const TABLE = `dc_${SLUG}`;
const VALUES = ["1", "1.5", "abc", null] as const;

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

let instance: TestNextly | undefined;
let closing: (() => Promise<void>)[] = [];
/** The folder `db:sync` runs in, of the case's own. */
let syncDir = "";
afterEach(async () => {
  setNonInteractive(false);
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
  for (const close of closing) await close().catch(() => {});
  closing = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetEnvCache();
});

/** The entries, one per value; the id of the one holding "abc", which no number reads. */
async function seed(t: TestNextly): Promise<string> {
  let lost = "";
  for (const price of VALUES) {
    const created = (await t.nextly.create({
      collection: SLUG,
      data: { price },
    } as never)) as unknown as { item: { id: unknown } };
    if (price === "abc") lost = String(created.item.id);
  }
  return lost;
}

/** A code-first collection holding `fields`. */
const declaring = (fields: unknown[]) =>
  defineConfig({
    collections: [defineCollection({ slug: SLUG, fields: fields as never })],
  });

const priced = (type: string) => [{ name: "price", type }];
const detailed = (type: string) => [
  { name: "details", type: "group", fields: [{ name: "contact", type }] },
];
/** A field on the row, `contact`: a select's one option is the email `a@b.co`. */
const contacted = (type: string) => [
  {
    name: "contact",
    type,
    ...(type === "select"
      ? { options: [{ label: "A", value: "a@b.co" }] }
      : {}),
  },
];

describe.each(getConfiguredTestDialects())(
  "one type change judged alike on every road (%s)",
  dialect => {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The Builder's road: the dialog's save or the collection update, through the writer. */
    async function builderRoad(caller: "dialog" | "update"): Promise<string> {
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: SLUG, fields: priced("text") }
      );
      const lost = await seed(t);
      const fields = priced("number");
      const [row] = (await t.adapter.executeQuery(
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
      )) as Array<{ v: unknown }>;
      const answer = await (
        caller === "dialog"
          ? dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              { fields, confirmed: true, schemaVersion: Number(row?.v ?? 1) }
            )
          : dispatchCollections(
              {} as ServiceContainer,
              "updateCollection",
              { collectionName: SLUG },
              { fields }
            )
      ).then(
        async a => (a instanceof Response ? ((await a.json()) as unknown) : a),
        (error: unknown) => error
      );
      await t.destroy();
      instance = undefined;
      return judgementIn(refusalText(answer), lost);
    }

    /**
     * A code-first reload under `next dev` from `before` to `after`, over the entries `write`
     * makes: what the reload said, and what the table then holds.
     */
    async function reload(
      before: unknown[],
      after: unknown[],
      write: (t: TestNextly) => Promise<void>
    ): Promise<{ said: string; held: string }> {
      // A start under `next dev` holds its registry rows for the apply it runs next; an earlier
      // instance of this file started so never ran it, so its rows are no record of this one's.
      vi.unstubAllEnvs();
      takeRecordedAtStart();
      loaded.config = declaring(before);
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: SLUG, fields: before as never }),
        ],
      });
      instance = t;
      await write(t);
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = declaring(after);
      const said: string[] = [];
      const record = (line: unknown) => said.push(String(line));
      await reloadNextlyConfig({
        resolver: name =>
          name === "logger"
            ? { ...consoleLogger, info: () => {}, warn: record, error: record }
            : getService(name as Parameters<typeof getService>[0]),
      });
      const held = JSON.stringify(
        await t.adapter.executeQuery(
          `SELECT * FROM ${q(TABLE)} ORDER BY ${q("id")}`
        )
      );
      return { said: said.join("\n"), held };
    }

    /** A database of the case's own for `db:sync`, named by `DATABASE_URL`: its connection. */
    async function syncDatabase(): Promise<DrizzleAdapter> {
      const dir = await mkdtemp(join(tmpdir(), "type-change-roads-"));
      syncDir = dir;
      closing.push(() => rm(dir, { recursive: true, force: true }));
      vi.stubEnv("DB_DIALECT", dialect);
      if (dialect === "sqlite") {
        const url = `file:${join(dir, "sync.db")}`;
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        const adapter = (await createAdapter({
          type: "sqlite",
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
        closing.unshift(() => adapter.disconnect());
        return adapter;
      }
      const serverUrl = process.env[SERVER_URL_ENV[dialect]];
      if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
      const name = `nextly_tsr_${randomBytes(8).toString("hex")}`;
      const server = await createAdapter({ type: dialect, url: serverUrl });
      await server.executeQuery(createDatabaseStatement(dialect, name));
      closing.push(async () => {
        try {
          await server.executeQuery(dropDatabaseStatement(dialect, name));
        } finally {
          await server.disconnect();
        }
      });
      const url = new URL(serverUrl);
      url.pathname = `/${name}`;
      vi.stubEnv("DATABASE_URL", url.toString());
      _resetEnvCache();
      const adapter = (await createAdapter({
        type: dialect,
        url: url.toString(),
      })) as unknown as DrizzleAdapter;
      closing.unshift(() => adapter.disconnect());
      return adapter;
    }

    /** `nextly db:sync` over `fields`, with nobody to ask: what it threw and logged, if anything. */
    async function dbSync(fields: unknown[]): Promise<string | undefined> {
      loaded.config = declaring(fields);
      clearCachedSnapshot();
      clearLiveSnapshots();
      setNonInteractive(true);
      const logger = createLogger({ quiet: true });
      const logged: string[] = [];
      vi.spyOn(logger, "error").mockImplementation((...line: unknown[]) => {
        logged.push(line.map(String).join(" "));
      });
      const exit = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("exit");
      }) as never);
      const dir = syncDir;
      try {
        await runDbSync(
          { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
          { logger, options: {}, cwd: dir } as unknown as CommandContext
        );
        return undefined;
      } catch (error) {
        return `${refusalText(error)} ${logged.join("\n")}`;
      } finally {
        exit.mockRestore();
      }
    }

    /** The rows of the table `db:sync` keeps, written raw as an earlier version left them. */
    async function written(
      adapter: DrizzleAdapter,
      column: string,
      values: Record<string, string | null>
    ): Promise<void> {
      for (const [id, value] of Object.entries(values)) {
        await adapter.executeQuery(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q(column)}) VALUES ('${id}', '${id}', 'T', ${value === null ? "NULL" : `'${value}'`})`
        );
      }
    }

    const ids = {
      readable: "00000000-0000-4000-8000-000000000001",
      unreadable: "00000000-0000-4000-8000-000000000002",
    };

    it("names the same judgement from the dialog and the update", async () => {
      const dialog = await builderRoad("dialog");
      // "1.5" is held only rounded by a whole number, and "abc" by no number.
      expect(dialog).toMatch(/^blocked: /);
      expect(dialog).toContain("would be cleared (1 row: id <lost>)");
      expect(await builderRoad("update")).toBe(dialog);
    }, 240_000);

    // An email becoming a select keeps its column (a text on every database), so no statement
    // plans it and the code-first rule never sees it: the Builder's judgement does.
    it("holds back a code-first reload of a change that keeps its column, over a value the new type can't read", async () => {
      let unreadable = "";
      const { said, held } = await reload(
        contacted("email"),
        contacted("select"),
        async t => {
          await t.nextly.create({
            collection: SLUG,
            data: { contact: "a@b.co" },
          } as never);
          const created = (await t.nextly.create({
            collection: SLUG,
            data: { contact: "x@y.co" },
          } as never)) as unknown as { item: { id: unknown } };
          unreadable = String(created.item.id);
        }
      );

      expect(said).toContain(`Code-first change for '${SLUG}' was not applied`);
      expect(said).toContain(
        `Collection '${SLUG}': field 'contact' cannot change from email to select`
      );
      expect(said).toContain(
        `values that are not one of the field's options would be cleared (1 row: id ${unreadable})`
      );
      expect(held).toContain("x@y.co");
    }, 240_000);

    it("refuses db:sync of a change that keeps its column, over a value the new type can't read, changing nothing", async () => {
      const adapter = await syncDatabase();
      expect(await dbSync(contacted("email"))).toBeUndefined();
      await written(adapter, "contact", {
        [ids.readable]: "a@b.co",
        [ids.unreadable]: "x@y.co",
      });

      const refused = await dbSync(contacted("select"));

      expect(refused).toContain(
        `Collection '${SLUG}': field 'contact' cannot change from email to select`
      );
      expect(refused).toContain(
        `values that are not one of the field's options would be cleared (1 row: id ${ids.unreadable})`
      );
      expect(
        await adapter.executeQuery(
          `SELECT ${q("contact")} AS contact FROM ${q(TABLE)} ORDER BY ${q("id")}`
        )
      ).toEqual([{ contact: "a@b.co" }, { contact: "x@y.co" }]);
    }, 240_000);

    it("holds back a code-first reload of a group's field whose value the new type can't read, naming the field by its path", async () => {
      let unreadable = "";
      const { said, held } = await reload(
        detailed("text"),
        detailed("email"),
        async t => {
          await t.nextly.create({
            collection: SLUG,
            data: { details: { contact: "a@b.co" } },
          } as never);
          const created = (await t.nextly.create({
            collection: SLUG,
            data: { details: { contact: "abc" } },
          } as never)) as unknown as { item: { id: unknown } };
          unreadable = String(created.item.id);
        }
      );

      expect(said).toContain(`Code-first change for '${SLUG}' was not applied`);
      expect(said).toContain("field 'details.contact'");
      expect(said).toContain(
        `values the email field's rule refuses would be cleared (1 row: id ${unreadable})`
      );
      expect(held).toContain("abc");
    }, 240_000);

    it("refuses db:sync of a group's field whose value the new type can't read, naming the field by its path, changing nothing", async () => {
      const adapter = await syncDatabase();
      expect(await dbSync(detailed("text"))).toBeUndefined();
      await written(adapter, "details", {
        [ids.readable]: JSON.stringify({ contact: "a@b.co" }),
        [ids.unreadable]: JSON.stringify({ contact: "abc" }),
      });
      const before = JSON.stringify(
        await adapter.executeQuery(
          `SELECT ${q("details")} AS details FROM ${q(TABLE)} ORDER BY ${q("id")}`
        )
      );

      const refused = await dbSync(detailed("email"));

      expect(refused).toContain(
        `Collection '${SLUG}': field 'details.contact' cannot change from text to email`
      );
      expect(refused).toContain(
        `values the email field's rule refuses would be cleared (1 row: id ${ids.unreadable})`
      );
      expect(
        JSON.stringify(
          await adapter.executeQuery(
            `SELECT ${q("details")} AS details FROM ${q(TABLE)} ORDER BY ${q("id")}`
          )
        )
      ).toBe(before);
    }, 240_000);
  }
);
