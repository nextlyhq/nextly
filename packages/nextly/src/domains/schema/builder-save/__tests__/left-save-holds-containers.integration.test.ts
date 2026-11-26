/**
 * A group that keeps its text per language, while a Builder save the process left part-way stands
 * unsettled (`helpers/left-save-fixture.ts`). The group's structure is a column of the main table and
 * each language's text one of the translations table, made by a file of its own: between the two the
 * registry row names a group whose text has nowhere to go. A write that sets it is refused, naming it;
 * writes of other fields go on, and a read is answered, never with a database error.
 *
 * On per-language storage, as every installation keeps its values.
 */
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { clearRegistryRowCache } from "../../../dynamic-collections/services/collection-row-cache";
import { resolveVersionsConfig } from "../../../versions/resolve-config";
import type { LeftSave } from "../save-in-progress";
import { fieldsNotServedOf } from "../settle-left-save";
import {
  killedAt,
  LEFT_SAVE_SUITES,
  leftSaveHooks,
  leftSaveSuite,
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

describe.each(LEFT_SAVE_SUITES.filter(suite => suite.perLanguage))(
  "writes and reads while a Builder save that added a group holding text is left part-way ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      field,
      table,
      boot,
      liveColumns,
      versionOf,
      killSave,
      fromAnotherProcess,
      databaseError,
      expectRefused,
      hero,
      afterStatement,
      dropsColumn,
    } = leftSaveSuite({ dialect, perLanguage });

    const box: Field = { name: "box", type: "group", fields: [text("label")] };
    const fields = [text("heading"), field("note"), box];

    /** The save that adds the group. */
    const addsBox = async (t: TestNextly) =>
      dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: slug },
        { fields, confirmed: true, schemaVersion: await versionOf(t) }
      );

    /** What the hold's comparison finds of the collection's tables. */
    const found = (t: TestNextly) =>
      fieldsNotServedOf(t.adapter, { kind: "collection", slug } as LeftSave, {
        fields,
        status: false,
        localized: false,
      });

    it("the comparison finds a group whose translations column the tables do not hold, and nothing where they do", async () => {
      const t = await boot({ translatable: true });
      await addsBox(t);
      expect(
        (await liveColumns(t)).filter(name => name === "box"),
        "one column on each table"
      ).toHaveLength(2);
      expect(await found(t)).toEqual({
        unserved: [],
        required: [],
        shapeServed: true,
      });

      await t.adapter.executeQuery(
        `ALTER TABLE ${table}_locales DROP COLUMN box`
      );

      expect(await found(t)).toEqual({
        unserved: [{ field: "box", missing: true }],
        required: [],
        shapeServed: true,
      });
    }, 300_000);

    it.runIf(dialect === "mysql")(
      "refuses a write setting the group before its translations column is made, over REST and the Direct API, lets a write of another field through and answers reads",
      async () => {
        const t = await boot({ translatable: true });
        await killSave(
          t,
          point => point.startsWith("unit:") && point.includes("localization"),
          () => addsBox(t)
        );
        expect(
          (await liveColumns(t)).filter(name => name === "box"),
          `killed at ${killedAt}`
        ).toHaveLength(1);

        const [rest, api, restOther, apiOther, restRead, apiRead] =
          await fromAnotherProcess([
            {
              kind: "write",
              via: "rest",
              data: { title: "R1", slug: "r1", box: { label: "x" } },
            },
            {
              kind: "write",
              via: "api",
              data: { title: "A1", slug: "a1", box: { label: "x" } },
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

        // Each road is looked at whatever the others came to.
        for (const refused of [rest!, api!]) {
          expect
            .soft(databaseError(refused), JSON.stringify(refused))
            .toBe(false);
          expect
            .soft(refused.code, JSON.stringify(refused))
            .toBe("BUILDER_SAVE_FIELD_UNSETTLED");
        }
        for (const through of [restOther!, apiOther!, restRead!, apiRead!]) {
          expect.soft(through.ok, JSON.stringify(through)).toBe(true);
        }
        expectRefused(rest!, "box");
        expectRefused(api!, "box");
      },
      600_000
    );

    // Publishing every language writes a Single's held draft live, and reads first the structure each
    // container it puts down has now. Where a left save's drop of that container committed, the
    // column is gone: the publish is refused by name before that read, never with a database error.
    it.runIf(dialect === "mysql")(
      "refuses publishing every language of a Single whose held draft holds a group a committed drop removed, naming it, over REST and its service, with nothing written",
      async () => {
        const t = await boot({ translatable: true });
        const card: Field = {
          name: "box",
          type: "group",
          fields: [text("label"), { name: "size", type: "number" }],
        };
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: hero,
            label: hero,
            status: true,
            fields: [field("note"), card],
          }
        );
        // Kept as a Single demoted from code keeps its drafts: each live document's edits held.
        await t.adapter.executeQuery(
          `UPDATE dynamic_singles SET versions = '${JSON.stringify(resolveVersionsConfig({ drafts: true }))}' WHERE slug = '${hero}'`
        );
        clearRegistryRowCache();
        await t.nextly.updateSingle({
          slug: hero,
          data: {
            note: "n",
            box: { label: "live", size: 1 },
            status: "published",
            _overwrite: true,
          },
        } as never);
        await t.nextly.updateSingle({
          slug: hero,
          data: { box: { label: "held", size: 2 }, _overwrite: true },
        } as never);
        const schemaVersion = await versionOf(t, "dynamic_singles", hero);
        await killSave(t, afterStatement(dropsColumn("box")), () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: hero },
            {
              fields: [field("note")],
              confirmed: true,
              schemaVersion,
              resolutions: { box: { action: "confirm_drop" } },
              confirmedDeletions: [{ field: "box", count: 1 }],
            }
          )
        );
        // The structure's column is gone from the main table; its text's stays on the translations one.
        const [{ standing }] = (await t.adapter.executeQuery(
          `SELECT COUNT(*) AS standing FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'single_${hero}' AND column_name = 'box'`
        )) as unknown as [{ standing: unknown }];
        expect(Number(standing), `killed at ${killedAt}`).toBe(0);
        const stored = async () => ({
          main: await t.adapter.executeQuery(`SELECT * FROM single_${hero}`),
          languages: await t.adapter.executeQuery(
            `SELECT * FROM single_${hero}_locales ORDER BY _locale`
          ),
        });
        const before = await stored();

        for (const refused of await fromAnotherProcess([
          { kind: "single-publish-all", via: "rest", slug: hero },
          { kind: "single-publish-all", via: "api", slug: hero },
        ])) {
          expectRefused(refused, "box");
        }
        expect(await stored(), "nothing of either publish written").toEqual(
          before
        );
      },
      600_000
    );
  }
);
