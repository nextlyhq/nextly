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
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
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
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import { takeAbortedTransactionSightings } from "../../../plugins/aborted-transaction-sightings";
import { underSavepoint } from "../../versions/version-capture-service";
import { refusingMovedStorage } from "../migration/moved-storage";

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
  singles: [
    defineSingle({
      slug: "fgnm_home",
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
      await nextly.updateSingle({
        slug: "fgnm_home" as never,
        data: { title: "H", card: { heading: "Kept" } } as never,
      });
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
      const saveSingle = (value = "New") =>
        outcome(
          nextly.updateSingle({
            slug: "fgnm_home" as never,
            data: { card: { heading: value }, _overwrite: true } as never,
          })
        );
      const singleHeading = async () => {
        const found = await nextly.findSingle({ slug: "fgnm_home" as never });
        return (found as { card?: { heading?: unknown } }).card?.heading;
      };
      return { save, read, heading, remove, saveSingle, singleHeading };
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
      expect(await rowsIn(CURRENT)).toBe(2);
    });

    it("refuses a first save of a group that keeps its table name, whose column moved, and saves it on the retry", async () => {
      // As a group whose stored table name the migration did not give: only its column moves.
      const { save, heading } = await openSite();
      await renameColumn(TABLE, "_component_type", "_field_group_type");
      await rename("dynamic_components", "dynamic_field_groups");

      await tried(() => save("First"), [MOVING]);
      expect(await heading()).toBe("First");
      expect(await rowsIn(TABLE)).toBe(2);
    });

    it("refuses a first save of a Single's group the whole migration moved, and saves it on the retry", async () => {
      // A Single reads the groups it holds on its transaction before it writes them.
      const { saveSingle, singleHeading } = await openSite();
      await moveEverything();

      await tried(() => saveSingle("First"), [MOVING]);
      expect(await singleHeading()).toBe("First");
    });

    it("refuses a delete meeting a moved table, rather than leaving the group's rows behind", async () => {
      const { remove } = await openSite();
      await moveEverything();

      await tried(remove, [MOVING]);
      expect(await rowsIn(CURRENT), "the Single's row alone").toBe(1);
    });

    it("loses nothing to a rollback under a server on the current names, and saves on a retry", async () => {
      const { save, heading } = await openSite({ migrated: true });
      await rename("dynamic_field_groups", "dynamic_components");
      await pointRegistryAt("dynamic_components", TABLE);
      await rename(CURRENT, TABLE);
      await renameColumn(TABLE, "_field_group_type", "_component_type");

      await tried(async () => {
        const answer = await save("Back");
        expect(await rowsIn(TABLE), "what the group held is there").toBe(2);
        return answer;
      }, [MOVING, "INTERNAL_ERROR"]);
      expect(await heading()).toBe("Back");
      expect(await rowsIn(TABLE)).toBe(2);
    });

    describe.runIf(dialect === "postgresql")(
      "a transaction whose later step meets a move",
      () => {
        /**
         * A site on the legacy names with a table for what a transaction writes, and the group's
         * table moved. `step` writes a row; `meetMove` is a step that meets the moved table.
         */
        const openMoved = async () => {
          await openSite();
          await run(`CREATE TABLE fgnm_marks (id integer PRIMARY KEY)`);
          const adapter = site!.adapter;
          const guarded = <T>(
            tx: TransactionContext,
            work: () => Promise<T>
          ): Promise<T> =>
            refusingMovedStorage({
              adapter,
              rows: { getAllComponents: async () => [] },
              executor: tx.getDrizzle(),
              work,
            });
          const step = (tx: TransactionContext, id: number) =>
            guarded(tx, () =>
              tx.execute(`INSERT INTO fgnm_marks (id) VALUES (${id})`)
            );
          const meetMove = (tx: TransactionContext) =>
            guarded(tx, () => tx.execute(`SELECT * FROM ${quoted(TABLE)}`));
          const marks = async () =>
            (
              (await run(`SELECT id FROM fgnm_marks ORDER BY id`)) as {
                id: number;
              }[]
            ).map(row => row.id);
          return { adapter, step, meetMove, marks };
        };

        it("is refused, and keeps none of what its earlier steps wrote", async () => {
          const { adapter, step, meetMove, marks } = await openMoved();
          await rename(TABLE, CURRENT);

          expect(
            await outcome(
              adapter.transaction(async tx => {
                await step(tx, 1);
                await meetMove(tx);
              })
            )
          ).toBe(MOVING);
          expect(await marks()).toEqual([]);
        });

        it("cannot be reported as done by a caller that goes on past the refusal", async () => {
          const { adapter, step, meetMove, marks } = await openMoved();
          await rename(TABLE, CURRENT);

          const done = await outcome(
            adapter.transaction(async tx => {
              await step(tx, 1);
              await meetMove(tx).catch(() => undefined);
              await tx.execute(`INSERT INTO fgnm_marks (id) VALUES (2)`);
            })
          );
          expect(done).not.toBe("ok");
          expect(await marks()).toEqual([]);
          // Gone on past on purpose: the statement after it met the aborted transaction.
          expect(takeAbortedTransactionSightings().length).toBeGreaterThan(0);
        });

        it("cannot be reported as done by a caller that goes on and runs nothing more", async () => {
          const { adapter, step, meetMove, marks } = await openMoved();
          await rename(TABLE, CURRENT);

          const done = await outcome(
            adapter.transaction(async tx => {
              await step(tx, 1);
              await meetMove(tx).catch(() => undefined);
            })
          );
          // The commit itself fails: the transaction was rolled back, not committed.
          expect(done).not.toBe("ok");
          expect(await marks()).toEqual([]);
          takeAbortedTransactionSightings();
        });

        it("inside another part's savepoint, undoes that part alone when it is the first to take its own", async () => {
          const { adapter, step, meetMove, marks } = await openMoved();
          await rename(TABLE, CURRENT);

          let refused = "";
          await adapter.transaction(async tx => {
            await tx.execute(`INSERT INTO fgnm_marks (id) VALUES (1)`);
            refused = await outcome(
              underSavepoint(tx as never, () => meetMove(tx))
            );
            // The other part's savepoint undid it, as it undoes any failure of its own.
            await step(tx, 2);
          });
          expect(refused).toBe(MOVING);
          expect(await marks()).toEqual([1, 2]);
        });

        it("inside another part's savepoint taken after its own, is refused with the whole transaction undone", async () => {
          const { adapter, step, meetMove, marks } = await openMoved();
          await rename(TABLE, CURRENT);

          const seen: string[] = [];
          const done = await outcome(
            adapter.transaction(async tx => {
              await step(tx, 1);
              seen.push(
                await outcome(underSavepoint(tx as never, () => meetMove(tx)))
              );
              await step(tx, 2);
            })
          );
          expect(seen).toEqual([MOVING]);
          expect(done).not.toBe("ok");
          expect(await marks()).toEqual([]);
          takeAbortedTransactionSightings();
        });
      }
    );

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
