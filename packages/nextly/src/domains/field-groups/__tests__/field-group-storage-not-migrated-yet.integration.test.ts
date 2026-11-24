/**
 * A field group whose storage a project has not migrated yet fails as it always did, and only
 * storage the field-group migration moved is refused as moving.
 *
 * Both are the same database error, a table or a column that is missing. Refused as moving, a save
 * of a group that was never created would be told to retry, and refused again on every retry.
 * The site's database is put in each state directly, under a server that keeps running, and the
 * server then reads and saves through its ordinary entry points, so a save runs on its own
 * transaction, as a real one does.
 *
 * @module domains/field-groups/__tests__/field-group-storage-not-migrated-yet.integration.test
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { recordStatements } from "../../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";

import {
  openStorageGenerationSite,
  type StorageGenerationSite,
} from "./helpers/storage-generation-site";

const TABLE = "comp_fgnm_card";
const CURRENT = "fg_fgnm_card";
const MOVING = "FIELD_GROUP_STORAGE_MOVING";

const declared = {
  collections: [
    defineCollection({
      slug: "fgnm_posts",
      versions: true,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fgnm_card" }),
      ],
    }),
  ],
  fieldGroups: [
    defineFieldGroup({
      slug: "fgnm_card",
      fields: [text({ name: "heading" })],
    }),
  ],
};

let site: StorageGenerationSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
  vi.unstubAllEnvs();
});

/** An error's code, as a caller acts on it, or `ok`. */
async function outcome(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "ok";
  } catch (error) {
    const e = error as {
      code?: unknown;
      publicData?: { errors?: { code?: unknown }[] };
    };
    return String(e.publicData?.errors?.[0]?.code ?? e.code);
  }
}

describe.each(getConfiguredTestDialects())(
  "field-group storage that is missing (%s)",
  dialect => {
    const quoted = (name: string): string =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    const run = (statement: string) => site!.adapter.executeQuery(statement);
    const rename = (from: string, to: string) =>
      run(`ALTER TABLE ${quoted(from)} RENAME TO ${quoted(to)}`);
    const renameColumn = (table: string, from: string, to: string) =>
      run(
        `ALTER TABLE ${quoted(table)} RENAME COLUMN ${quoted(from)} TO ${quoted(to)}`
      );
    const pointRegistryAt = (registry: string, table: string) =>
      run(
        `UPDATE ${quoted(registry)} SET ${quoted("table_name")} = '${table}' WHERE ${quoted("slug")} = 'fgnm_card'`
      );
    const rowsIn = async (table: string) =>
      (
        (await run(`SELECT COUNT(*) AS n FROM ${quoted(table)}`)) as {
          n: unknown;
        }[]
      ).map(row => Number(row.n))[0];

    /** A running site with one entry holding the group, and what a caller asks of it. */
    const openSite = async (options: { migrated?: boolean } = {}) => {
      site = await openStorageGenerationSite({ dialect, loaded, legacy: true });
      let { nextly } = await site.developmentStart(declared);
      const created = await nextly.create({
        collection: "fgnm_posts" as never,
        data: { title: "P", card: { heading: "Kept" } } as never,
      });
      const id = (created.item as { id: string }).id;
      if (options.migrated === true) {
        expect((await site.migrateStorage()).ran).toBe(true);
        ({ nextly } = await site.developmentStart(declared));
      }
      const save = (heading = "New") =>
        outcome(
          nextly.update({
            collection: "fgnm_posts" as never,
            id,
            data: { card: { heading }, _overwrite: true } as never,
          })
        );
      const read = () =>
        outcome(nextly.findByID({ collection: "fgnm_posts" as never, id }));
      const heading = async () => {
        const found = await nextly.findByID({
          collection: "fgnm_posts" as never,
          id,
        });
        return (found as { card?: { heading?: unknown } }).card?.heading;
      };
      const remove = () =>
        outcome(nextly.delete({ collection: "fgnm_posts" as never, id }));
      return { save, read, heading, remove };
    };

    /** The whole migration's renames, under a server that keeps running. */
    const moveEverything = async () => {
      await renameColumn(TABLE, "_component_type", "_field_group_type");
      await rename(TABLE, CURRENT);
      await pointRegistryAt("dynamic_components", CURRENT);
      await rename("dynamic_components", "dynamic_field_groups");
    };

    /** The answers of `work`, tried until it is done, at most three times. */
    const tried = async (
      work: () => Promise<string>,
      refused: readonly string[]
    ) => {
      const answers: string[] = [];
      for (let tries = 0; tries < 3; tries++) {
        answers.push(await work());
        if (answers.at(-1) === "ok") break;
      }
      expect(answers.at(-1), answers.join(" / ")).toBe("ok");
      for (const answer of answers.slice(0, -1)) {
        expect(refused, answers.join(" / ")).toContain(answer);
      }
      return answers;
    };

    // What these two assert is what a release without this refusal answers on every dialect; on
    // PostgreSQL that release also went on past the failed read into its aborted transaction.
    it("keeps a save's own error, on every try, when the group's table is not there yet", async () => {
      const { save, read } = await openSite();
      await run(`DROP TABLE ${quoted(TABLE)}`);

      expect([await save(), await save()]).toEqual([
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
      ]);
      // Read as empty, as a group whose migration has not run.
      expect(await read()).toBe("ok");
    });

    it("keeps a save's own error, on every try, when a column of the project's is not there yet", async () => {
      const { save } = await openSite();
      await run(
        `ALTER TABLE ${quoted(TABLE)} DROP COLUMN ${quoted("heading")}`
      );

      expect([await save(), await save()]).toEqual([
        "INTERNAL_ERROR",
        "INTERNAL_ERROR",
      ]);
    });

    it("refuses a save to be retried when the migration moved the group's table", async () => {
      const { save } = await openSite();
      await rename(TABLE, CURRENT);

      expect(await save()).toBe(MOVING);
    });

    it("refuses a first save of a group the whole migration moved, and saves it on the retry", async () => {
      const { save, heading } = await openSite();
      await moveEverything();

      await tried(() => save("First"), [MOVING]);
      expect(await heading()).toBe("First");
      expect(await rowsIn(CURRENT)).toBe(1);
    });

    it("refuses a first save of a group that keeps its table name, whose column moved, and saves it on the retry", async () => {
      // As a group whose stored table name the migration did not give: only its column moves.
      const { save, heading } = await openSite();
      await renameColumn(TABLE, "_component_type", "_field_group_type");
      await rename("dynamic_components", "dynamic_field_groups");

      await tried(() => save("First"), [MOVING]);
      expect(await heading()).toBe("First");
      expect(await rowsIn(TABLE)).toBe(1);
    });

    it("refuses a delete meeting a moved table, rather than leaving the group's rows behind", async () => {
      const { remove } = await openSite();
      await moveEverything();

      await tried(remove, [MOVING]);
      expect(await rowsIn(CURRENT)).toBe(0);
    });

    it("loses nothing to a rollback under a server on the current names, and saves on a retry", async () => {
      const { save, heading } = await openSite({ migrated: true });
      await rename("dynamic_field_groups", "dynamic_components");
      await pointRegistryAt("dynamic_components", TABLE);
      await rename(CURRENT, TABLE);
      await renameColumn(TABLE, "_field_group_type", "_component_type");

      await tried(async () => {
        const answer = await save("Back");
        expect(await rowsIn(TABLE), "what the group held is there").toBe(1);
        return answer;
      }, [MOVING, "INTERNAL_ERROR"]);
      expect(await heading()).toBe("Back");
      expect(await rowsIn(TABLE)).toBe(1);
    });

    it.runIf(dialect === "postgresql")(
      "takes a savepoint for a save on the legacy names, and none on the current ones",
      async () => {
        const counted = async (save: () => Promise<string>) => {
          const recorder = await recordStatements(site!.adapter, dialect);
          try {
            expect(await save()).toBe("ok");
          } finally {
            recorder.uninstall();
          }
          return {
            savepoints: recorder.statements.filter(text =>
              /savepoint "?nextly_moved_storage/i.test(text)
            ),
            statements: recorder.statements.length,
          };
        };
        const legacy = await openSite();
        await legacy.save();
        const before = await counted(() => legacy.save("Counted"));
        await site!.close();
        const current = await openSite({ migrated: true });
        await current.save();
        const after = await counted(() => current.save("Counted"));

        console.log(
          `[statement counts] legacy ${before.statements} (${before.savepoints.length} for savepoints), current ${after.statements} (${after.savepoints.length})`
        );
        expect(before.savepoints.length).toBeGreaterThan(0);
        expect(after.savepoints).toEqual([]);
        expect(before.statements - after.statements).toBe(
          before.savepoints.length
        );
      }
    );
  }
);
