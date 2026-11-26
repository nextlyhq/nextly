/**
 * What one request, one transaction and a delete meet while a Builder save the process left part-way
 * stands unsettled (`helpers/left-save-fixture.ts`).
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import type { ServiceContainer } from "../../../../services";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { refuseReadOverLeftSave } from "../left-save-fields";
import { describe, expect, it, vi } from "vitest";

import {
  leftSaveHooks,
  leftSaveSuite,
  LEFT_SAVE_SUITES,
  type Outcome,
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
      field,
      table,
      boot,
      liveColumns,
      versionOf,
      dropHeading,
      renameHeading,
      killRename,
      killSave,
      fromAnotherProcess,
      afterStatement,
      renames,
      dropsColumn,
    } = leftSaveSuite({ dialect, perLanguage });

    /**
     * A request in another process making one write, then `second`, with `between` run while it is
     * paused between the two: what each of its operations came to.
     */
    async function aroundASecondWrite(
      second: Record<string, unknown>,
      between: () => Promise<void>
    ): Promise<Outcome[]> {
      const reached = join(basePath, "request-paused");
      const until = join(basePath, "request-goes-on");
      const sent = fromAnotherProcess([
        {
          kind: "request",
          via: "api",
          within: [
            {
              kind: "write",
              via: "api",
              data: { title: "R1", slug: "r1", note: "before the save" },
            },
            { kind: "pause", via: "api", reached, until },
            { kind: "write", via: "api", data: second },
          ],
        },
      ]);
      await vi.waitFor(() => expect(existsSync(reached)).toBe(true), {
        timeout: 120_000,
        interval: 200,
      });
      await between();
      writeFileSync(until, "go on");
      return sent;
    }

    // A check inside a transaction it was not handed joins it: the refusal comes back as itself,
    // and the transaction it joined goes on, what it wrote kept.
    it.runIf(dialect === "mysql")(
      "refuses a read inside an open transaction with its own code, the transaction going on",
      async () => {
        const t = await boot();
        // A record that cannot be read holds every field, compared with nothing.
        await new MetaService(t.adapter, consoleLogger).set(
          `builder-save-in-progress:collection:${slug}`,
          { unreadable: true }
        );

        await t.adapter.transaction(async tx => {
          await expect(
            refuseReadOverLeftSave({
              adapter: t.adapter,
              kind: "collection",
              slug,
            })
          ).rejects.toMatchObject({ code: "BUILDER_SAVE_FIELD_UNSETTLED" });
          await tx.update(
            table,
            { note: "written after the refusal" },
            { and: [{ column: "slug", op: "=", value: "first" }] }
          );
        });

        const [row] = (await t.adapter.executeQuery(
          `SELECT note FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ note: unknown }>;
        expect(row?.note).toBe("written after the refusal");
      },
      600_000
    );

    // A read of the records that fails inside the join is thrown as it is. A nested transaction
    // joins flat on MySQL, so the failure ends the transaction it joined, whatever its caller does
    // with it: nothing of it is written.
    it.runIf(dialect === "mysql")(
      "ends a transaction the guard joined where its own read fails there, with that failure, nothing written",
      async () => {
        const t = await boot();
        // A column the read names is gone: a failure that is not a missing table's.
        const renameValue = (from: string, to: string) =>
          t.adapter.executeQuery(
            `ALTER TABLE nextly_meta RENAME COLUMN \`${from}\` TO \`${to}\``
          );
        await renameValue("value", "value_gone");
        try {
          await expect(
            t.adapter.transaction(async tx => {
              await tx.update(
                table,
                { note: "written before the failure" },
                { and: [{ column: "slug", op: "=", value: "first" }] }
              );
              // The caller carries on over it.
              await refuseReadOverLeftSave({
                adapter: t.adapter,
                kind: "collection",
                slug,
              }).catch(() => undefined);
            })
          ).rejects.toThrow(/value/);
        } finally {
          await renameValue("value_gone", "value");
        }
        const [row] = (await t.adapter.executeQuery(
          `SELECT note FROM ${table} WHERE slug = 'first'`
        )) as unknown as Array<{ note: unknown }>;
        expect(row?.note).toBe("n");
      },
      600_000
    );

    // A save running in another process, its record written and its lock held, is not one left
    // part-way: a request that began before it writes on, refused nothing.
    it.runIf(dialect === "mysql")(
      "lets a request's write through while a save that began within the request runs",
      async () => {
        const t = await boot();
        const schemaVersion = await versionOf(t);

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", note: "while it runs" },
          () =>
            // Paused before its first statement, so nothing of the tables has changed.
            killSave(
              t,
              point => point.startsWith("unit:"),
              () =>
                dispatchCollections(
                  {} as ServiceContainer,
                  "applySchemaChanges",
                  { collectionName: slug },
                  {
                    fields: [field("headline"), field("note")],
                    confirmed: true,
                    schemaVersion,
                    ...renameHeading(table),
                  }
                ),
              { live: true }
            )
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.ok, JSON.stringify(second)).toBe(true);
        expect(await liveColumns(t), `paused at ${killedAt}`).toContain(
          "heading"
        );
      },
      600_000
    );

    // The refusal is for every process: a save that starts while a request runs, and is killed
    // before the request's next write, holds that write too.
    it.runIf(dialect === "mysql")(
      "refuses a request's second write over a save another process began and left within the request",
      async () => {
        const t = await boot();

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", heading: "x" },
          async () => {
            await killRename(t, afterStatement(renames("heading")));
            expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
              "headline"
            );
          }
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.code, JSON.stringify(second)).toBe(
          "BUILDER_SAVE_FIELD_UNSETTLED"
        );
        // Only the field it changed is named.
        expect(second!.message, JSON.stringify(second)).toMatch(/"heading"/);
        expect(second!.message, JSON.stringify(second)).not.toMatch(/"note"/);
      },
      600_000
    );

    // Only the field the save changed is held: the request's write of another field goes on.
    it.runIf(dialect === "mysql")(
      "lets a request's second write of another field through over a save another process began and left within the request",
      async () => {
        const t = await boot();

        const [first, paused, second] = await aroundASecondWrite(
          { title: "R2", slug: "r2", note: "only the note" },
          async () => {
            await killRename(t, afterStatement(renames("heading")));
            expect(await liveColumns(t), `killed at ${killedAt}`).toContain(
              "headline"
            );
          }
        );

        expect(first!.ok, JSON.stringify(first)).toBe(true);
        expect(paused!.ok, JSON.stringify(paused)).toBe(true);
        expect(second!.ok, JSON.stringify(second)).toBe(true);
      },
      600_000
    );

    // A delete reads the row it removes, through this process's tables, and answers as a write that
    // sets no field: the save's own change is not in its way, and neither is a process that has
    // read nothing of the collection before it. Each case deletes an entry first thing, through the
    // Direct API or over REST as the signed-in editor.
    for (const { change, via } of [
      { change: "rename", via: "api" },
      { change: "drop", via: "api" },
      { change: "rename", via: "rest" },
      { change: "drop", via: "rest" },
    ] as const) {
      it.runIf(dialect === "mysql")(
        `deletes an entry of a collection a committed ${change} changed, ${via === "rest" ? "over REST, " : ""}first thing in another process`,
        async () => {
          const t = await boot();
          const rows = (await t.adapter.executeQuery(
            `SELECT id FROM ${table} WHERE slug = 'first'`
          )) as unknown as Array<{ id: unknown }>;
          const id = String(rows[0]?.id);
          if (change === "rename") {
            await killRename(t, afterStatement(renames("heading")));
          } else {
            const schemaVersion = await versionOf(t);
            await killSave(t, afterStatement(dropsColumn("heading")), () =>
              dispatchCollections(
                {} as ServiceContainer,
                "applySchemaChanges",
                { collectionName: slug },
                {
                  fields: [field("note")],
                  confirmed: true,
                  schemaVersion,
                  ...dropHeading(1),
                }
              )
            );
          }
          expect(await liveColumns(t), `killed at ${killedAt}`).not.toContain(
            "heading"
          );

          const [deleted] = await fromAnotherProcess([
            { kind: "delete", via, id },
          ]);

          expect(deleted!.ok, JSON.stringify(deleted)).toBe(true);
          expect(
            await t.adapter.executeQuery(
              `SELECT id FROM ${table} WHERE slug = 'first'`
            ),
            "the entry is gone"
          ).toEqual([]);
        },
        600_000
      );
    }
  }
);
