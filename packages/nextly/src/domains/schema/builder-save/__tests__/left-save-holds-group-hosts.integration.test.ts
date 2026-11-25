/**
 * A field group's committed change, its registry update not run, while the Builder save that made it
 * the process left part-way stands unsettled (`helpers/left-save-fixture.ts`). The field group's values
 * live in a table its hosts share, which every write of a host reads for the document it records, the
 * fields it sets or not: so every write of a collection or Single that places the field group is
 * refused, naming it, with nothing applied; one of an entity that places none goes on; and after the
 * settle the writes are accepted.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import {
  killedAt,
  LEFT_SAVE_SUITES,
  leftSaveHooks,
  leftSaveSuite,
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
  "writes of a field group's hosts while a Builder save of it is left part-way ($dialect, $layout)",
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
      killSave,
      fromAnotherProcess,
      afterStatement,
      renames,
      expectRefused,
      settle,
    } = leftSaveSuite({ dialect, perLanguage });
    /** A field group that places `card`, the collection holding it in a repeater, and one holding none. */
    const deck = `${card}_deck`;
    const decks = `${slug}_decks`;
    const plain = `${slug}_plain`;
    const holds = (name: string, component: string) => ({
      name,
      type: "component",
      component,
    });

    /** The collection placing `card`, with its Draft/Published switch, and a Single placing it. */
    async function setUp(): Promise<{
      t: TestNextly;
      draft: string;
      published: string;
    }> {
      const t = await boot({ card: true, status: true });
      const made = (await t.nextly.create({
        collection: slug,
        data: {
          title: "Second",
          slug: "second",
          note: "m",
          status: "published",
          card: { label: "kept" },
        },
      } as never)) as { item: { id: unknown } };
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: hero,
          label: hero,
          fields: [field("note"), holds("card", card)],
        }
      );
      await t.nextly.updateSingle({
        slug: hero,
        data: { note: "n", card: { label: "kept" }, _overwrite: true },
      } as never);
      const [first] = (await t.adapter.executeQuery(
        `SELECT id FROM ${table} WHERE slug = 'first'`
      )) as unknown as Array<{ id: unknown }>;
      return { t, draft: String(first?.id), published: String(made.item.id) };
    }

    /** Make the collection that holds `card` two levels down, and the one that holds no field group. */
    async function setUpOthers(t: TestNextly): Promise<void> {
      await dispatchComponents(
        "createComponent",
        {},
        {
          slug: deck,
          label: deck,
          fields: [field("name"), holds("card", card)],
        }
      );
      for (const [name, fields] of [
        [
          decks,
          [
            field("note"),
            { name: "rows", type: "repeater", fields: [holds("deck", deck)] },
          ],
        ],
        [plain, [field("note")]],
      ] as const) {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name, label: name, fields }
        );
      }
      for (const collection of [decks, plain]) {
        await t.nextly.create({
          collection,
          data: { title: "One", slug: "one", note: "n" },
        } as never);
      }
    }

    /** The save renaming `card`'s one field, killed where `at` says. */
    async function killGroupRename(
      t: TestNextly,
      at: (point: string) => boolean
    ): Promise<void> {
      const schemaVersion = await versionOf(t, "dynamic_components", card);
      await killSave(t, at, () =>
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
    }

    /** Each write, over both roads, none of them naming a field of the field group. */
    const bothRoads = (
      operations: Array<Omit<Outcome, "ok" | "via">>
    ): Array<Omit<Outcome, "ok">> =>
      operations.flatMap(operation =>
        (["rest", "api"] as const).map(via => ({
          ...operation,
          via,
          ...(operation.kind === "write"
            ? {
                data: {
                  ...operation.data,
                  slug: `${String(operation.data?.slug)}-${via}`,
                },
              }
            : {}),
        }))
      );
    const writes = (draft: string, published: string) =>
      bothRoads([
        {
          kind: "write",
          data: { title: "New", slug: "new", note: "only the note" },
        },
        {
          kind: "update",
          id: draft,
          data: { note: "only the note", _overwrite: true },
        },
        {
          kind: "update",
          id: draft,
          data: { status: "published", _overwrite: true },
        },
        {
          kind: "update",
          id: published,
          data: { status: "draft", _overwrite: true },
        },
        {
          kind: "single-write",
          slug: hero,
          data: { note: "only the note", _overwrite: true },
        },
        { kind: "delete", id: published },
      ]);

    it.runIf(dialect === "mysql")(
      "refuses a create, an update, a publish, a write of the status alone, a Single's write and a delete, none naming the field group, over REST and the Direct API, with nothing applied; and accepts them once settled",
      async () => {
        const { t, draft, published } = await setUp();
        await killGroupRename(t, afterStatement(renames("label")));
        expect(
          await liveColumns(t, `comp_${card}`),
          `killed at ${killedAt}`
        ).toContain("caption");
        const stored = async () => ({
          entries: await t.adapter.executeQuery(
            `SELECT * FROM ${table} ORDER BY slug`
          ),
          single: await t.adapter.executeQuery(`SELECT * FROM single_${hero}`),
          group: await t.adapter.executeQuery(
            `SELECT * FROM comp_${card} ORDER BY id`
          ),
          draft: await rowsNaming(t, draft),
          published: await rowsNaming(t, published),
        });
        const before = await stored();

        for (const refused of await fromAnotherProcess(
          writes(draft, published)
        )) {
          expectRefused(refused, "card");
          expect(refused.message, JSON.stringify(refused)).toContain(
            `field group "${card}"`
          );
        }
        expect(await stored(), "nothing applied").toEqual(before);

        await settle(t);
        for (const accepted of await fromAnotherProcess(
          writes(draft, published)
        )) {
          // The second road's delete finds what the first deleted.
          if (accepted.kind === "delete" && accepted.via === "api") continue;
          expect.soft(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    it.runIf(dialect === "mysql")(
      "refuses a write of a collection that holds the field group inside another field group, in a repeater, naming it; and lets one of a collection that holds no field group through",
      async () => {
        const { t } = await setUp();
        await setUpOthers(t);
        await killGroupRename(t, afterStatement(renames("label")));
        const created = {
          kind: "write",
          data: { title: "New", slug: "new", note: "only the note" },
        } as const;

        for (const refused of await fromAnotherProcess(
          bothRoads([{ ...created, slug: decks }])
        )) {
          expectRefused(refused, "rows.deck");
          expect(refused.message, JSON.stringify(refused)).toContain(
            `field group "${card}"`
          );
        }
        for (const through of await fromAnotherProcess(
          bothRoads([
            { ...created, slug: plain },
            { kind: "read", slug: plain },
          ])
        )) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }

        await settle(t);
        for (const accepted of await fromAnotherProcess(
          bothRoads([{ ...created, slug: decks }])
        )) {
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );

    // A kill finds none or all of the change there, so no write meets a table its definition does not
    // describe: killed before the file ran, every write of a host is as it ever was.
    it.runIf(dialect !== "mysql")(
      "refuses no write of a host where the field group's save was killed before its file ran",
      async () => {
        const { t, draft, published } = await setUp();
        await killGroupRename(t, point => point.startsWith("unit:"));
        for (const accepted of await fromAnotherProcess(
          writes(draft, published)
        )) {
          if (accepted.kind === "delete" && accepted.via === "api") continue;
          expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
        }
      },
      600_000
    );
  }
);
