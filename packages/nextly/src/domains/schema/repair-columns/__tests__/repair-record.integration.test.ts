/**
 * Columns are repaired only when someone asks, each repair is recorded, and a repaired column is
 * then what every other path expects.
 *
 * `nextly migrate`, `nextly upgrade` and a start leave every legacy column as it is; only
 * `repair-columns --apply` converts it, and it records the time, the table and column, the type and
 * nullability before and after, the class, whether consent was given and how many values were
 * cleared. Afterwards the column reports no difference, the schema diff `db:sync` and the
 * development push plan from finds nothing to change in it, and a migration converting it to the
 * type it already has changes no value.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { runUpgrade } from "../../../../cli/commands/upgrade";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { buildDesiredTableFromFields } from "../../pipeline/diff/build-from-fields";
import { diffSnapshots } from "../../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { builtByFor } from "../../pipeline/registered-collections";
import { applyRepairs } from "../apply";
import { COLUMN_REPAIRS_TABLE, readRepairs } from "../record";
import { dryRunReport } from "../run-report";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_rp_posts";

const TITLE = f({ name: "title", type: "text" });
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});

/** A logger that prints nothing. */
const silent = {
  header: () => {},
  info: () => {},
  success: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  keyValue: () => {},
  divider: () => {},
  newline: () => {},
  item: () => {},
  table: () => {},
  spinner: () => ({ stop: () => {} }),
  setOptions: () => {},
  getOptions: () => ({}),
} as unknown as Parameters<typeof migrateCore>[0]["logger"];

describe.each(getConfiguredTestDialects())("a column repair on %s", dialect => {
  let handle: TestNextly;
  const tools = tableTools(() => handle.adapter, dialect);
  const { q, run } = tools;

  const fields =
    dialect === "sqlite" ? [TITLE, AUTHOR] : [TITLE, LINKS, AUTHOR];
  const columns = dialect === "sqlite" ? ["author"] : ["links", "author"];
  const entity = () => collection(TABLE, fields);

  beforeEach(async () => {
    handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    await tools.createTable(TABLE, fields);
    if (dialect !== "sqlite") await tools.retype(TABLE, "links", "text");
    await tools.insert(TABLE, [
      {
        id: "p1",
        title: "a",
        author: "u1",
        ...(dialect !== "sqlite" ? { links: '[{"url":"x"}]' } : {}),
      },
    ]);
  });

  afterEach(async () => {
    for (const table of [TABLE, COLUMN_REPAIRS_TABLE]) {
      await run(`DROP TABLE IF EXISTS ${q(table)}`);
    }
    await handle?.destroy();
  });

  /** Each converting column's state and values. */
  async function legacyState() {
    const state: Record<string, unknown> = {};
    for (const column of columns) {
      state[column] = {
        column: await tools.columnState(TABLE, column),
        values: await tools.values(TABLE, column),
      };
    }
    return state;
  }

  it("migrate, upgrade and a production start leave every legacy column unchanged", async () => {
    const before = await legacyState();
    expect(
      (
        await dryRunReport({
          adapter: handle.adapter,
          dialect,
          entities: [entity()],
          nextlyVersion: "test",
        })
      ).result?.records
        .map(r => r.column)
        .sort()
    ).toEqual([...columns].sort());

    const noMigrations = mkdtempSync(join(tmpdir(), "repair-record-none-"));
    try {
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: handle.adapter.getDrizzle(),
        adapter: handle.adapter as unknown as Parameters<
          typeof migrateCore
        >[0]["adapter"],
        migrationsDir: noMigrations,
        logger: silent,
        lockMode: "fail-fast",
      });
    } finally {
      rmSync(noMigrations, { recursive: true, force: true });
    }
    expect(await legacyState(), "after nextly migrate").toEqual(before);

    await runUpgrade(
      { confirmBackedUp: true },
      {
        adapter: handle.adapter as never,
        logger: { info: () => {}, warn: () => {} },
      }
    );
    expect(await legacyState(), "after nextly upgrade").toEqual(before);

    // A production start migrates through this same `migrateCore` when migrations run at boot, and
    // otherwise changes no schema; a second run of it is the start against an up-to-date database.
    const again = mkdtempSync(join(tmpdir(), "repair-record-start-"));
    try {
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: handle.adapter.getDrizzle(),
        adapter: handle.adapter as unknown as Parameters<
          typeof migrateCore
        >[0]["adapter"],
        migrationsDir: again,
        logger: silent,
        lockMode: "fail-fast",
      });
    } finally {
      rmSync(again, { recursive: true, force: true });
    }
    expect(await legacyState(), "after a production start").toEqual(before);
  });

  it("reads the repair's record after an apply", async () => {
    const started = Date.now() - 2000;
    const report = await dryRunReport({
      adapter: handle.adapter,
      dialect,
      entities: [entity()],
      nextlyVersion: "test",
    });
    const document = await applyRepairs({
      adapter: handle.adapter,
      dialect,
      entities: [entity()],
      nextlyVersion: "test",
    });
    const ended = Date.now() + 2000;
    const repairs = await readRepairs(handle.adapter.getDrizzle(), dialect);
    expect(repairs.map(r => r.column).sort()).toEqual([...columns].sort());
    for (const column of columns) {
      expect(recordOf(document.result?.records, column).outcome).toBe(
        "converted"
      );
      const reported = recordOf(report.result?.records, column);
      expect(repairs.find(r => r.column === column)).toMatchObject({
        table: TABLE,
        column,
        from: { type: reported.live?.type, nullable: reported.live?.nullable },
        to: {
          type: reported.expected?.type,
          nullable: reported.expected?.nullable,
        },
        class: "safe",
        consent: false,
        valuesCleared: 0,
        state: "converted",
      });
    }
    // The time of each repair, as the database recorded it.
    const times = (await run(
      `SELECT ${q("started_at")} AS s, ${q("ended_at")} AS e FROM ${q(COLUMN_REPAIRS_TABLE)}`
    )) as Array<{ s: unknown; e: unknown }>;
    expect(times).toHaveLength(columns.length);
    for (const { s, e } of times) {
      for (const value of [s, e]) {
        // SQLite keeps unix seconds; the others a timestamp, as a Date or as UTC text.
        const ms =
          value instanceof Date
            ? value.getTime()
            : typeof value === "number"
              ? value * 1000
              : new Date(`${String(value).replace(" ", "T")}Z`).getTime();
        expect(ms).toBeGreaterThanOrEqual(started);
        expect(ms).toBeLessThanOrEqual(ended);
      }
    }
  });

  it("a repaired column reports nothing, db:sync plans nothing, and a later migration to the same type changes no value", async () => {
    await applyRepairs({
      adapter: handle.adapter,
      dialect,
      entities: [entity()],
      nextlyVersion: "test",
    });
    expect(
      (
        await dryRunReport({
          adapter: handle.adapter,
          dialect,
          entities: [entity()],
          nextlyVersion: "test",
        })
      ).result?.records
    ).toEqual([]);

    // The schema diff db:sync and the development push plan from: the repaired table against the
    // table they build from the same fields finds nothing to change in the repaired columns.
    const db = handle.adapter.getDrizzle();
    const live = await introspectLiveSnapshot(db, dialect, [TABLE]);
    const desired = {
      ...live,
      tables: [
        buildDesiredTableFromFields(
          TABLE,
          fields as unknown as Parameters<
            typeof buildDesiredTableFromFields
          >[1],
          dialect,
          {
            builtBy: builtByFor("collection", false),
            hasStatus: false,
            localized: false,
          }
        ),
      ],
    };
    const touching = diffSnapshots(live, desired).filter(op =>
      columns.some(column => JSON.stringify(op).includes(`"${column}"`))
    );
    expect(touching).toEqual([]);

    // A migration that converts each column to the type it already has changes no value.
    const values = await legacyState();
    for (const column of columns) {
      const state = await tools.columnState(TABLE, column);
      if (dialect === "postgresql") {
        await run(
          `ALTER TABLE ${q(TABLE)} ALTER COLUMN ${q(column)} TYPE ${state!.type} USING ${q(column)}::${state!.type}`
        );
      } else if (dialect === "mysql") {
        await run(
          `ALTER TABLE ${q(TABLE)} MODIFY ${q(column)} ${state!.type} ${state!.nullable ? "NULL" : "NOT NULL"}`
        );
      }
    }
    const after = await legacyState();
    for (const column of columns) {
      const read = (s: unknown) => {
        const { values: v } = s as { values: Record<string, unknown> };
        return column === "links"
          ? Object.fromEntries(
              Object.entries(v).map(([k, x]) => [k, x === null ? x : asJson(x)])
            )
          : v;
      };
      expect(read(after[column]), column).toEqual(read(values[column]));
    }
  });
});
