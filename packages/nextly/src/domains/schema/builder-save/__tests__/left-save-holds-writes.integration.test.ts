/**
 * Writes of an entity's fields while a Builder save the process left part-way stands unsettled: a write
 * that sets a field it changed is refused, naming it, and others go on, until the settle lifts it
 * (`helpers/left-save-fixture.ts`).
 */
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { settleLeftSaves } from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";
import { describe, expect, it, vi } from "vitest";

import { SchemaOwnersRepository } from "../../ownership/schema-owners-repository";
import {
  leftSaveHooks,
  leftSaveSuite,
  LEFT_SAVE_SUITES,
  MIGRATIONS,
  basePath,
  killedAt,
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
      table,
      boot,
      liveColumns,
      killRename,
      fromAnotherProcess,
      operations,
      afterStatement,
      renames,
      databaseError,
    } = leftSaveSuite({ dialect, perLanguage });

    it.runIf(dialect === "mysql")(
      "refuses a write setting a field a committed rename changed, naming it, from another process; lets the rest through; and answers reads without a database error",
      async () => {
        const t = await boot();
        // Killed once the rename has committed, before its registry update: after the statement
        // that renames, read from the file the save runs, as no query may run beside the save.
        await killRename(t, afterStatement(renames("heading")));
        const columns = await liveColumns(t);
        expect(columns, `killed at ${killedAt}`).toContain("headline");
        expect(columns, `killed at ${killedAt}`).not.toContain("heading");
        // On both layouts the dialog's save of a field kept on the main table runs its own file.
        expect(killedAt).toMatch(/_update\.sql: after statement/);

        const held = await fromAnotherProcess(operations("heading", 1));

        const [restSets, apiSets, restOther, apiOther, restRead, apiRead] =
          held;
        for (const refused of [restSets!, apiSets!]) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
          // Its own code, apart from any other conflict: a release run stops on it, naming the field.
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
        }
        expect(restSets!.status).toBe(409);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
        }

        // The next development start settles the save: both writes go through again.
        await settleLeftSaves({
          adapter: t.adapter,
          projectRoot: basePath,
          migrationsDir: join(basePath, MIGRATIONS),
          logger: { info: () => undefined, warn: () => undefined },
          writeRegistry: settleRegistryWriter(t.adapter),
        });
        const settled = await fromAnotherProcess(operations("headline", 2));
        for (const outcome of settled) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );

    // A publish writes the entry's held draft into the live row, whatever the request itself sets:
    // here only the status, with the draft holding the field the rename changed. A release run
    // publishes the same way.
    it.runIf(dialect === "mysql")(
      "refuses publishing a held draft that sets a field a committed rename changed, naming it, with the live entry unchanged",
      async () => {
        const t = await boot({ drafts: true });
        const created = (await t.nextly.create({
          collection: slug,
          data: {
            title: "Live",
            slug: "live",
            heading: "live heading",
            note: "n",
            status: "published",
          },
        } as never)) as { item?: { id?: unknown } };
        const id = String(created.item?.id);
        // The edit is held as the entry's draft, the live row as it was.
        await t.nextly.update({
          collection: slug,
          id,
          data: { heading: "held heading", _overwrite: true },
        } as never);
        const [before] = (await t.adapter.executeQuery(
          `SELECT heading FROM ${table} WHERE id = '${id}'`
        )) as unknown as Array<{ heading: unknown }>;
        expect(before?.heading, "the edit is held, not live").toBe(
          "live heading"
        );
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const published = { status: "published", _overwrite: true };
        const outcomes = await fromAnotherProcess([
          { kind: "update", via: "rest", id, data: published },
          { kind: "update", via: "api", id, data: published },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        // Nothing of either publish was written: the live value is the one before the draft.
        const [live] = (await t.adapter.executeQuery(
          `SELECT headline FROM ${table} WHERE id = '${id}'`
        )) as unknown as Array<{ headline: unknown }>;
        expect(live?.headline).toBe("live heading");
      },
      600_000
    );

    // A create's defaults are written with it: one for a field a committed rename holds sets that
    // field, though the request names only another.
    it.runIf(dialect === "mysql")(
      "refuses a create whose default sets a field a committed rename changed, writing nothing",
      async () => {
        const t = await boot({ headingDefault: "a default" });
        await killRename(t, afterStatement(renames("heading")));
        expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
          "headline"
        );

        const outcomes = await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "D1", slug: "d1", note: "only the note" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "D2", slug: "d2", note: "only the note" },
          },
        ]);

        for (const refused of outcomes) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(refused.code, JSON.stringify(refused)).toBe(
            "BUILDER_SAVE_FIELD_UNSETTLED"
          );
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        const rows = (await t.adapter.executeQuery(
          `SELECT slug FROM ${table}`
        )) as unknown as Array<{ slug: unknown }>;
        expect(rows.map(row => row.slug)).toEqual(["first"]);
      },
      600_000
    );

    // A column the registry row declares is the entity's, whoever a record names as its owner (a
    // collection demoted from code keeps the column a plugin's hook added there, and its record).
    it.runIf(dialect === "mysql")(
      "serves a write setting a field whose column a record names another owner's, and refuses the one a committed rename changed",
      async () => {
        const t = await boot();
        await killRename(t, afterStatement(renames("heading")));
        await new SchemaOwnersRepository(
          t.adapter.getDrizzle(),
          dialect
        ).upsert([
          {
            tableName: table,
            elementKind: "column",
            elementName: "note",
            ownerKind: "plugin",
            ownerId: "@t/left-save-writes",
            migratedBy: "plugin:@t/left-save-writes",
            ownerVersion: "1.0.0",
            schemaVersion: 1,
            state: "active",
          },
        ]);

        const [served, refused] = await fromAnotherProcess([
          {
            kind: "write",
            via: "api",
            data: { title: "N1", slug: "n1", note: "a note" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "H1", slug: "h1", heading: "a heading" },
          },
        ]);

        expect(served!.ok, JSON.stringify(served)).toBe(true);
        expect(refused!.code, JSON.stringify(refused)).toBe(
          "BUILDER_SAVE_FIELD_UNSETTLED"
        );
        expect(refused!.message, JSON.stringify(refused)).toMatch(/heading/);
      },
      600_000
    );

    // Killed before its file starts: a save that runs its file has a point there. One that pushes
    // (values kept per language) has none before its first statement; the comparison the hold
    // makes is the same on both, nothing changed and nothing held.
    it.runIf(!perLanguage)(
      "refuses no write where the save was killed before its file ran",
      async () => {
        const t = await boot();
        // Before the save's first file runs, whichever file that is.
        await killRename(t, point => point.startsWith("unit:"));
        expect(await liveColumns(t)).toContain("heading");

        const outcomes = await fromAnotherProcess(operations("heading", 1));

        for (const outcome of outcomes) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );
  }
);
