/**
 * `nextly repair-columns --apply` and a lossy column: one whose values the new type cannot hold,
 * which converting would clear.
 *
 * Such a column converts only when the data-loss consent names it as `table.column`, or the person
 * at the terminal confirms it. A consent naming another column, the table alone, or nothing (the
 * blanket form) leaves it as it was, skipped, with what would cover it. Under a consent naming it,
 * the values cleared are exactly the rows the run's judgement named, past the bound the report
 * prints, and each repair is recorded with its consent and its count. A column that is both lossy
 * and blocked is never converted, whatever the consent names.
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
import { AFFECTED_ROWS_BOUND } from "../../value-conversion/judge-column";
import { applyRepairs, type ClearingQuestion } from "../apply";
import { COLUMN_REPAIRS_TABLE, readRepairs } from "../record";
import { dryRunReport } from "../run-report";
import type { RepairEntity } from "../types";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_rl_posts";

const TITLE = f({ name: "title", type: "text" });
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const REQUIRED_LINKS = f({ ...LINKS, required: true });
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const REQUIRED_PRICE = f({ ...PRICE, required: true });

const named = (targets: string): DataLossConsent =>
  resolveDataLossConsent({ flag: targets });
const BLANKET = resolveDataLossConsent({ flag: true });

describe.each(getConfiguredTestDialects())(
  "repair-columns --apply and a lossy column on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;
    const db = () => handle.adapter.getDrizzle();

    const apply = (
      entity: RepairEntity,
      extra: {
        consent?: DataLossConsent;
        confirmClearing?: (question: ClearingQuestion) => Promise<boolean>;
      } = {}
    ) =>
      applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [entity],
        nextlyVersion: "test",
        ...extra,
      });

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await run(`DROP TABLE IF EXISTS ${q(COLUMN_REPAIRS_TABLE)}`);
      await handle?.destroy();
    });

    /**
     * A lossy column this dialect can hold, and the rows whose values its conversion would clear.
     * PostgreSQL and MySQL: a repeater held as text, with an empty string and a value that does
     * not parse. SQLite, where JSON is text: an integer column becoming a real, holding a word the
     * real column would keep as text.
     */
    async function lossyTable(
      bad = 2
    ): Promise<{ entity: RepairEntity; column: string; cleared: string[] }> {
      if (dialect === "sqlite") {
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} integer)`
        );
        await tools.insert(TABLE, [
          { id: "p0", title: "kept", price: 3 },
          ...Array.from({ length: bad }, (_, i) => ({
            id: `p${String(i + 1).padStart(2, "0")}`,
            title: "word",
            price: `word${i}`,
          })),
          { id: "pz", title: "none", price: null },
        ]);
        return {
          entity: collection(TABLE, [TITLE, PRICE]),
          column: "price",
          cleared: Array.from(
            { length: bad },
            (_, i) => `p${String(i + 1).padStart(2, "0")}`
          ),
        };
      }
      await tools.createTable(TABLE, [TITLE, LINKS]);
      await tools.retype(TABLE, "links", "text");
      await tools.insert(TABLE, [
        { id: "p0", title: "kept", links: '[{"url":"https://example.com"}]' },
        ...Array.from({ length: bad }, (_, i) => ({
          id: `p${String(i + 1).padStart(2, "0")}`,
          title: "bad",
          links: i % 2 === 0 ? "" : `not json ${i}`,
        })),
        { id: "pz", title: "none", links: null },
      ]);
      return {
        entity: collection(TABLE, [TITLE, LINKS]),
        column: "links",
        cleared: Array.from(
          { length: bad },
          (_, i) => `p${String(i + 1).padStart(2, "0")}`
        ),
      };
    }

    /**
     * Every row's value of the lossy column, read back as the field reads it: a JSON value by what
     * it parses to, a number by its value. A value that is neither, before the conversion, is kept
     * as stored, so it still compares with itself.
     */
    async function readBack(column: string): Promise<Record<string, unknown>> {
      const values = await tools.values(TABLE, column);
      const read = (value: unknown): unknown => {
        if (value === null) return null;
        if (column !== "links") {
          const number = Number(value);
          return Number.isNaN(number) ? value : number;
        }
        try {
          return asJson(value);
        } catch {
          return value;
        }
      };
      return Object.fromEntries(
        Object.entries(values).map(([id, value]) => [id, read(value)])
      );
    }

    it("no consent, a consent naming another column, a blanket consent, a consent naming this one", async () => {
      const { entity, column, cleared } = await lossyTable();
      const flag = `--accept-data-loss=${TABLE}.${column}`;
      const stateBefore = await tools.columnState(TABLE, column);
      const valuesBefore = await tools.values(TABLE, column);

      const uncovered: Array<[string, DataLossConsent, RegExp | null]> = [
        ["no consent", NO_CONSENT, null],
        ["another column", named(`${TABLE}.title`), null],
        ["the table alone", named(TABLE), /names the table/],
        ["a blanket consent", BLANKET, /without a list does not cover/],
      ];
      for (const [label, consent, notice] of uncovered) {
        const document = await apply(entity, { consent });
        const record = recordOf(document.result?.records, column);
        expect(record.outcome, label).toBe("skipped-needs-consent");
        expect(record.consent, label).toMatchObject({
          given: null,
          valuesCleared: 0,
          flag,
        });
        if (notice === null) expect(record.consent?.notice, label).toBeNull();
        else expect(record.consent?.notice, label).toMatch(notice);
        expect(document.exitCode, label).toBe(2);
        expect(await tools.columnState(TABLE, column), label).toEqual(
          stateBefore
        );
        expect(await tools.values(TABLE, column), label).toEqual(valuesBefore);
      }
      expect(await readRepairs(db(), dialect)).toEqual([]);

      const kept = await readBack(column);
      const document = await apply(entity, {
        consent: named(`${TABLE}.title,${TABLE}.${column}`),
      });
      const record = recordOf(document.result?.records, column);
      expect(record.outcome).toBe("converted");
      expect(record.consent).toMatchObject({
        given: "flag",
        valuesCleared: cleared.length,
      });
      expect(document.exitCode).toBe(0);
      const after = await readBack(column);
      for (const [id, value] of Object.entries(kept)) {
        // Exactly the named rows are cleared; every other value reads back as it was.
        expect(after[id], `row ${id}`).toEqual(
          cleared.includes(id) ? null : value
        );
      }
      expect(await tools.columnState(TABLE, column)).toMatchObject({
        type:
          dialect === "postgresql"
            ? "jsonb"
            : dialect === "mysql"
              ? "json"
              : "real",
      });
      const repairs = await readRepairs(db(), dialect);
      expect(repairs).toHaveLength(1);
      expect(repairs[0]).toMatchObject({
        table: TABLE,
        column,
        class: "lossy",
        consent: true,
        valuesCleared: cleared.length,
        state: "converted",
      });
    });

    it.skipIf(dialect !== "sqlite")(
      "no lossy repeater or group case arises",
      async () => {
        // On SQLite JSON is text, so a repeater holding a value that does not parse differs from
        // its field in nothing: no record, nothing converted or cleared, consent or not.
        await tools.createTable(TABLE, [TITLE, LINKS]);
        await tools.insert(TABLE, [
          { id: "p1", title: "a", links: "" },
          { id: "p2", title: "b", links: "not json" },
        ]);
        const entity = collection(TABLE, [TITLE, LINKS]);
        const before = await tools.values(TABLE, "links");
        const dry = await dryRunReport({
          adapter: handle.adapter,
          dialect,
          entities: [entity],
          nextlyVersion: "test",
        });
        expect(
          (dry.result?.records ?? []).filter(r => r.column === "links")
        ).toEqual([]);
        const document = await apply(entity, {
          consent: named(`${TABLE}.links`),
        });
        expect(
          (document.result?.records ?? []).filter(r => r.column === "links")
        ).toEqual([]);
        expect(await tools.values(TABLE, "links")).toEqual(before);
        expect(await readRepairs(db(), dialect)).toEqual([]);
      }
    );

    it("a lossy-and-blocked column is unchanged under a consent naming it", async () => {
      let entity: RepairEntity;
      let column: string;
      if (dialect === "sqlite") {
        // A nullable integer column holding a word and a null, whose field expects a non-null real.
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} integer)`
        );
        await tools.insert(TABLE, [
          { id: "p1", title: "a", price: 4 },
          { id: "p2", title: "b", price: "word" },
          { id: "p3", title: "c", price: null },
        ]);
        entity = collection(TABLE, [TITLE, REQUIRED_PRICE]);
        column = "price";
      } else {
        // A nullable text column holding valid JSON, a value that does not parse and a null, whose
        // field expects a non-null JSON column.
        await tools.createTable(TABLE, [TITLE, REQUIRED_LINKS]);
        await tools.retype(TABLE, "links", "text", true);
        await tools.insert(TABLE, [
          { id: "p1", title: "a", links: '[{"url":"https://example.com"}]' },
          { id: "p2", title: "b", links: "oops" },
          { id: "p3", title: "c", links: null },
        ]);
        entity = collection(TABLE, [TITLE, REQUIRED_LINKS]);
        column = "links";
      }
      const before = await tools.definition(TABLE);
      const values = await tools.values(TABLE, column);
      let asked = 0;
      const document = await apply(entity, {
        consent: named(`${TABLE}.${column}`),
        confirmClearing: () => {
          asked += 1;
          return Promise.resolve(true);
        },
      });
      const record = recordOf(document.result?.records, column);
      expect(record.outcome).toBe("blocked");
      expect(record.reasons?.map(r => r.kind)).toEqual(
        expect.arrayContaining([
          dialect === "sqlite" ? "kept-unreadable" : "not-json",
          "null-under-not-null",
          "cleared-under-not-null",
        ])
      );
      // Nothing is asked about a column that would not convert whatever the answer.
      expect(asked).toBe(0);
      expect(await tools.definition(TABLE)).toEqual(before);
      expect(await tools.values(TABLE, column)).toEqual(values);
      expect(await readRepairs(db(), dialect)).toEqual([]);
    });

    it("clears every named row past the bound the report prints, and no other", async () => {
      const bad = AFFECTED_ROWS_BOUND + 5;
      const { entity, column, cleared } = await lossyTable(bad);
      const kept = await readBack(column);
      const document = await apply(entity, {
        consent: named(`${TABLE}.${column}`),
      });
      const record = recordOf(document.result?.records, column);
      expect(record.outcome).toBe("converted");
      expect(record.consent?.valuesCleared).toBe(bad);
      const lossy = record.reasons?.find(r => r.class === "lossy");
      expect(lossy?.rows?.count).toBe(bad);
      expect(lossy?.rows?.first).toHaveLength(AFFECTED_ROWS_BOUND);
      const after = await readBack(column);
      for (const [id, value] of Object.entries(kept)) {
        expect(after[id], `row ${id}`).toEqual(
          cleared.includes(id) ? null : value
        );
      }
    });

    it("a lossy column whose conversion fails under a consent naming it keeps that consent on its record", async () => {
      const { entity, column } = await lossyTable();
      const values = await tools.values(TABLE, column);
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [entity],
        nextlyVersion: "test",
        consent: named(`${TABLE}.${column}`),
        beforeStep: () => Promise.reject(new Error("the database refused")),
      });
      const record = recordOf(document.result?.records, column);
      expect(record.outcome).toBe("failed");
      // The consent was given: the record says so, and does not ask for it again.
      expect(record.consent).toMatchObject({
        given: "flag",
        valuesCleared: 0,
      });
      expect(document.exitCode).toBe(3);
      expect(await tools.values(TABLE, column)).toEqual(values);
    });

    describe("the person at the terminal", () => {
      it("is asked once per lossy column with its count and first rows, before the schema lock is taken, and a yes converts it", async () => {
        const { entity, column, cleared } = await lossyTable();
        const questions: ClearingQuestion[] = [];
        const lockWhileAsked: string[] = [];
        const document = await apply(entity, {
          confirmClearing: async question => {
            questions.push(question);
            // Nothing is held while the person answers: another schema change could run now.
            lockWhileAsked.push(
              (await readSchemaLockState(handle.adapter)).state
            );
            return true;
          },
        });
        expect(lockWhileAsked).toEqual(["free"]);
        expect(questions).toHaveLength(1);
        expect(questions[0]).toMatchObject({
          table: TABLE,
          column,
          count: cleared.length,
          first: cleared.map(id => ({ id })),
        });
        const record = recordOf(document.result?.records, column);
        expect(record.outcome).toBe("converted");
        expect(record.consent).toMatchObject({
          given: "confirmed",
          valuesCleared: cleared.length,
        });
        const after = await readBack(column);
        for (const id of cleared) expect(after[id], `row ${id}`).toBeNull();
      });

      it("a no leaves the column as it was, skipped", async () => {
        const { entity, column } = await lossyTable();
        const before = await tools.values(TABLE, column);
        const document = await apply(entity, {
          confirmClearing: () => Promise.resolve(false),
        });
        expect(recordOf(document.result?.records, column).outcome).toBe(
          "skipped-needs-consent"
        );
        expect(await tools.values(TABLE, column)).toEqual(before);
        expect(await readRepairs(db(), dialect)).toEqual([]);
      });

      it("is not asked about a column the consent already names", async () => {
        const { entity, column } = await lossyTable();
        let asked = 0;
        const document = await apply(entity, {
          consent: named(`${TABLE}.${column}`),
          confirmClearing: () => {
            asked += 1;
            return Promise.resolve(false);
          },
        });
        expect(asked).toBe(0);
        expect(recordOf(document.result?.records, column).consent?.given).toBe(
          "flag"
        );
      });

      it("a row that would be cleared and was not shown, written after the yes, keeps the column as it was", async () => {
        const { entity, column } = await lossyTable();
        const before = await tools.values(TABLE, column);
        const document = await apply(entity, {
          confirmClearing: async () => {
            // Another writer saves a value the new type cannot hold while the person answers.
            await tools.insert(TABLE, [
              dialect === "sqlite"
                ? { id: "p99", title: "late", price: "late word" }
                : { id: "p99", title: "late", links: "late" },
            ]);
            return true;
          },
        });
        const record = recordOf(document.result?.records, column);
        expect(record.outcome).toBe("skipped-needs-consent");
        expect(record.consent?.notice).toMatch(/changed since/);
        expect(record.consent?.valuesCleared).toBe(0);
        // Every value as it was, the late one included: nothing was cleared.
        const after = await tools.values(TABLE, column);
        expect(after.p99).not.toBeNull();
        delete after.p99;
        expect(after).toEqual(before);
        expect(await tools.columnState(TABLE, column)).toMatchObject({
          type: dialect === "sqlite" ? "integer" : "text",
        });
        expect(await readRepairs(db(), dialect)).toEqual([]);
      });
    });
  }
);
