/**
 * A committed change of whether a field may be empty, its registry update not run, while the Builder
 * save that made it the process left part-way stands unsettled (`helpers/left-save-fixture.ts`). A
 * write that sets the field is refused, naming it, and changes nothing; writes of other fields go on;
 * a read is answered, never with a database error; and after the settle the writes are accepted.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { ServiceContainer } from "../../../../services";
import type { TestNextly } from "../../../../plugins/test-nextly";
import {
  killedAt,
  LEFT_SAVE_SUITES,
  leftSaveHooks,
  leftSaveSuite,
} from "./helpers/left-save-fixture";

vi.mock("../../busy-table/run-unit", async original =>
  (await import("./helpers/stop-at-kill")).stoppingUnits(
    await original<typeof import("../../busy-table/run-unit")>()
  )
);
vi.mock("../../../i18n/migration/held-leaving-drops", async original =>
  (await import("./helpers/stop-at-kill")).stoppingCompanion(
    await original<
      typeof import("../../../i18n/migration/held-leaving-drops")
    >()
  )
);
vi.mock("../../services/drizzle-statement-executor", async original =>
  (await import("./helpers/stop-at-kill")).stoppingStatements(
    await original<typeof import("../../services/drizzle-statement-executor")>()
  )
);

leftSaveHooks();

describe.each(LEFT_SAVE_SUITES)(
  "writes and reads while a Builder save that made a field required is left part-way ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      field,
      table,
      boot,
      versionOf,
      killSave,
      hero,
      fromAnotherProcess,
      afterStatement,
      databaseError,
      rows,
      settle,
      expectRefused,
    } = leftSaveSuite({ dialect, perLanguage });

    /** The statement that runs what the save prepared: the column restated as required. */
    const restates = (statement: string) => /^\s*EXECUTE\b/i.test(statement);

    /** Start the save that makes `note` required, and kill it once its column is. */
    async function killRequired(t: TestNextly): Promise<void> {
      const schemaVersion = await versionOf(t);
      await killSave(t, afterStatement(restates), () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields: [field("heading"), { ...field("note"), required: true }],
            confirmed: true,
            schemaVersion,
          }
        )
      );
    }

    /** Whether `note`'s column may be empty, as the database has it. */
    async function noteMayBeEmpty(t: TestNextly): Promise<string> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT IS_NULLABLE AS nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = 'note'`
      )) as unknown as Array<{ nullable: unknown }>;
      return String(row?.nullable);
    }

    it.runIf(dialect === "mysql")(
      "refuses a create that sets a field a committed change made required, over REST and the Direct API, changing nothing; lets a create that leaves it out through; answers reads; and accepts the create once settled",
      async () => {
        const t = await boot();
        await killRequired(t);
        expect(await noteMayBeEmpty(t), `killed at ${killedAt}`).toBe("NO");
        const before = await rows(t);

        const [rest, api, restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "write",
              via: "rest",
              data: { title: "R1", slug: "r1", note: "set" },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A1", slug: "a1", note: "set" },
            },
            {
              kind: "write",
              via: "rest",
              data: { title: "R2", slug: "r2", heading: "only the heading" },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A2", slug: "a2", heading: "only the heading" },
            },
            { kind: "read", via: "rest" },
            { kind: "read", via: "api" },
          ]);

        expectRefused(rest!, "note");
        expectRefused(api!, "note");
        const after = await rows(t);
        expect(after.filter(row => before.includes(row))).toEqual(before);
        // Each road is looked at whatever the other came to.
        for (const through of [restOther!, apiOther!]) {
          expect.soft(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
          expect(read.ok, JSON.stringify(read)).toBe(true);
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "R3", slug: "r3", note: "set" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "A3", slug: "a3", note: "set" },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "refuses an update that sets a field a committed change made required, over REST and the Direct API, changing nothing; lets one of another field through; and accepts the update once settled",
      async () => {
        const t = await boot();
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const id = String(first?.id);
        await killRequired(t);
        expect(await noteMayBeEmpty(t), `killed at ${killedAt}`).toBe("NO");
        const before = await rows(t);

        const [rest, api] = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            data: { note: "set", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            data: { note: "set", _overwrite: true },
          },
        ]);

        expectRefused(rest!, "note");
        expectRefused(api!, "note");
        expect(await rows(t), "nothing changed").toEqual(before);

        const [restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "update",
              via: "rest",
              id,
              data: { heading: "over REST", _overwrite: true },
            },
            {
              kind: "update",
              via: "api",
              id,
              data: { heading: "through the API", _overwrite: true },
            },
            { kind: "read", via: "rest" },
            { kind: "read", via: "api" },
          ]);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
          expect(read.ok, JSON.stringify(read)).toBe(true);
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            data: { note: "x", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            data: { note: "y", _overwrite: true },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "refuses publishing a held draft that sets a field a committed change made required, naming it, with the live entry unchanged",
      async () => {
        const t = await boot({ drafts: true });
        const created = (await t.nextly.create({
          collection: slug,
          data: {
            title: "Live",
            slug: "live",
            heading: "h",
            note: "live note",
            status: "published",
          },
        } as never)) as { item?: { id?: unknown } };
        const id = String(created.item?.id);
        await t.nextly.update({
          collection: slug,
          id,
          data: { note: "held note", _overwrite: true },
        } as never);
        await killRequired(t);
        expect(await noteMayBeEmpty(t), `killed at ${killedAt}`).toBe("NO");
        const before = await rows(t);

        const published = { status: "published", _overwrite: true };
        for (const refused of await fromAnotherProcess([
          { kind: "update", via: "rest", id, data: published },
          { kind: "update", via: "api", id, data: published },
        ])) {
          expectRefused(refused, "note");
        }
        expect(await rows(t), "nothing of either publish is written").toEqual(
          before
        );
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "refuses a Single's write that sets a field a committed change made required, over REST and the Direct API, changing nothing; lets one of another field through; reads it; and accepts the write once settled",
      async () => {
        const t = await boot();
        await dispatchSingles(
          "createSingle",
          {},
          { slug: hero, label: hero, fields: [field("heading"), field("note")] }
        );
        await t.nextly.updateSingle({
          slug: hero,
          data: { heading: "h", note: "n", _overwrite: true },
        } as never);
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(t, afterStatement(restates), () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields: [field("heading"), { ...field("note"), required: true }],
              confirmed: true,
              schemaVersion,
            }
          )
        );
        const stored = () =>
          t.adapter.executeQuery(`SELECT * FROM single_${hero}`);
        const before = await stored();

        const set = { note: "set", _overwrite: true };
        for (const refused of await fromAnotherProcess([
          { kind: "single-write", via: "rest", slug: hero, data: set },
          { kind: "single-write", via: "api", slug: hero, data: set },
        ])) {
          expectRefused(refused, "note");
        }
        expect(await stored(), "nothing changed").toEqual(before);

        const [restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "single-write",
              via: "rest",
              slug: hero,
              data: { heading: "over REST", _overwrite: true },
            },
            {
              kind: "single-write",
              via: "api",
              slug: hero,
              data: { heading: "through the API", _overwrite: true },
            },
            { kind: "single-read", via: "rest", slug: hero },
            { kind: "single-read", via: "api", slug: hero },
          ]);
        for (const through of [restOther!, apiOther!]) {
          expect.soft(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect.soft(databaseError(read), JSON.stringify(read)).toBe(false);
          expect
            .soft(read.item?.heading, JSON.stringify(read))
            .toBe("through the API");
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "single-write",
            via: "rest",
            slug: hero,
            data: { note: "x", _overwrite: true },
          },
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { note: "y", _overwrite: true },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "answers a list and one filtered by a field a committed change made required, over REST and the Direct API, never with a database error",
      async () => {
        const t = await boot();
        await killRequired(t);
        for (const read of await fromAnotherProcess([
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
          { kind: "read", via: "rest", query: "where[note][equals]=n" },
          { kind: "read", via: "api", where: { note: { equals: "n" } } },
          { kind: "read", via: "rest", query: "sort=note" },
        ])) {
          expect.soft(databaseError(read), JSON.stringify(read)).toBe(false);
          expect.soft(read.ok, JSON.stringify(read)).toBe(true);
          expect
            .soft(
              read.items?.some(item => item.slug === "first"),
              JSON.stringify(read)
            )
            .toBe(true);
        }
      },
      600_000
    );

    // PostgreSQL and SQLite run a file in one transaction, so a kill finds none or all of the change:
    // killed before the file ran, the write that sets the field is as it ever was. A type change is a
    // push there, in one transaction of its own, which has no point before its statement.
    it.runIf(dialect !== "mysql" && !perLanguage)(
      "refuses no write where a save that makes a field required was killed before its file ran",
      async () => {
        const t = await boot();
        const schemaVersion = await versionOf(t);
        await killSave(
          t,
          point => point.startsWith("unit:"),
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: slug },
              {
                fields: [
                  field("heading"),
                  { ...field("note"), required: true },
                ],
                confirmed: true,
                schemaVersion,
              }
            )
        );
        for (const accepted of await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "R1", slug: "r1", note: "set" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "A1", slug: "a1", note: "set" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );
  }
);
