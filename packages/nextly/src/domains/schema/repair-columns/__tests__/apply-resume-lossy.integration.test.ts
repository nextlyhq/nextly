/**
 * A lossy conversion stopped part-way on MySQL, and finished by the next `--apply`.
 *
 * MySQL commits each schema statement on its own, so a lossy `text` to JSON conversion runs in two
 * steps: the clearing of the named values, which commits in one transaction with its progress
 * record and its count, then the retype. A process stop can come before the clearing (the record
 * written, nothing cleared), after it (the record moved with it), or after the retype (the record
 * one step behind). Each such state is built here as the stop would leave it. A dry run must report
 * the step the column holds and change nothing. An apply resuming a clearing needs this run's own
 * consent naming the column: without it the column stays interrupted, as it was; with it, exactly
 * the values this run's judgement names are cleared, once, and the column ends converted with one
 * record of the repair and its count.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  NO_CONSENT,
  resolveDataLossConsent,
  type DataLossConsent,
} from "../../migrate/data-loss-consent";
import { readSchemaLockState } from "../../pipeline/schema-lock";
import { applyRepairs, type ConversionStepAt } from "../apply";
import {
  COLUMN_REPAIRS_TABLE,
  ensureColumnRepairsTable,
  insertRepair,
  readRepairs,
} from "../record";
import { stepName } from "../resume";
import { dryRunReport } from "../run-report";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_rr_posts";
const TITLE = f({ name: "title", type: "text" });
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const ENTITY = collection(TABLE, [TITLE, LINKS]);
const CONSENT = resolveDataLossConsent({ flag: `${TABLE}.links` });
/** The clearing, then the retype. */
const TOTAL = 2;
const name = (step: number) => stepName(step, TOTAL, true);

/** The rows whose values do not parse as JSON, which the conversion clears. */
const NAMED = ["p2", "p3"];
const VALID = '[{"url":"https://example.com"}]';

describe.each(getConfiguredTestDialects().filter(d => d === "mysql"))(
  "a stopped lossy conversion on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;
    const db = () => handle.adapter.getDrizzle();

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      await handle?.destroy();
    });

    async function createTable() {
      await tools.createTable(TABLE, [TITLE, LINKS]);
      await tools.retype(TABLE, "links", "text");
      await tools.insert(TABLE, [
        { id: "p1", title: "a", links: VALID },
        { id: "p2", title: "b", links: "" },
        { id: "p3", title: "c", links: "not json" },
        { id: "p4", title: "d", links: null },
      ]);
    }

    /**
     * Leave the conversion as a stop would: its first `reached` steps committed and its record at
     * `recorded`. The clearing and its record commit together, so a cleared column's record has
     * moved with it and holds its count.
     */
    async function stopAt(reached: number, recorded: number) {
      await createTable();
      const plan = recordOf(
        (
          await dryRunReport({
            adapter: handle.adapter,
            dialect,
            entities: [ENTITY],
            nextlyVersion: "test",
          })
        ).result?.records,
        "links"
      );
      expect(plan.class).toBe("lossy");
      const retype = plan.conversion?.steps ?? [];
      expect(retype).toHaveLength(1);
      await ensureColumnRepairsTable(handle.adapter, dialect);
      await insertRepair(
        db(),
        dialect,
        {
          table: TABLE,
          column: "links",
          from: { type: plan.live!.type, nullable: plan.live!.nullable },
          to: { type: plan.expected!.type, nullable: plan.expected!.nullable },
          class: "lossy",
          consent: true,
          valuesCleared: reached >= 1 ? NAMED.length : 0,
        },
        { state: "in-progress", step: recorded, steps: TOTAL }
      );
      if (reached >= 1) {
        await run(
          `UPDATE ${q(TABLE)} SET ${q("links")} = NULL WHERE ${q("id")} IN (${NAMED.map(id => `'${id}'`).join(", ")})`
        );
      }
      if (reached >= 2) {
        await handle.adapter.withSession(
          async session => {
            for (const statement of retype[0]) await session.execute(statement);
          },
          { strictSqlMode: true }
        );
      }
    }

    async function snapshot() {
      return {
        column: await tools.columnState(TABLE, "links"),
        values: await tools.values(TABLE, "links"),
        repairs: await readRepairs(db(), dialect),
      };
    }

    const apply = (consent: DataLossConsent, ran: number[] = []) =>
      applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [ENTITY],
        nextlyVersion: "test",
        consent,
        beforeStep: (at: ConversionStepAt) => {
          ran.push(at.step);
          return Promise.resolve();
        },
      });

    /** The column converted, with exactly the named values cleared and every other kept. */
    async function expectConverted(label: string) {
      expect(await tools.columnState(TABLE, "links"), label).toMatchObject({
        type: "json",
      });
      const values = await tools.values(TABLE, "links");
      expect(asJson(values.p1), label).toEqual(JSON.parse(VALID));
      for (const id of [...NAMED, "p4"]) expect(values[id], label).toBeNull();
      const repairs = await readRepairs(db(), dialect);
      expect(repairs, label).toHaveLength(1);
      expect(repairs[0], label).toMatchObject({
        class: "lossy",
        consent: true,
        valuesCleared: NAMED.length,
        state: "converted",
        step: TOTAL,
        steps: TOTAL,
      });
    }

    it("stops before and after the clearing and each later statement of a lossy text to JSON conversion; resuming with the same consent clears exactly the named values once; resuming without consent leaves it interrupted and unchanged", async () => {
      // Each state a stop can leave: before the clearing; after it, with its record; after the
      // retype, with the record still at the clearing.
      const stops = [
        { reached: 0, recorded: 0 },
        { reached: 1, recorded: 1 },
        { reached: 2, recorded: 1 },
      ];
      for (const { reached, recorded } of stops) {
        const label = `column at ${String(reached)}, record at ${String(recorded)}`;
        await stopAt(reached, recorded);
        const before = await snapshot();

        const dry = await dryRunReport({
          adapter: handle.adapter,
          dialect,
          entities: [ENTITY],
          nextlyVersion: "test",
        });
        const reported = recordOf(dry.result?.records, "links");
        expect(reported.outcome, label).toBe("interrupted");
        expect(reported.progress, label).toEqual({
          recordedStep: name(recorded),
          liveStep: name(reached),
        });
        expect(await snapshot(), label).toEqual(before);

        if (reached === 0) {
          // The clearing is still to run, and this run has no consent naming the column.
          const ran: number[] = [];
          const refused = await apply(NO_CONSENT, ran);
          const record = recordOf(refused.result?.records, "links");
          expect(record.outcome, label).toBe("interrupted");
          expect(record.consent?.given, label).toBeNull();
          expect(ran, label).toEqual([]);
          expect(refused.exitCode, label).toBe(3);
          expect(await snapshot(), label).toEqual(before);
        }

        const ran: number[] = [];
        const applied = await apply(CONSENT, ran);
        expect(recordOf(applied.result?.records, "links").outcome, label).toBe(
          "converted"
        );
        // Each remaining step once, none it had already had.
        expect(ran, label).toEqual(
          Array.from({ length: TOTAL - reached }, (_, i) => reached + i)
        );
        await expectConverted(label);

        await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
        await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      }
    });

    it("a clearing still to run is asked about before the lock, and a yes resumes it; a no leaves it interrupted", async () => {
      await stopAt(0, 0);
      const before = await snapshot();
      const lockWhileAsked: string[] = [];
      const ask = (answer: boolean) =>
        applyRepairs({
          adapter: handle.adapter,
          dialect,
          entities: [ENTITY],
          nextlyVersion: "test",
          confirmClearing: async question => {
            expect(question).toMatchObject({
              table: TABLE,
              column: "links",
              count: NAMED.length,
            });
            lockWhileAsked.push(
              (await readSchemaLockState(handle.adapter)).state
            );
            return answer;
          },
        });

      const declined = await ask(false);
      expect(recordOf(declined.result?.records, "links").outcome).toBe(
        "interrupted"
      );
      expect(await snapshot()).toEqual(before);

      const confirmed = await ask(true);
      const record = recordOf(confirmed.result?.records, "links");
      expect(record.outcome).toBe("converted");
      expect(record.consent).toMatchObject({
        given: "confirmed",
        valuesCleared: NAMED.length,
      });
      expect(lockWhileAsked).toEqual(["free", "free"]);
      await expectConverted("confirmed");
    });

    it("a run stopped before its retype keeps the cleared values and its count, and the next run retypes without consent", async () => {
      await createTable();
      const stopped = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [ENTITY],
        nextlyVersion: "test",
        consent: CONSENT,
        beforeStep: at =>
          at.step === 1
            ? Promise.reject(new Error("the process stopped"))
            : Promise.resolve(),
      });
      const failed = recordOf(stopped.result?.records, "links");
      expect(failed.outcome).toBe("failed");
      expect(failed.failure?.heldStep).toBe("values cleared");
      expect(failed.consent).toMatchObject({
        given: "flag",
        valuesCleared: NAMED.length,
      });
      expect(await readRepairs(db(), dialect)).toEqual([
        expect.objectContaining({
          state: "in-progress",
          step: 1,
          valuesCleared: NAMED.length,
        }),
      ]);
      const values = await tools.values(TABLE, "links");
      for (const id of NAMED) expect(values[id]).toBeNull();
      expect(values.p1).toBe(VALID);

      // Nothing is left to clear, so the retype needs no consent.
      const ran: number[] = [];
      const resumed = await apply(NO_CONSENT, ran);
      expect(recordOf(resumed.result?.records, "links").outcome).toBe(
        "converted"
      );
      expect(ran).toEqual([1]);
      await expectConverted("resumed");
    });

    it("a value written after the judgement and before the clearing is not cleared, and the retype refuses it", async () => {
      await createTable();
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [ENTITY],
        nextlyVersion: "test",
        consent: CONSENT,
        beforeStep: async at => {
          // Between the run's judgement and its clearing, another writer saves a value that does
          // not parse: the consent covered the rows the judgement named, not this one.
          if (at.step === 0) {
            await tools.insert(TABLE, [
              { id: "p9", title: "late", links: "late" },
            ]);
          }
        },
      });
      const record = recordOf(document.result?.records, "links");
      expect(record.outcome).toBe("failed");
      expect(record.failure?.heldStep).toBe("values cleared");
      expect(record.consent?.valuesCleared).toBe(NAMED.length);
      const values = await tools.values(TABLE, "links");
      expect(values.p9).toBe("late");
      for (const id of NAMED) expect(values[id]).toBeNull();
      expect(await tools.columnState(TABLE, "links")).toMatchObject({
        type: "text",
      });
      expect(await readRepairs(db(), dialect)).toEqual([
        expect.objectContaining({ step: 1, valuesCleared: NAMED.length }),
      ]);
    });

    it("a value written after the clearing is cleared only under this run's consent, judged now", async () => {
      await stopAt(1, 1);
      // Written between the runs: a value the clearing never saw.
      await tools.insert(TABLE, [{ id: "p5", title: "late", links: "late" }]);
      const before = await snapshot();

      const dry = await dryRunReport({
        adapter: handle.adapter,
        dialect,
        entities: [ENTITY],
        nextlyVersion: "test",
      });
      expect(recordOf(dry.result?.records, "links").progress).toEqual({
        recordedStep: name(1),
        liveStep: name(0),
      });

      const refused = await apply(NO_CONSENT);
      expect(recordOf(refused.result?.records, "links").outcome).toBe(
        "interrupted"
      );
      expect(await snapshot()).toEqual(before);

      const applied = await apply(CONSENT);
      const record = recordOf(applied.result?.records, "links");
      expect(record.outcome).toBe("converted");
      // This run cleared the one value its own judgement named.
      expect(record.consent?.valuesCleared).toBe(1);
      const values = await tools.values(TABLE, "links");
      expect(values.p5).toBeNull();
      expect(asJson(values.p1)).toEqual(JSON.parse(VALID));
      expect((await readRepairs(db(), dialect))[0]).toMatchObject({
        state: "converted",
        valuesCleared: NAMED.length + 1,
      });
    });
  }
);

describe.each(getConfiguredTestDialects().filter(d => d !== "mysql"))(
  "a stopped lossy conversion on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      await handle?.destroy();
    });

    it("a stopped run leaves no recorded progress and no value cleared", async () => {
      // The lossy case each dialect holds: a repeater held as text on PostgreSQL; on SQLite, where
      // JSON is text, an integer column becoming a real and holding a word.
      const price = f({
        name: "price",
        type: "number",
        options: { format: "float" },
      });
      let column: string;
      let entity;
      if (dialect === "sqlite") {
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} integer)`
        );
        await tools.insert(TABLE, [
          { id: "p1", title: "a", price: 3 },
          { id: "p2", title: "b", price: "word" },
        ]);
        column = "price";
        entity = collection(TABLE, [TITLE, price]);
      } else {
        await createLegacyLinks();
        column = "links";
        entity = ENTITY;
      }
      const before = await tools.definition(TABLE);
      const values = await tools.values(TABLE, column);

      // The run stops as its conversion starts, once the column was judged and its values were
      // about to be cleared: the clearing and the conversion commit together, or neither does.
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [entity],
        nextlyVersion: "test",
        consent: resolveDataLossConsent({ flag: `${TABLE}.${column}` }),
        beforeStep: () => Promise.reject(new Error("the process stopped")),
      });
      expect(recordOf(document.result?.records, column).outcome).toBe("failed");
      expect(await tools.definition(TABLE)).toEqual(before);
      expect(await tools.values(TABLE, column)).toEqual(values);
      expect(await readRepairs(handle.adapter.getDrizzle(), dialect)).toEqual(
        []
      );
    });

    /** The repeater held as text, with a value that does not parse. */
    async function createLegacyLinks() {
      await tools.createTable(TABLE, [TITLE, LINKS]);
      await tools.retype(TABLE, "links", "text");
      await tools.insert(TABLE, [
        { id: "p1", title: "a", links: VALID },
        { id: "p2", title: "b", links: "" },
      ]);
    }
  }
);
