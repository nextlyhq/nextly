/**
 * A conversion stopped part-way and finished by the next `--apply`.
 *
 * MySQL commits each schema statement on its own, so a conversion records its progress before its
 * first step and moves the record on after each one. A process stop can come before or after any
 * of those commits, leaving the column at one of its steps and the record level with it or one
 * step behind. Each such state is built here exactly as the stop would leave it: the conversion's
 * own statements run by hand up to the step, and its record written at the step the stop left it.
 * A dry run must then report the live step and change nothing, and an apply must run each
 * remaining step once and end with the column converted, every value kept and one record.
 *
 * On PostgreSQL and SQLite the conversion and its record commit together, so a stopped run leaves
 * neither progress nor a partly converted column.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { applyRepairs, type ConversionStepAt } from "../apply";
import {
  COLUMN_REPAIRS_TABLE,
  ensureColumnRepairsTable,
  insertRepair,
  readRepairs,
} from "../record";
import { stepName } from "../resume";
import { dryRunReport } from "../run-report";
import type { RepairEntity } from "../types";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const POSTS = "dc_rs_posts";
const CARDS = "comp_rs_card";

const TITLE = f({ name: "title", type: "text" });
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});
const RELATED = f({
  name: "related",
  type: "relationship",
  relationTo: "users",
  options: { relationType: "manyToMany" },
});

const ID_1 = "6f1c1f3a-2b7e-4c2a-9d8e-0a1b2c3d4e5f";
const ID_2 = "7a2d2e4b-3c8f-4d3b-8e9f-1b2c3d4e5f60";

/** A field group's table, keyed as its builder keys it, its relation held in one scalar column. */
function cardsEntity(): RepairEntity {
  const definition = {
    fields: [RELATED] as FieldDefinition[],
    localized: false,
    origin: "fieldGroup" as const,
  };
  return {
    kind: "fieldGroup",
    slug: "rs-card",
    table: CARDS,
    applied: { ...definition, source: "snapshot" },
    configured: definition,
  };
}

describe.each(getConfiguredTestDialects().filter(d => d === "mysql"))(
  "a stopped conversion on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;
    const db = () => handle.adapter.getDrizzle();

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
    });

    afterEach(async () => {
      for (const table of [POSTS, CARDS, COLUMN_REPAIRS_TABLE]) {
        await run(`DROP TABLE IF EXISTS ${q(table)}`);
      }
      await handle?.destroy();
    });

    /** One conversion to stop: its table, column, entity and the values it must keep. */
    interface Shape {
      name: string;
      table: string;
      column: string;
      entity: () => RepairEntity;
      create: () => Promise<void>;
      /** Each row's value once converted, by id. */
      converted: (before: Record<string, unknown>) => Record<string, unknown>;
    }

    const shapes: Shape[] = [
      {
        name: "a one-statement conversion with its record (a NOT NULL drop)",
        table: POSTS,
        column: "author",
        entity: () => collection(POSTS, [TITLE, AUTHOR]),
        create: async () => {
          await tools.createTable(POSTS, [TITLE, AUTHOR]);
          await tools.insert(POSTS, [
            { id: "p1", title: "a", author: "u1" },
            { id: "p2", title: "b", author: "u2" },
          ]);
        },
        converted: before => before,
      },
      {
        name: "the list conversion (widen, rewrite, retype)",
        table: CARDS,
        column: "related",
        entity: cardsEntity,
        create: async () => {
          await run(
            `CREATE TABLE ${q(CARDS)} (${q("id")} varchar(36) PRIMARY KEY, ${q("related")} varchar(36))`
          );
          await run(
            `INSERT INTO ${q(CARDS)} VALUES ('r1', '${ID_1}'), ('r2', '${ID_2}'), ('r3', NULL)`
          );
        },
        // Each stored id becomes a one-item list; no value becomes a list.
        converted: before =>
          Object.fromEntries(
            Object.entries(before).map(([id, value]) => [
              id,
              value === null ? null : [value],
            ])
          ),
      },
    ];

    /** The column's state, its values and every repair row: what a stop must not change. */
    async function snapshot(shape: Shape) {
      return {
        column: await tools.columnState(shape.table, shape.column),
        values: await tools.values(shape.table, shape.column),
        repairs: await readRepairs(db(), dialect),
      };
    }

    /**
     * Leave `shape`'s conversion as a stop would: its first `reached` steps committed, and its
     * record written at `recorded`, or none where the stop came before the record's first write.
     */
    async function stopAt(shape: Shape, reached: number, recorded: number) {
      await shape.create();
      const plan = recordOf(
        (
          await dryRunReport({
            adapter: handle.adapter,
            dialect,
            entities: [shape.entity()],
            nextlyVersion: "test",
          })
        ).result?.records,
        shape.column
      );
      const steps = plan.conversion?.steps ?? [];
      const values = await tools.values(shape.table, shape.column);
      await ensureColumnRepairsTable(handle.adapter, dialect);
      await insertRepair(
        db(),
        dialect,
        {
          table: shape.table,
          column: shape.column,
          from: { type: plan.live!.type, nullable: plan.live!.nullable },
          to: { type: plan.expected!.type, nullable: plan.expected!.nullable },
          class: "safe",
          consent: false,
          valuesCleared: 0,
        },
        { state: "in-progress", step: recorded, steps: steps.length }
      );
      await handle.adapter.withSession(
        async session => {
          for (const group of steps.slice(0, reached)) {
            for (const statement of group) await session.execute(statement);
          }
        },
        { strictSqlMode: true }
      );
      return { steps: steps.length, values, expected: plan.expected! };
    }

    for (const shape of shapes) {
      // Every step the column can be left at, with the record level with it (the stop came after
      // the record's write) and, past the first, one step behind (it came after the statement and
      // before the record caught up).
      const stops = (steps: number) =>
        Array.from({ length: steps + 1 }, (_, reached) =>
          reached === 0
            ? [{ reached, recorded: 0 }]
            : [
                { reached, recorded: reached },
                { reached, recorded: reached - 1 },
              ]
        ).flat();

      it(`${shape.name}: a dry run reports the live step and changes nothing; an apply runs each remaining step once`, async () => {
        const total = shape.table === CARDS ? 3 : 1;
        for (const { reached, recorded } of stops(total)) {
          const label = `${shape.name}, column at ${String(reached)}, record at ${String(recorded)}`;
          const { steps, values, expected } = await stopAt(
            shape,
            reached,
            recorded
          );
          expect(steps, label).toBe(total);
          const before = await snapshot(shape);

          const dry = await dryRunReport({
            adapter: handle.adapter,
            dialect,
            entities: [shape.entity()],
            nextlyVersion: "test",
          });
          const reported = recordOf(dry.result?.records, shape.column);
          expect(reported.outcome, label).toBe("interrupted");
          expect(reported.progress, label).toEqual({
            recordedStep: stepName(recorded, total),
            liveStep: stepName(reached, total),
          });
          expect(dry.exitCode, label).toBe(3);
          expect(await snapshot(shape), label).toEqual(before);

          const ran: number[] = [];
          const applied = await applyRepairs({
            adapter: handle.adapter,
            dialect,
            entities: [shape.entity()],
            nextlyVersion: "test",
            beforeStep: (at: ConversionStepAt) => {
              ran.push(at.step);
              return Promise.resolve();
            },
          });
          expect(
            recordOf(applied.result?.records, shape.column).outcome,
            label
          ).toBe("converted");
          // Each remaining step once, none it had already had.
          expect(ran, label).toEqual(
            Array.from({ length: total - reached }, (_, i) => reached + i)
          );
          expect(
            await tools.columnState(shape.table, shape.column),
            label
          ).toMatchObject({
            nullable: expected.nullable,
          });
          const after = await tools.values(shape.table, shape.column);
          const want = shape.converted(values);
          for (const [id, value] of Object.entries(want)) {
            const got = after[id];
            expect(
              shape.table === CARDS && got !== null ? asJson(got) : got,
              `${label}, row ${id}`
            ).toEqual(value);
          }
          const repairs = await readRepairs(db(), dialect);
          expect(repairs, label).toHaveLength(1);
          expect(repairs[0], label).toMatchObject({
            table: shape.table,
            column: shape.column,
            state: "converted",
            step: total,
            steps: total,
          });
          // Nothing is left to convert.
          expect(
            (
              await dryRunReport({
                adapter: handle.adapter,
                dialect,
                entities: [shape.entity()],
                nextlyVersion: "test",
              })
            ).result?.records,
            label
          ).toEqual([]);

          await run(`DROP TABLE IF EXISTS ${q(shape.table)}`);
          await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
        }
      });
    }

    it("a stopped column no entity names any more is read from the column, never taken as converted", async () => {
      const shape = shapes[1];
      await stopAt(shape, 1, 1);
      const before = await snapshot(shape);
      // No entity names the table now, so no finding says what its column holds.
      const dry = await dryRunReport({
        adapter: handle.adapter,
        dialect,
        entities: [],
        nextlyVersion: "test",
      });
      expect(recordOf(dry.result?.records, "related").progress).toEqual({
        recordedStep: stepName(1, 3),
        liveStep: stepName(1, 3),
      });
      const applied = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [],
        nextlyVersion: "test",
      });
      const resumed = recordOf(applied.result?.records, "related");
      // Still widened to text, and its record says so: nothing was taken as converted, and
      // nothing ran without the field that says what the column should become.
      expect(resumed.outcome).toBe("interrupted");
      expect(await snapshot(shape)).toEqual(before);
    });

    it("a column changed by hand to no step is failed and left with its record", async () => {
      const shape = shapes[0];
      await stopAt(shape, 0, 0);
      // By hand, to a type no step of the conversion leaves.
      await run(
        `ALTER TABLE ${q(POSTS)} MODIFY ${q("author")} varchar(40) NOT NULL`
      );
      const before = await snapshot(shape);

      const dry = await dryRunReport({
        adapter: handle.adapter,
        dialect,
        entities: [shape.entity()],
        nextlyVersion: "test",
      });
      const reported = recordOf(dry.result?.records, "author");
      expect(reported.outcome).toBe("failed");
      expect(reported.progress).toEqual({
        recordedStep: stepName(0, 1),
        liveStep: null,
      });

      const applied = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [shape.entity()],
        nextlyVersion: "test",
      });
      const failed = recordOf(applied.result?.records, "author");
      expect(failed.outcome).toBe("failed");
      expect(failed.failure?.reason).toContain("matches no step");
      expect(failed.failure?.reason).toContain("varchar(40)");
      expect(applied.exitCode).toBe(3);
      expect(await snapshot(shape)).toEqual(before);
    });
  }
);

describe.each(getConfiguredTestDialects().filter(d => d !== "mysql"))(
  "a stopped conversion on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(POSTS)}`);
      await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      await handle?.destroy();
    });

    it("a stopped run leaves no recorded progress and no partly converted column", async () => {
      await tools.createTable(POSTS, [TITLE, AUTHOR]);
      await tools.insert(POSTS, [{ id: "p1", title: "a", author: "u1" }]);
      const before = await tools.definition(POSTS);
      const values = await tools.values(POSTS, "author");

      // The run stops as its one step starts, after the column was judged and before the
      // statement and its record commit.
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [collection(POSTS, [TITLE, AUTHOR])],
        nextlyVersion: "test",
        beforeStep: () => Promise.reject(new Error("the process stopped")),
      });
      expect(recordOf(document.result?.records, "author").outcome).toBe(
        "failed"
      );
      expect(await tools.definition(POSTS)).toEqual(before);
      expect(await tools.values(POSTS, "author")).toEqual(values);
      expect(await readRepairs(handle.adapter.getDrizzle(), dialect)).toEqual(
        []
      );
    });
  }
);
