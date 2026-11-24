/**
 * Reads, and the entities a whole change reaches, while a Builder save the process left part-way
 * stands unsettled (`helpers/left-save-fixture.ts`).
 */
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { ServiceContainer } from "../../../../services";
import { describe, expect, it, vi } from "vitest";

import {
  leftSaveHooks,
  leftSaveSuite,
  LEFT_SAVE_SUITES,
  killedAt,
  text,
  type Field,
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
  "writes and reads while a Builder save is left part-way ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      field,
      table,
      hero,
      card,
      boot,
      liveColumns,
      rowsNaming,
      versionOf,
      dropHeading,
      renameHeading,
      killRename,
      killSave,
      fromAnotherProcess,
      afterStatement,
      renames,
      dropsColumn,
      databaseError,
    } = leftSaveSuite({ dialect, perLanguage });

    // A read of another collection populates its relationship to this one: the related rows are
    // read as this collection's tables hold them, never dropped for a database error.
    it.runIf(dialect === "mysql")(
      "populates a relationship to a collection a committed rename changed, on a read of another collection",
      async () => {
        const t = await boot();
        const refs = `held_refs_${dialect.slice(0, 2)}`;
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: refs,
            label: refs,
            fields: [
              { name: "target", type: "relationship", relationTo: slug },
            ],
          }
        );
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const firstId = String(first?.id);
        await t.nextly.create({
          collection: refs,
          data: { title: "Ref", slug: "ref", target: firstId },
        } as never);
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const outcomes = await fromAnotherProcess([
          { kind: "read", via: "rest", slug: refs, depth: 1 },
          { kind: "read", via: "api", slug: refs, depth: 1 },
        ]);

        for (const read of outcomes) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(read.items?.[0]?.target, JSON.stringify(read)).toMatchObject({
            id: firstId,
            note: "n",
          });
        }
      },
      600_000
    );

    // Turning Draft/Published off drops the status column the registry row still declares: no
    // read can leave it out, so the whole collection is held, its reads included. Kept to the
    // earlier layout: on per-language storage the save that turns it off reaches no kill point here.
    it.runIf(dialect === "mysql" && !perLanguage)(
      "refuses every write and read of a collection whose committed change dropped its status column",
      async () => {
        const t = await boot({ status: true });
        // The settings save turns it off; the schema save only ever turns it on.
        await killSave(t, afterStatement(dropsColumn("status")), () =>
          dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: slug },
            { fields: [field("heading"), field("note")], status: false }
          )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "status"
        );

        const outcomes = await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "S1", slug: "s1", note: "only the note" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "S2", slug: "s2", note: "only the note" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
        }
      },
      600_000
    );

    // The hold is the whole entity's, so a write naming no field of it, the status alone, is held
    // too. Kept to the earlier layout: on per-language storage the save that drops the column has
    // not reached a kill point here.
    it.runIf(dialect === "mysql" && !perLanguage)(
      "refuses an update naming only the status of a collection whose committed change dropped its status column",
      async () => {
        const t = await boot({ status: true });
        await t.nextly.create({
          collection: slug,
          data: { title: "Second", slug: "second", note: "n", heading: "h" },
        } as never);
        // One entry for each road, so what either write kept is read on its own.
        const entries = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} ORDER BY slug`
        )) as unknown as Array<{ id: unknown }>;
        const [overRest, overApi] = entries.map(entry => String(entry.id));
        await killSave(t, afterStatement(dropsColumn("status")), () =>
          dispatchCollections(
            {} as ServiceContainer,
            "updateCollection",
            { collectionName: slug },
            { fields: [field("heading"), field("note")], status: false }
          )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "status"
        );
        const before = {
          rest: await rowsNaming(t, overRest!),
          api: await rowsNaming(t, overApi!),
        };
        // The entry's own row is among them.
        for (const rows of [before.rest, before.api]) {
          expect(rows.some(row => row.startsWith(`${table} `))).toBe(true);
        }

        const outcomes = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id: overRest!,
            data: { status: "published", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id: overApi!,
            data: { status: "published", _overwrite: true },
          },
        ]);
        const after = {
          rest: await rowsNaming(t, overRest!),
          api: await rowsNaming(t, overApi!),
        };

        // Each is looked at whatever the others came to: what it answered, and what it kept.
        for (const refused of outcomes) {
          expect.soft(refused.ok, JSON.stringify(refused)).toBe(false);
          expect
            .soft(refused.code, JSON.stringify(refused))
            .toBe("BUILDER_SAVE_FIELD_UNSETTLED");
        }
        expect
          .soft(after.rest, "nothing of the REST write is kept")
          .toEqual(before.rest);
        expect
          .soft(after.api, "nothing of the Direct API write is kept")
          .toEqual(before.api);
      },
      600_000
    );

    // A field group's rows are kept in its own table, which its save changed: each field of the
    // collection holding the group is held, and the collection's reads, which reach that table.
    it.runIf(dialect === "mysql")(
      "refuses a write setting a field that holds a field group a committed rename changed, and the collection's reads, naming the field group",
      async () => {
        const t = await boot({ card: true });
        const schemaVersion = await versionOf(t, "dynamic_components", card);
        await killSave(t, afterStatement(renames("label")), () =>
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: card },
            {
              fields: [field("caption")],
              confirmed: true,
              schemaVersion,
              renameResolutions: [
                {
                  tableName: `comp_${card}`,
                  fromColumn: "label",
                  toColumn: "caption",
                  choice: "rename",
                },
              ],
            }
          )
        );

        expect(
          await liveColumns(t, `comp_${card}`),
          `killed at ${killedAt}`
        ).toContain("caption");

        const [restSets, apiSets, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "write",
              via: "rest",
              data: { title: "C1", slug: "c1", card: { label: "x" } },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "C2", slug: "c2", card: { label: "y" } },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "C3", slug: "c3", note: "only the note" },
            },
            { kind: "read", via: "rest" },
            { kind: "read", via: "api" },
          ]);

        for (const refused of [restSets!, apiSets!, restRead!, apiRead!]) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toContain(
            `field group "${card}"`
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/"card"/);
        }
        // What each write left, read past the guard: a refused write nothing, the other its row.
        const rows = (await t.adapter.executeQuery(
          `SELECT slug FROM ${table} ORDER BY slug`
        )) as unknown as Array<{ slug: unknown }>;
        const left = rows.map(row => row.slug);
        expect(apiOther!.ok, JSON.stringify({ apiOther, left })).toBe(true);
        expect(left).toEqual(["c3", "first"]);
      },
      600_000
    );

    // A Single's first write, and its first read, insert its document with each field's default:
    // where a committed rename holds a field that has one, both are refused, with nothing written.
    it.runIf(dialect === "mysql")(
      "refuses a Single's first write and first read where a field with a default is one a committed rename changed",
      async () => {
        const t = await boot();
        const withDefault = (name: string): Field => ({
          ...field(name),
          defaultValue: "a default",
        });
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: hero,
            label: hero,
            fields: [withDefault("heading"), field("note")],
          }
        );
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(t, afterStatement(renames("heading")), () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields: [withDefault("headline"), field("note")],
              confirmed: true,
              schemaVersion,
              ...renameHeading(`single_${hero}`),
            }
          )
        );

        expect(
          await liveColumns(t, `single_${hero}`),
          `killed at ${killedAt}`
        ).toContain("headline");

        const outcomes = await fromAnotherProcess([
          {
            kind: "single-write",
            via: "rest",
            slug: hero,
            data: { note: "only the note", _overwrite: true },
          },
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { note: "only the note", _overwrite: true },
          },
          { kind: "single-read", via: "rest", slug: hero },
          { kind: "single-read", via: "api", slug: hero },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        expect(
          await t.adapter.executeQuery(`SELECT id FROM single_${hero}`),
          "no document inserted"
        ).toEqual([]);
      },
      600_000
    );

    // A registry write anywhere moves the stored schema version, and the next request loads every
    // entity's tables again from the registry rows: what the guard left out of this process's
    // tables is left out again, so no read names the column the save moved.
    it.runIf(dialect === "mysql")(
      "answers reads and lets other writes through after the definitions are loaded again while the save stands",
      async () => {
        const t = await boot();
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );
        const other = (n: number) => ({
          title: `M${n}`,
          slug: `m${n}`,
          note: "only the note",
        });

        const outcomes = await fromAnotherProcess([
          { kind: "read", via: "api" },
          { kind: "write", via: "api", data: other(1) },
          { kind: "registry-moved", via: "api" },
          { kind: "read", via: "api" },
          { kind: "read", via: "rest" },
          { kind: "write", via: "api", data: other(2) },
          { kind: "write", via: "rest", data: other(3) },
        ]);

        for (const outcome of outcomes) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );

    // A translatable field's column is the translations table's, which the save brings in step once
    // its file has run, and the file wrote the registry row. Killed once that column is gone, the
    // row no longer declares the field, so none is held: writes of the entity's other fields go on,
    // and no read names the column.
    it.runIf(dialect === "mysql" && perLanguage)(
      "lets writes and reads of a collection through once a committed drop took a translatable field's column",
      async () => {
        const t = await boot({ translatable: true });
        const schemaVersion = await versionOf(t);
        await killSave(
          t,
          point => point === "companion: after",
          () =>
            dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: slug },
              {
                fields: [field("note")],
                confirmed: true,
                schemaVersion,
                ...dropHeading(0),
              }
            )
        );
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          "heading"
        );

        const [other, rest, api] = await fromAnotherProcess([
          {
            kind: "write",
            via: "api",
            data: { title: "T2", slug: "t2", note: "only the note" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ]);

        expect(other!.ok, JSON.stringify(other)).toBe(true);
        for (const read of [rest!, api!]) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(
            read.items?.some(item => item.note === "n"),
            JSON.stringify(read)
          ).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql" && perLanguage)(
      "lets writes and reads of a Single through once a committed drop took a translatable field's column",
      async () => {
        const t = await boot();
        await dispatchSingles(
          "createSingle",
          {},
          { slug: hero, label: hero, fields: [text("heading"), field("note")] }
        );
        await t.nextly.updateSingle({
          slug: hero,
          data: { note: "n", _overwrite: true },
        } as never);
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(
          t,
          point => point === "companion: after",
          () =>
            dispatchSingles(
              "applySingleSchemaChanges",
              { slug: hero },
              {
                fields: [field("note")],
                confirmed: true,
                schemaVersion,
                ...dropHeading(0),
              }
            )
        );
        expect(
          await liveColumns(t, `single_${hero}`),
          `killed at ${killedAt}`
        ).not.toContain("heading");

        const [other, rest, api] = await fromAnotherProcess([
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { note: "other", _overwrite: true },
          },
          { kind: "single-read", via: "rest", slug: hero },
          { kind: "single-read", via: "api", slug: hero },
        ]);

        expect(other!.ok, JSON.stringify(other)).toBe(true);
        for (const read of [rest!, api!]) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(read.item?.note, JSON.stringify(read)).toBe("other");
        }
      },
      600_000
    );
  }
);
