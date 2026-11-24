/**
 * A committed change of a field's type, or of whether it may be empty, its registry update not run,
 * while the Builder save that made it the process left part-way stands unsettled
 * (`helpers/left-save-fixture.ts`). A write that sets the field is refused, naming it, and changes
 * nothing; writes of other fields go on; a read is answered, never with a database error; and after
 * the settle the writes are accepted.
 */
import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { ServiceContainer } from "../../../../services";
import type { TestNextly } from "../../../../plugins/test-nextly";
import { settleLeftSaves } from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";
import {
  basePath,
  killedAt,
  leftSaveHooks,
  leftSaveSuite,
  LEFT_SAVE_SUITES,
  MIGRATIONS,
  text,
  type Outcome,
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
  "writes and reads while a Builder save that changed a field's type is left part-way ($dialect, $layout)",
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
    } = leftSaveSuite({ dialect, perLanguage });

    /** The statement that changes the type of `heading`'s column. */
    const retypes = (statement: string) =>
      /^\s*ALTER\s+TABLE\b.*MODIFY\s+COLUMN\s+`?heading`?/is.test(statement);

    /**
     * Start the save that makes `heading` text, a number until then, and kill it once its column is;
     * `note` is translated with `languages`.
     */
    async function killRetype(
      t: TestNextly,
      { languages = false }: { languages?: boolean } = {}
    ): Promise<void> {
      const schemaVersion = await versionOf(t);
      await killSave(t, afterStatement(retypes), () =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            // Shared, where the collection translates its text fields: its column is the main table's.
            fields: languages
              ? [{ ...text("heading"), localized: false }, text("note")]
              : [field("heading"), field("note")],
            confirmed: true,
            schemaVersion,
          }
        )
      );
    }

    /** The type of `heading`'s column as the database has it. */
    async function headingType(t: TestNextly): Promise<string> {
      const [row] = (await t.adapter.executeQuery(
        `SELECT DATA_TYPE AS type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = 'heading'`
      )) as unknown as Array<{ type: unknown }>;
      return String(row?.type);
    }

    /** Every row of the collection's table, as the database holds it. */
    async function rows(t: TestNextly): Promise<string[]> {
      const found = (await t.adapter.executeQuery(
        `SELECT * FROM ${table} ORDER BY slug`
      )) as unknown as Array<Record<string, unknown>>;
      return found.map(row => JSON.stringify(row));
    }

    /** Every translation the collection's companion holds. */
    async function translations(t: TestNextly): Promise<string[]> {
      const found = (await t.adapter.executeQuery(
        `SELECT * FROM ${table}_locales ORDER BY _parent, _locale`
      )) as unknown as Array<Record<string, unknown>>;
      return found.map(row => JSON.stringify(row));
    }

    /** Settled as the next development start does. */
    const settle = (t: TestNextly) =>
      settleLeftSaves({
        adapter: t.adapter,
        projectRoot: basePath,
        migrationsDir: join(basePath, MIGRATIONS),
        logger: { info: () => undefined, warn: () => undefined },
        writeRegistry: settleRegistryWriter(t.adapter),
      });

    /** What a refused write answers: the field named, under its own code, over REST as a 409. */
    function expectRefused(refused: Outcome, named = "heading"): void {
      expect(refused.ok, JSON.stringify(refused)).toBe(false);
      expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
      expect(refused.code, JSON.stringify(refused)).toBe(
        "BUILDER_SAVE_FIELD_UNSETTLED"
      );
      expect(refused.message, JSON.stringify(refused)).toMatch(`"${named}"`);
      if (refused.via === "rest") expect(refused.status).toBe(409);
    }

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
      "refuses a create that sets the field, over REST and the Direct API, changing nothing; lets one of another field through; answers reads; and accepts the create once settled",
      async () => {
        const t = await boot({ numeric: true });
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");
        const before = await rows(t);

        const [rest, api, restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "write",
              via: "rest",
              data: { title: "R1", slug: "r1", heading: 8 },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A1", slug: "a1", heading: 8 },
            },
            {
              kind: "write",
              via: "rest",
              data: { title: "R2", slug: "r2", note: "only the note" },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A2", slug: "a2", note: "only the note" },
            },
            { kind: "read", via: "rest" },
            { kind: "read", via: "api" },
          ]);

        expectRefused(rest!);
        expectRefused(api!);
        const after = await rows(t);
        expect(after.filter(row => before.includes(row))).toEqual(before);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        // Only the two writes of another field left a row.
        expect(after).toHaveLength(before.length + 2);
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
          expect(read.ok, JSON.stringify(read)).toBe(true);
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "R3", slug: "r3", heading: "x" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "A3", slug: "a3", heading: "x" },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "on a collection translated in two languages, refuses a create and an update that set the field in either language, keeping both translations; lets another field through in each; and reads each",
      async () => {
        const t = await boot({ numeric: true, languages: true });
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const id = String(first?.id);
        await killRetype(t, { languages: true });
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");
        const before = await rows(t);
        const translated = await translations(t);
        expect(
          translated.length,
          "the entry is written in both languages"
        ).toBeGreaterThanOrEqual(2);

        const held = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            locale: "es",
            data: { heading: 8, _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            locale: "es",
            data: { heading: 8, _overwrite: true },
          },
          {
            kind: "write",
            via: "rest",
            locale: "es",
            data: { title: "R1", slug: "r1", heading: 8 },
          },
          {
            kind: "write",
            via: "api",
            locale: "es",
            data: { title: "A1", slug: "a1", heading: 8 },
          },
        ]);
        for (const refused of held) expectRefused(refused);
        expect(await rows(t), "no row changed").toEqual(before);
        expect(await translations(t), "no translation changed").toEqual(
          translated
        );

        const through = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            locale: "es",
            data: { note: "nota nueva", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            locale: "en",
            data: { note: "only english", _overwrite: true },
          },
          {
            kind: "write",
            via: "api",
            locale: "es",
            data: { title: "A2", slug: "a2", note: "hola" },
          },
        ]);
        for (const outcome of through) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }

        const [esRest, esApi, enRest, enApi] = await fromAnotherProcess([
          { kind: "read", via: "rest", locale: "es" },
          { kind: "read", via: "api", locale: "es" },
          { kind: "read", via: "rest", locale: "en" },
          { kind: "read", via: "api", locale: "en" },
        ]);
        const noteOf = (read: Outcome) =>
          read.items?.find(item => item.slug === "first")?.note;
        for (const read of [esRest!, esApi!, enRest!, enApi!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
          expect(read.ok, JSON.stringify(read)).toBe(true);
        }
        expect([noteOf(esRest!), noteOf(esApi!)]).toEqual([
          "nota nueva",
          "nota nueva",
        ]);
        expect([noteOf(enRest!), noteOf(enApi!)]).toEqual([
          "only english",
          "only english",
        ]);

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            locale: "es",
            data: { heading: "x", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            locale: "en",
            data: { heading: "y", _overwrite: true },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "refuses an update that sets the field, over REST and the Direct API, changing nothing; lets one of another field through; and accepts the update once settled",
      async () => {
        const t = await boot({ numeric: true });
        const [first] = (await t.adapter.executeQuery(
          `SELECT id FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ id: unknown }>;
        const id = String(first?.id);
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");
        const before = await rows(t);

        const [rest, api] = await fromAnotherProcess([
          {
            kind: "update",
            via: "rest",
            id,
            data: { heading: 8, _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            data: { heading: 8, _overwrite: true },
          },
        ]);

        expectRefused(rest!);
        expectRefused(api!);
        expect(await rows(t), "nothing changed").toEqual(before);

        const [restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "update",
              via: "rest",
              id,
              data: { note: "over REST", _overwrite: true },
            },
            {
              kind: "update",
              via: "api",
              id,
              data: { note: "through the API", _overwrite: true },
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
            data: { heading: "x", _overwrite: true },
          },
          {
            kind: "update",
            via: "api",
            id,
            data: { heading: "y", _overwrite: true },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

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

    // Any process may settle the save, as its development start does, and the refusal ends for every
    // one of them: the same process sends the write again, and so does another that was never told.
    it.runIf(dialect === "mysql")(
      "ends the refusal for every process once the second process settles the save",
      async () => {
        const t = await boot({ numeric: true });
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");

        const [refused, settled, accepted, again] = await fromAnotherProcess(
          [
            {
              kind: "write",
              via: "rest",
              data: { title: "R1", slug: "r1", heading: 8 },
            },
            { kind: "settle", via: "api" },
            {
              kind: "write",
              via: "rest",
              data: { title: "R2", slug: "r2", heading: "x" },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A2", slug: "a2", heading: "y" },
            },
          ],
          { settles: true }
        );
        expectRefused(refused!);
        expect(settled!.ok, JSON.stringify(settled)).toBe(true);
        expect(accepted!.ok, JSON.stringify(accepted)).toBe(true);
        expect(again!.ok, JSON.stringify(again)).toBe(true);

        for (const later of await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "R3", slug: "r3", heading: "z" },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "A3", slug: "a3", heading: "z" },
          },
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
        ])) {
          expect(later.ok, JSON.stringify(later)).toBe(true);
        }
      },
      600_000
    );

    // A publish writes the entry's held draft into the live row, whatever the request itself sets.
    it.runIf(dialect === "mysql")(
      "refuses publishing a held draft that sets the field, naming it, with the live entry unchanged",
      async () => {
        const t = await boot({ drafts: true, numeric: true });
        const created = (await t.nextly.create({
          collection: slug,
          data: {
            title: "Live",
            slug: "live",
            heading: 3,
            note: "n",
            status: "published",
          },
        } as never)) as { item?: { id?: unknown } };
        const id = String(created.item?.id);
        await t.nextly.update({
          collection: slug,
          id,
          data: { heading: 9, _overwrite: true },
        } as never);
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");
        const before = await rows(t);

        const published = { status: "published", _overwrite: true };
        for (const refused of await fromAnotherProcess([
          { kind: "update", via: "rest", id, data: published },
          { kind: "update", via: "api", id, data: published },
        ])) {
          expectRefused(refused);
        }
        expect(await rows(t), "nothing of either publish is written").toEqual(
          before
        );
      },
      600_000
    );

    // A Single's document is made on its first write, and its later ones update it: both set the
    // field, or leave it alone.
    it.runIf(dialect === "mysql").each([
      ["before its document is made", false],
      ["once its document is made", true],
    ] as const)(
      "refuses a Single's write that sets the field %s, over REST and the Direct API, changing nothing; lets one of another field through; reads it; and accepts the write once settled",
      async (_when, made) => {
        const t = await boot();
        const numeric = { ...field("heading"), type: "number" };
        await dispatchSingles(
          "createSingle",
          {},
          { slug: hero, label: hero, fields: [numeric, field("note")] }
        );
        if (made) {
          await t.nextly.updateSingle({
            slug: hero,
            data: { heading: 7, note: "n", _overwrite: true },
          } as never);
        }
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(t, afterStatement(retypes), () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields: [field("heading"), field("note")],
              confirmed: true,
              schemaVersion,
            }
          )
        );
        const before = (await t.adapter.executeQuery(
          `SELECT * FROM single_${hero}`
        )) as unknown as Array<Record<string, unknown>>;

        const set = { heading: 8, _overwrite: true };
        for (const refused of await fromAnotherProcess([
          { kind: "single-write", via: "rest", slug: hero, data: set },
          { kind: "single-write", via: "api", slug: hero, data: set },
        ])) {
          expectRefused(refused);
        }
        expect(
          (await t.adapter.executeQuery(
            `SELECT * FROM single_${hero}`
          )) as unknown as Array<Record<string, unknown>>,
          "nothing changed"
        ).toEqual(before);

        const [restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "single-write",
              via: "rest",
              slug: hero,
              data: { note: "over REST", _overwrite: true },
            },
            {
              kind: "single-write",
              via: "api",
              slug: hero,
              data: { note: "through the API", _overwrite: true },
            },
            { kind: "single-read", via: "rest", slug: hero },
            { kind: "single-read", via: "api", slug: hero },
          ]);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
          expect(read.item?.note, JSON.stringify(read)).toBe("through the API");
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess([
          {
            kind: "single-write",
            via: "rest",
            slug: hero,
            data: { heading: "x", _overwrite: true },
          },
          {
            kind: "single-write",
            via: "api",
            slug: hero,
            data: { heading: "y", _overwrite: true },
          },
        ])) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "answers a list and one filtered by the field and by another, over REST and the Direct API, never with a database error",
      async () => {
        const t = await boot({ numeric: true });
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");

        const reads = await fromAnotherProcess([
          { kind: "read", via: "rest" },
          { kind: "read", via: "api" },
          {
            kind: "read",
            via: "rest",
            query: "where[heading][equals]=7",
          },
          {
            kind: "read",
            via: "api",
            where: { heading: { equals: 7 } },
          },
          { kind: "read", via: "rest", query: "where[note][equals]=n" },
          { kind: "read", via: "api", where: { note: { equals: "n" } } },
          { kind: "read", via: "rest", query: "sort=heading" },
        ]);
        for (const read of reads) {
          expect.soft(databaseError(read), JSON.stringify(read)).toBe(false);
          expect.soft(read.ok, JSON.stringify(read)).toBe(true);
        }
        // Filtered by the field or not, the entry is among them.
        for (const read of [reads[0]!, reads[1]!, reads[4]!, reads[5]!]) {
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

    it.runIf(dialect === "mysql")(
      "populates a relationship to the collection on a read of another, over REST and the Direct API",
      async () => {
        const t = await boot({ numeric: true });
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
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");

        for (const read of await fromAnotherProcess([
          { kind: "read", via: "rest", slug: refs, depth: 1 },
          { kind: "read", via: "api", slug: refs, depth: 1 },
        ])) {
          expect(read.ok, JSON.stringify(read)).toBe(true);
          expect(read.items?.[0]?.target, JSON.stringify(read)).toMatchObject({
            id: firstId,
            note: "n",
          });
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

    // Only the settle lifts the refusal: a settle the history refuses leaves it as it is.
    it.runIf(dialect === "mysql")(
      "leaves the refusal in place where a settle is refused by the migration history",
      async () => {
        const t = await boot({ numeric: true });
        const applied = readdirSync(join(basePath, MIGRATIONS)).find(file =>
          file.endsWith(".sql")
        )!;
        await killRetype(t);
        expect(await headingType(t), `killed at ${killedAt}`).toBe("text");
        // An applied file edited since: the settle's own history checks stop before its first write.
        appendFileSync(join(basePath, MIGRATIONS, applied), "\n-- edited\n");

        await expect(settle(t)).rejects.toThrow();
        for (const refused of await fromAnotherProcess([
          {
            kind: "write",
            via: "rest",
            data: { title: "R1", slug: "r1", heading: 8 },
          },
          {
            kind: "write",
            via: "api",
            data: { title: "A1", slug: "a1", heading: 8 },
          },
        ])) {
          expectRefused(refused);
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
