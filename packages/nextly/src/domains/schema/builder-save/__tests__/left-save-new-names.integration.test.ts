/**
 * A Builder save the process left part-way, with the column of a field it adds, or of one it renames
 * under its new name, committed and its registry update not run (`helpers/left-save-fixture.ts`). No
 * field the registry names is the one written, so an entry made with the new name goes on, and what it
 * wrote is there after the settle, whichever way that ends: the save finished, the part of it that
 * applied kept, or left standing until the next save. A save the settle undoes had added or renamed no
 * column, so no entry made with the new name was accepted for it to lose. An update that names it is
 * refused, as it is where no save stands: the entry's fields do not hold that name.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import {
  killedAt,
  LEFT_SAVE_SUITES,
  leftSaveHooks,
  leftSaveSuite,
  type Field,
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
vi.mock("../../pipeline/pre-resolution/executor", async original =>
  (await import("./helpers/stop-at-kill")).stoppingPushes(
    await original<typeof import("../../pipeline/pre-resolution/executor")>()
  )
);

leftSaveHooks();

describe.each(LEFT_SAVE_SUITES)(
  "writes under a field's new name while the Builder save that gives it stands left part-way ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      field,
      table,
      boot,
      versionOf,
      liveColumns,
      killSave,
      fromAnotherProcess,
      afterStatement,
      renames,
      rows,
      settle,
    } = leftSaveSuite({ dialect, perLanguage });

    /** What a save asks for: the field written to under its new name, and what the save sends. */
    interface Change {
      /** The new name, and its column. */
      name: string;
      /** The name whose column stands only once the whole of it ran. */
      whole: string;
      fields: Field[];
      renamed?: { from: string; to: string };
    }
    const heading = field("heading");
    const ADDS: Change = {
      name: "alpha",
      whole: "beta",
      fields: [heading, field("note"), field("alpha"), field("beta")],
    };
    const RENAMES: Change = {
      name: "remark",
      whole: "remark",
      fields: [heading, field("remark")],
      renamed: { from: "note", to: "remark" },
    };

    /** A road a save of the collection takes. */
    interface Road {
      boot: () => Promise<TestNextly>;
      save: (
        t: TestNextly,
        change: Pick<Change, "fields" | "renamed">
      ) => Promise<unknown>;
      /** Its kill point before any statement ran. */
      before: (point: string) => boolean;
      /** Its kill point once the column of `change`'s new name stands, and no later one. */
      afterFirst: (change: Change) => (point: string) => boolean;
      /** Its kill point once every column stands, before its registry update. */
      afterAll: (change: Change) => (point: string) => boolean;
      /** What the settle answers of a save that added one of its two fields. */
      partly: "partial" | "left";
    }
    const adds = (name: string) => (statement: string) =>
      new RegExp(
        `^\\s*ALTER\\s+TABLE\\b.*\\bADD\\s+(COLUMN\\s+)?\`?${name}\``,
        "is"
      ).test(statement);

    /** The schema dialog, whose save of a field kept on the main table runs its own file. */
    const DIALOG: Road = {
      boot: () => boot(),
      save: async (t, change) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields: change.fields,
            confirmed: true,
            schemaVersion: await versionOf(t),
            ...(change.renamed === undefined
              ? {}
              : {
                  renameResolutions: [
                    {
                      tableName: table,
                      fromColumn: change.renamed.from,
                      toColumn: change.renamed.to,
                      choice: "rename",
                    },
                  ],
                }),
          }
        ),
      before: point => /_update\.sql: before statement 1$/.test(point),
      afterFirst: change => afterStatement(adds(change.name)),
      afterAll: change =>
        afterStatement(
          change.renamed === undefined
            ? adds(change.whole)
            : renames(change.renamed.from)
        ),
      partly: "partial",
    };

    /** A settings update, whose change is pushed, then its translations table brought in step. */
    const UPDATE: Road = {
      boot: () => boot({ translatable: true }),
      save: (_t, change) =>
        dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: slug },
          {
            fields: change.fields,
            ...(change.renamed === undefined
              ? {}
              : { renames: [{ ...change.renamed, choice: "rename" }] }),
          }
        ) as Promise<unknown>,
      before: point => point === "push: before",
      afterFirst: change => afterStatement(adds(change.name)),
      afterAll: () => point => point === "companion: before",
      partly: "left",
    };
    // An update pushes where values are kept per language.
    const ROADS = perLanguage
      ? ([
          ["the schema dialog's save", DIALOG],
          ["a settings update", UPDATE],
        ] as const)
      : ([["the schema dialog's save", DIALOG]] as const);

    /** What a change of the road sends: a settings update keeps `heading` translated, as it found it. */
    const of = (road: Road, change: Change): Change =>
      road === UPDATE
        ? {
            ...change,
            fields: change.fields.map(each =>
              each === heading ? { name: "heading", type: "text" } : each
            ),
          }
        : change;

    /** The site, with a second entry beside the first, and both entries' ids. */
    async function setUp(
      road: Road
    ): Promise<{ t: TestNextly; ids: [string, string] }> {
      const t = await road.boot();
      await t.nextly.create({
        collection: slug,
        data: { title: "Second", slug: "second", note: "m" },
      } as never);
      const found = (await t.adapter.executeQuery(
        `SELECT id, slug FROM ${table} ORDER BY slug`
      )) as unknown as Array<{ id: unknown; slug: unknown }>;
      const id = (of: string) => String(found.find(row => row.slug === of)?.id);
      return { t, ids: [id("first"), id("second")] };
    }

    /** New entries made with `name` from another process, over each road. */
    const creates = (name: string): Array<Omit<Outcome, "ok">> => [
      {
        kind: "write",
        via: "rest",
        data: { title: "R", slug: "made-over-rest", [name]: "made over REST" },
      },
      {
        kind: "write",
        via: "api",
        data: {
          title: "A",
          slug: "made-over-api",
          [name]: "made through the API",
        },
      },
    ];
    /** What those wrote, by entry. */
    const WRITTEN = {
      "made-over-rest": "made over REST",
      "made-over-api": "made through the API",
    };
    /** Updates of the entries there already that name `name`, over each road. */
    const updates = (
      name: string,
      [first, second]: [string, string]
    ): Array<Omit<Outcome, "ok">> => [
      {
        kind: "update",
        via: "rest",
        id: first,
        data: { [name]: "set over REST", _overwrite: true },
      },
      {
        kind: "update",
        via: "api",
        id: second,
        data: { [name]: "set through the API", _overwrite: true },
      },
    ];

    /** What the column `name` holds of the entries written, by entry. */
    async function stored(
      t: TestNextly,
      name: string
    ): Promise<Record<string, unknown>> {
      const found = (await t.adapter.executeQuery(
        `SELECT slug, ${name} AS value FROM ${table}`
      )) as unknown as Array<{ slug: string; value: unknown }>;
      return Object.fromEntries(found.map(row => [row.slug, row.value]));
    }

    /** What the entries read as under `name` from another process, over each road, by entry. */
    async function read(name: string): Promise<Array<Record<string, unknown>>> {
      const answers = await fromAnotherProcess([
        { kind: "read", via: "rest" },
        { kind: "read", via: "api" },
      ]);
      return answers.map(answer => {
        expect(answer.ok, JSON.stringify(answer)).toBe(true);
        return Object.fromEntries(
          (answer.items ?? []).map(item => [String(item.slug), item[name]])
        );
      });
    }

    /** Each update naming `name` is refused as a name the entry's fields do not hold. */
    async function expectUpdatesRefused(
      name: string,
      ids: [string, string]
    ): Promise<void> {
      for (const refused of await fromAnotherProcess(updates(name, ids))) {
        expect
          .soft(refused, JSON.stringify(refused))
          .toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
      }
    }

    /** Write under `name` while the save stands: each new entry goes on, and no update. */
    async function writeUnder(
      name: string,
      ids: [string, string]
    ): Promise<void> {
      await expectUpdatesRefused(name, ids);
      for (const through of await fromAnotherProcess(creates(name))) {
        expect.soft(through.ok, JSON.stringify(through)).toBe(true);
      }
    }

    /** What `name` holds once those wrote: what they made, and what the entries there had. */
    const held = (change: Change) => ({
      ...WRITTEN,
      ...(change.renamed === undefined
        ? { first: null, second: null }
        : { first: "n", second: "m" }),
    });

    const outcomes = async (t: TestNextly) =>
      (await settle(t)).map(each => each.outcome);

    const each = ROADS.flatMap(([name, road]) =>
      (
        [
          ["adds", ADDS],
          ["renames", RENAMES],
        ] as const
      ).map(([does, change]) => ({ name, does, road, change }))
    );

    it.runIf(dialect === "mysql").each(each)(
      "$name that $does a field and the settle finishes: what was written under the new name is there",
      async ({ road, change }) => {
        const { t, ids } = await setUp(road);
        // The control: refused with no save standing too.
        await expectUpdatesRefused(change.name, ids);
        await killSave(t, road.afterAll(change), () =>
          road.save(t, of(road, change))
        );
        const columns = await liveColumns(t);
        expect(columns, `killed at ${killedAt}`).toContain(change.whole);
        await writeUnder(change.name, ids);

        expect(await outcomes(t)).toEqual(["all"]);
        expect(await stored(t, change.name)).toEqual(held(change));
        for (const items of await read(change.name)) {
          expect(items).toEqual(held(change));
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql").each(ROADS)(
      "%s that adds two fields, stopped between them: what was written under the one that applied is there after the settle, and after the save is made again",
      async (_name, road) => {
        const { t, ids } = await setUp(road);
        await killSave(t, road.afterFirst(ADDS), () =>
          road.save(t, of(road, ADDS))
        );
        const columns = await liveColumns(t);
        expect(columns, `killed at ${killedAt}`).toContain("alpha");
        expect(columns, `killed at ${killedAt}`).not.toContain("beta");
        await writeUnder("alpha", ids);

        expect(await outcomes(t)).toEqual([road.partly]);
        expect(await stored(t, "alpha")).toEqual(held(ADDS));
        // Left, the save stands, its registry row as it was, until it is made again.
        await road.save(t, of(road, ADDS));
        expect(await liveColumns(t)).toContain("beta");
        expect(await stored(t, "alpha")).toEqual(held(ADDS));
        for (const items of await read("alpha")) {
          expect(items).toEqual(held(ADDS));
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql").each(each)(
      "$name that $does a field and the settle undoes: no write under the new name was accepted, and none of them is there",
      async ({ road, change }) => {
        const { t, ids } = await setUp(road);
        await killSave(t, road.before, () => road.save(t, of(road, change)));
        expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
          change.name
        );
        const before = await rows(t);
        // The name is no column's yet, and no field's: answered as a name no save gives is.
        await expectUpdatesRefused(change.name, ids);
        for (const refused of await fromAnotherProcess(creates(change.name))) {
          expect.soft(refused.ok, JSON.stringify(refused)).toBe(false);
        }
        expect(await rows(t), "nothing written").toEqual(before);

        expect(await outcomes(t)).toEqual(["none"]);
        expect(await liveColumns(t)).not.toContain(change.name);
        expect(await rows(t), "nothing lost").toEqual(before);
      },
      600_000
    );

    // Undone by a person rather than the settle: the fields as they were, saved over what was left.
    it.runIf(dialect === "mysql" && perLanguage)(
      "a settings update left between its two fields, then saved as it was before it: what was written under the one that applied is not dropped unasked",
      async () => {
        const { t, ids } = await setUp(UPDATE);
        await killSave(t, UPDATE.afterFirst(ADDS), () =>
          UPDATE.save(t, of(UPDATE, ADDS))
        );
        await writeUnder("alpha", ids);
        expect(await outcomes(t)).toEqual(["left"]);

        // Refused, or made with the column kept: either way nothing is dropped no one confirmed.
        await UPDATE.save(t, {
          fields: [{ name: "heading", type: "text" }, field("note")],
        }).catch((error: unknown) => error);
        expect(await liveColumns(t)).toContain("alpha");
        expect(await stored(t, "alpha")).toEqual(held(ADDS));
      },
      600_000
    );
  }
);
