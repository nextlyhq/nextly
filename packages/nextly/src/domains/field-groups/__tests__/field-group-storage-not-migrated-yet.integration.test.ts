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

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { recordStatements } from "../../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import { getConfiguredTestDialects } from "../../../plugins/test-nextly";
import {
  PG_ABORTED_TRANSACTION,
  takeAbortedTransactionSightings,
} from "../../../plugins/aborted-transaction-sightings";
import { restoreVersion } from "../../versions/restore-version";
import { underSavepoint } from "../../versions/version-capture-service";
import { refusingMovedStorage } from "../migration/moved-storage";
import { forgetFieldGroupStorageNames } from "../storage/resolve-storage-names";

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
    // With drafts, which a restore puts the version back as.
    defineSingle({
      slug: "fgnm_page",
      status: true,
      versions: true,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "card", component: "fgnm_card" }),
      ],
    }),
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
    const openSite = async (
      options: { migrated?: boolean; poolMax?: number } = {}
    ) => {
      site = await openStorageGenerationSite({
        dialect,
        loaded,
        legacy: true,
        ...(options.poolMax === undefined ? {} : { poolMax: options.poolMax }),
      });
      let { nextly } = await site.developmentStart(declared);
      const created = await nextly.create({
        collection: "fgnm_posts" as never,
        data: { title: "P", card: { heading: "Kept" } } as never,
      });
      const id = (created.item as { id: string }).id;
      await nextly.updateSingle({
        slug: "fgnm_home" as never,
        data: {
          title: "H",
          card: { heading: "Kept" },
          _overwrite: true,
        } as never,
      });
      for (const heading of ["Kept", "Second"]) {
        await nextly.updateSingle({
          slug: "fgnm_page" as never,
          data: {
            title: "G",
            card: { heading },
            status: "published",
            _overwrite: true,
          } as never,
        });
      }
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
      /** Puts the Single's first version back, as a person in the admin does. */
      const restoreSingle = async () => {
        const found = (await nextly.findSingle({
          slug: "fgnm_page" as never,
        })) as { id?: string };
        // Read before the move, as the screen a person restores from has them.
        const user = {
          id: await superAdminUser(site!.current!, "fgnm-admin"),
          roles: ["super-admin"],
        };
        return () =>
          outcome(
            restoreVersion({
              scopeKind: "single",
              slug: "fgnm_page",
              entryId: found.id!,
              versionNo: 1,
              user: user as never,
              version: { _overwrite: true },
            })
          );
      };
      const draftHeading = async () => {
        const found = await nextly.findSingle({
          slug: "fgnm_page" as never,
          draft: true,
        });
        return (found as { card?: { heading?: unknown } }).card?.heading;
      };
      const bulkRemove = async () => {
        const made = await nextly.create({
          collection: "fgnm_posts" as never,
          data: { title: "B", card: { heading: "B" } } as never,
        });
        const also = (made.item as { id: string }).id;
        return () =>
          outcome(
            nextly.bulkDelete({
              collection: "fgnm_posts" as never,
              ids: [also],
            })
          );
      };
      const removeAnother = async () => {
        const made = await nextly.create({
          collection: "fgnm_posts" as never,
          data: { title: "D", card: { heading: "D" } } as never,
        });
        const also = (made.item as { id: string }).id;
        return () =>
          outcome(
            nextly.delete({ collection: "fgnm_posts" as never, id: also })
          );
      };
      /** How many entries a list filtered on the group's field finds. */
      const filtered = async () => {
        const found = await nextly.find({
          collection: "fgnm_posts" as never,
          where: { "card.heading": { equals: "Kept" } } as never,
        });
        return found.items.length;
      };
      return {
        filtered,
        save,
        read,
        heading,
        remove,
        saveSingle,
        singleHeading,
        restoreSingle,
        draftHeading,
        bulkRemove,
        removeAnother,
      };
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
      expect(await rowsIn(CURRENT)).toBe(3);
    });

    it.runIf(dialect === "postgresql")(
      "takes no savepoint once it has followed the move, as a process started on the current names",
      async () => {
        const { save } = await openSite();
        expect(await save("Before")).toBe("ok");
        await moveEverything();
        await tried(() => save("First"), [MOVING]);

        const recorder = await recordStatements(site!.adapter, dialect);
        try {
          expect(await save("Settled")).toBe("ok");
        } finally {
          recorder.uninstall();
        }
        expect(
          recorder.statements.filter(text =>
            /savepoint "?nextly_moved_storage/i.test(text)
          )
        ).toEqual([]);
      }
    );

    it.runIf(dialect === "postgresql")(
      "refuses at most once, then gives the database's own error, when a settled server's table is gone for another reason",
      async () => {
        // Settled by following the move, so it takes no savepoint and cannot ask what failed.
        const { save } = await openSite();
        expect(await save("Before")).toBe("ok");
        await moveEverything();
        await tried(() => save("First"), [MOVING]);

        // Gone, and not by the migration: there is no other name to follow.
        await run(`DROP TABLE ${quoted(CURRENT)} CASCADE`);
        const answers: string[] = [];
        for (let n = 0; n < 3; n++) answers.push(await save(`Gone ${n}`));
        expect(answers.slice(1), answers.join(" / ")).not.toContain(MOVING);
        expect(
          answers.filter(answer => answer === MOVING).length,
          answers.join(" / ")
        ).toBeLessThanOrEqual(1);
      }
    );

    it("refuses a first save of a group that keeps its table name, whose column moved, and saves it on the retry", async () => {
      // As a group whose stored table name the migration did not give: only its column moves.
      const { save, heading } = await openSite();
      await renameColumn(TABLE, "_component_type", "_field_group_type");
      await rename("dynamic_components", "dynamic_field_groups");

      await tried(() => save("First"), [MOVING]);
      expect(await heading()).toBe("First");
      expect(await rowsIn(TABLE)).toBe(3);
    });

    it("refuses a first save of a Single's group the whole migration moved, and saves it on the retry", async () => {
      // A Single reads the groups it holds on its transaction before it writes them.
      const { saveSingle, singleHeading } = await openSite();
      await moveEverything();

      await tried(() => saveSingle("First"), [MOVING]);
      expect(await singleHeading()).toBe("First");
    });

    // A transaction holds the pool's one connection, so anything asked on another waits for it
    // until the wait gives up: the refusal, what follows it and the retry must ask nothing there.
    it.runIf(dialect !== "sqlite")(
      "refuses a first save to be retried, and saves it, on a pool of one connection",
      async () => {
        const { save, saveSingle, heading, singleHeading } = await openSite({
          poolMax: 1,
        });
        // The control: a pool of one serves these saves with nothing moved.
        expect([await save(), await saveSingle()]).toEqual(["ok", "ok"]);
        await moveEverything();

        await tried(() => saveSingle("First"), [MOVING]);
        await tried(() => save("First"), [MOVING]);
        expect([await singleHeading(), await heading()]).toEqual([
          "First",
          "First",
        ]);
      },
      120_000
    );

    // Another save is in flight, holding the pool's one connection, when this process forgets the
    // name and resolves it again: the save must not wait for that, whichever side the name is on.
    it.runIf(dialect !== "sqlite").each(["settled", "moved"])(
      "a save in flight while the registry's name is resolved again goes on, on a pool of one connection (%s)",
      async state => {
        const { save, heading } = await openSite({ poolMax: 1 });
        expect(await save("Before")).toBe("ok");
        if (state === "moved") await moveEverything();

        const adapter = site!.adapter;
        let forgotten = false;
        const transaction = adapter.transaction.bind(adapter);
        // The first transaction alone: forgotten as its work begins, its connection held.
        const spied = vi.spyOn(adapter, "transaction").mockImplementation(((
          work: never,
          ...rest: never[]
        ) =>
          transaction(
            (async (tx: never) => {
              if (!forgotten) {
                forgotten = true;
                forgetFieldGroupStorageNames(adapter);
              }
              return (work as (tx: never) => unknown)(tx);
            }) as never,
            ...rest
          )) as never);
        try {
          const began = Date.now();
          await tried(() => save("In flight"), [MOVING]);
          expect(forgotten).toBe(true);
          // The pool gives up after five seconds: a save that waited for it took that long.
          expect(Date.now() - began).toBeLessThan(5000);
        } finally {
          spied.mockRestore();
        }
        expect(await heading()).toBe("In flight");
      },
      120_000
    );

    it("refuses a restore of a Single's version meeting a moved table, and restores it on the retry", async () => {
      const { restoreSingle, draftHeading } = await openSite();
      const restore = await restoreSingle();
      await moveEverything();

      await tried(restore, [MOVING]);
      expect(await draftHeading()).toBe("Kept");
    });

    it("refuses a delete meeting a moved table, rather than leaving the group's rows behind", async () => {
      const { remove } = await openSite();
      await moveEverything();

      await tried(remove, [MOVING]);
      expect(await rowsIn(CURRENT), "the two Singles' rows alone").toBe(2);
    });

    it("refuses a save a rollback meets under a server on the current names, loses nothing, and saves on the retry", async () => {
      const { save, heading } = await openSite({ migrated: true });
      await rename("dynamic_field_groups", "dynamic_components");
      await pointRegistryAt("dynamic_components", TABLE);
      await rename(CURRENT, TABLE);
      await renameColumn(TABLE, "_field_group_type", "_component_type");

      await tried(async () => {
        const answer = await save("Back");
        expect(await rowsIn(TABLE), "what the group held is there").toBe(3);
        return answer;
      }, [MOVING]);
      expect(await heading()).toBe("Back");
      expect(await rowsIn(TABLE)).toBe(3);
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
          expect(takeAbortedTransactionSightings()).toEqual([
            expect.stringContaining(PG_ABORTED_TRANSACTION),
          ]);
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
          // The harness asks the transaction as the callback returns and finds it aborted, and the
          // commit itself then fails: rolled back, not committed.
          expect(done).not.toBe("ok");
          expect(await marks()).toEqual([]);
          expect(takeAbortedTransactionSightings()).toEqual([
            expect.stringContaining(PG_ABORTED_TRANSACTION),
            expect.stringContaining("rolled back, not committed"),
          ]);
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
          // The step after it, run on purpose, met the aborted transaction.
          expect(takeAbortedTransactionSightings()).toEqual([
            expect.stringContaining(PG_ABORTED_TRANSACTION),
          ]);
        });
      }
    );

    it("reads the registry no more for a filter on the group on the legacy names than on the current ones: not at all, once warm", async () => {
      /** The registry reads of one filtered list, each time, once the server is warm. */
      const registryReads = async (migrated: boolean) => {
        const { filtered } = await openSite({ migrated });
        for (let n = 0; n < 3; n++) expect(await filtered()).toBe(1);
        const reads: number[] = [];
        for (let n = 0; n < 5; n++) {
          const recorder = await recordStatements(site!.adapter, dialect);
          try {
            expect(await filtered()).toBe(1);
          } finally {
            recorder.uninstall();
          }
          reads.push(
            recorder.statements.filter(
              text =>
                /^\s*select/i.test(text) &&
                /from\s+["`](dynamic_components|dynamic_field_groups)["`]/i.test(
                  text
                )
            ).length
          );
        }
        await site!.close();
        site = undefined;
        return reads;
      };
      const legacy = await registryReads(false);
      const current = await registryReads(true);
      console.log(
        `[statement counts] registry reads of a filtered list: legacy ${legacy.join(" ")}, current ${current.join(" ")}`
      );
      expect(Math.min(...legacy)).toBe(0);
      expect(Math.min(...current)).toBe(0);
    }, 120_000);

    it.runIf(dialect === "postgresql")(
      "takes a savepoint for a save on the legacy names, and none on the current ones",
      async () => {
        /** What this process reads every so often, whatever is being written. */
        const EVERY_SO_OFTEN = [
          // The site's languages, and the stored schema version.
          /^select count\(\*\), sum\("revision"\) from "nextly_languages"/,
          /^select "value" from "nextly_meta" where "nextly_meta"\."key"/,
          // Whether a table a feature keeps is there yet.
          /^SELECT EXISTS \( SELECT FROM information_schema\.tables/,
        ];
        /** The statements `write` sent. */
        const sent = async (write: () => Promise<string>) => {
          const recorder = await recordStatements(site!.adapter, dialect);
          try {
            expect(await write()).toBe("ok");
          } finally {
            recorder.uninstall();
          }
          return recorder.statements.map(text =>
            text
              .replace(/\s+/g, " ")
              // Each savepoint's name counts up; it is the same statement.
              .replace(/(nextly_[a-z_]+)_\d+"/g, '$1_n"')
              .trim()
              .slice(0, 160)
          );
        };
        const beyond = (longer: string[], shorter: string[]) => {
          const left = [...shorter];
          return longer.filter(text => {
            const at = left.indexOf(text);
            if (at >= 0) left.splice(at, 1);
            return at < 0;
          });
        };
        // Each write five times: a read this process makes every so often falls inside one or
        // another, and adds to it, so what a write itself sends is the fewest it was seen to send.
        // Whatever a longer one sent beyond that must be such a read.
        const fewest = async (
          kind: string,
          write: () => Promise<() => Promise<string>>
        ) => {
          const runs: string[][] = [];
          for (let n = 0; n < 5; n++) runs.push(await sent(await write()));
          const least = runs.reduce((a, b) => (b.length < a.length ? b : a));
          const extra = runs.flatMap(run => beyond(run, least));
          console.log(
            `[statement counts] ${kind}: ${runs.map(run => run.length).join(" ")}${extra.length === 0 ? "" : ` extra ${JSON.stringify(extra)}`}`
          );
          expect(
            extra.filter(text => !EVERY_SO_OFTEN.some(read => read.test(text))),
            kind
          ).toEqual([]);
          return { least };
        };
        // Each save writes a value of its own: an unchanged one keeps no version, and is another write.
        let saves = 0;
        const measured = async (migrated: boolean) => {
          const at = await openSite({ migrated });
          await at.save();
          await at.saveSingle();
          const on = migrated ? "current" : "legacy";
          const counts = {
            "collection save": await fewest(
              `collection save, ${on}`,
              async () => () => at.save(`Counted ${++saves}`)
            ),
            "Single save": await fewest(
              `Single save, ${on}`,
              async () => () => at.saveSingle(`Counted ${++saves}`)
            ),
            "bulk delete of one": await fewest(
              `bulk delete of one, ${on}`,
              at.bulkRemove
            ),
            delete: await fewest(`delete, ${on}`, at.removeAnother),
          };
          await site!.close();
          site = undefined;
          return counts;
        };
        const isSavepoint = (text: string) =>
          /savepoint "?nextly_moved_storage/i.test(text);
        const legacy = await measured(false);
        const current = await measured(true);
        for (const kind of Object.keys(legacy) as (keyof typeof legacy)[]) {
          const before = legacy[kind].least;
          const after = current[kind].least;
          expect(before.filter(isSavepoint), kind).toHaveLength(1);
          expect(after.filter(isSavepoint), kind).toEqual([]);
          expect(before.length - after.length, kind).toBe(1);
        }
      }
    );
  }
);
