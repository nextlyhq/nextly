/**
 * A Builder save left part-way on a table that holds an element another owner built there: a plugin's
 * index, recorded as the plugin's in `nextly_schema_owners`. The app's history never describes such an
 * element, so the settle leaves it out of the tables it compares, as the save's own comparisons do: the
 * save is settled at the next development start, or by the next save of the entity, and the element
 * stays. One the history does describe is compared, so a record naming it changes nothing. A record that
 * cannot be read leaves the save as it is, and the start goes on.
 *
 * Killed before its file ran, the save applied nothing, on every database.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import type { TestNextly } from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { SchemaOwnersRepository } from "../../ownership/schema-owners-repository";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  killedAt,
  LEFT_SAVE_SUITES,
  leftSaveHooks,
  leftSaveSuite,
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

/** The plugin that built the element. */
const PLUGIN = "@t/settle-elements";

describe.each(LEFT_SAVE_SUITES)(
  "a left Builder save on a table holding another owner's element ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    const {
      slug,
      table,
      field,
      boot,
      versionOf,
      killSave,
      settle,
      renameHeading,
    } = leftSaveSuite({ dialect, perLanguage });
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    /** The rename of `heading`, the other fields as `kept`, killed before its file ran. */
    async function killRenameBeforeFile(
      t: TestNextly,
      kept: Field[] = [field("note")]
    ): Promise<void> {
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
              fields: [field("headline"), ...kept],
              confirmed: true,
              schemaVersion,
              ...renameHeading(table),
            }
          )
      );
      expect(await recordStands(t), `killed at ${killedAt}`).toBe(true);
    }

    /** The plugin's index on `note`, built by hand, and its owner row, unless `name` is the app's own. */
    async function pluginIndex(
      t: TestNextly,
      name = "lsoe_plugin_note"
    ): Promise<string> {
      if (name === "lsoe_plugin_note") {
        await t.adapter.executeQuery(
          `CREATE INDEX ${q(name)} ON ${q(table)} (${q("note")}${dialect === "mysql" ? "(20)" : ""})`
        );
      }
      await new SchemaOwnersRepository(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect
      ).upsert([
        {
          tableName: table,
          elementKind: "index",
          elementName: name,
          ownerKind: "plugin",
          ownerId: PLUGIN,
          migratedBy: `plugin:${PLUGIN}`,
          ownerVersion: "1.0.0",
          schemaVersion: 1,
          state: "active",
        },
      ]);
      return name;
    }

    /** The table's indexes, as the database has them. */
    async function indexes(t: TestNextly): Promise<string[]> {
      const live = await introspectLiveSnapshot(
        (t.adapter as unknown as DrizzleAdapter).getDrizzle(),
        dialect,
        [table]
      );
      return (live.tables[0]?.indexes ?? []).map(index =>
        index.name.toLowerCase()
      );
    }

    async function recordStands(t: TestNextly): Promise<boolean> {
      const records = (await t.adapter.executeQuery(
        `SELECT ${q("key")} FROM nextly_meta WHERE ${q("key")} LIKE 'builder-save-in-progress:%'`
      )) as unknown as unknown[];
      return records.length > 0;
    }

    it("settles at the next start a save killed before its file ran, the plugin's index left as it is", async () => {
      const t = await boot();
      const index = await pluginIndex(t);
      await killRenameBeforeFile(t);

      expect((await settle(t)).map(each => each.outcome)).toEqual(["none"]);
      expect(await recordStands(t)).toBe(false);
      expect(await indexes(t)).toContain(index);
    }, 300_000);

    it("settles it at the next save of the collection, which then applies, the plugin's index left as it is", async () => {
      const t = await boot();
      const index = await pluginIndex(t);
      await killRenameBeforeFile(t);

      const saved = await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: slug },
        {
          fields: [field("headline"), field("note")],
          confirmed: true,
          schemaVersion: await versionOf(t),
          ...renameHeading(table),
        }
      ).then(
        answer => (answer instanceof Response ? answer.status : 200),
        (error: unknown) =>
          String((error as { publicMessage?: string }).publicMessage ?? error)
      );
      expect(saved).toBe(200);
      expect(await recordStands(t)).toBe(false);
      expect(await indexes(t)).toContain(index);
    }, 300_000);

    // The control: an index the history describes is compared, whoever a record names as its owner.
    // On a number field: on MySQL an index on a text field is refused at the next save of the
    // collection, which reads Nextly's own prefix index as another under its name.
    it("settles a save over an index the history describes, and the index stays, though a record names it a plugin's", async () => {
      const t = await boot();
      const indexed: Field = { name: "rank", type: "number", index: true };
      await dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: slug },
        {
          fields: [field("heading"), field("note"), indexed],
          confirmed: true,
          schemaVersion: await versionOf(t),
        }
      );
      const before = await indexes(t);
      const described = before.find(name => name.includes("rank"));
      expect(described, JSON.stringify(before)).toBeDefined();
      // Named the plugin's once the save stands left: before, the save's own comparison leaves it out.
      await killRenameBeforeFile(t, [field("note"), indexed]);
      await pluginIndex(t, described!);

      expect((await settle(t)).map(each => each.outcome)).toEqual(["none"]);
      expect(await indexes(t)).toEqual(before);
    }, 300_000);

    it("leaves the save as it is where the record of other owners' elements cannot be read, and the start goes on", async () => {
      const t = await boot();
      await killRenameBeforeFile(t);
      vi.spyOn(SchemaOwnersRepository.prototype, "read").mockRejectedValue(
        new Error("the owner record is unreadable")
      );

      expect((await settle(t)).map(each => each.outcome)).toEqual(["left"]);
      expect(await recordStands(t)).toBe(true);
    }, 300_000);
  }
);
