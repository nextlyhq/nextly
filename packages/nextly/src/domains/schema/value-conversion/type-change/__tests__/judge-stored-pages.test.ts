/**
 * A type change's readings handed to the writer of its values a page at a time, as the values are
 * read and judged (`judgeStoredTypeChange`'s `readingPages`), so a conversion never holds a large
 * table's readings whole.
 *
 * What separates the right answer from the plausible wrong one: a judgement that gathers every
 * reading and hands them over once the scan ends writes the same values in the end, but holds them
 * all first. Here the writer is asked while values are still being read, each page no larger than
 * its size, and every reading reaches it once.
 */
import { describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import type { StoredValue } from "../../types";
import { fieldTypeOnDialect } from "../field-type";
import type { Reading } from "../judge-stored";

/** Each value the stand-in scan hands over, by its row, as `read` events. */
const events: string[] = [];
const ROWS = 450;

vi.mock("../../read-values", () => ({
  async *readStoredValues(): AsyncGenerator<StoredValue> {
    for (let id = 1; id <= ROWS; id += 1) {
      events.push(`read ${String(id)}`);
      yield { key: { id: String(id) }, text: String(id) };
    }
  },
}));

const { judgeStoredTypeChange } = await import("../judge-stored");

const typeOf = (type: string) =>
  fieldTypeOnDialect(
    { name: "f", type } as FieldDefinition,
    "postgresql",
    "collection"
  );

describe("a conversion's readings, a page at a time", () => {
  it("hands each page to its writer before the next values are read, every reading once", async () => {
    const pages: Reading[][] = [];
    const judgement = await judgeStoredTypeChange({
      db: undefined,
      dialect: "postgresql",
      table: "t",
      column: "f",
      keyedBy: "id",
      from: typeOf("text"),
      to: typeOf("number"),
      rewrites: true,
      readingPages: {
        size: 200,
        write: page => {
          events.push(`write ${String(page.length)}`);
          pages.push([...page]);
          return Promise.resolve();
        },
      },
    });

    expect(judgement.counts.kept + judgement.counts.changed).toBe(ROWS);
    expect(pages.map(page => page.length)).toEqual([200, 200, 50]);
    // The first page is written while the scan has read only one value past it.
    expect(events.indexOf("write 200")).toBe(events.indexOf("read 201") + 1);
    expect(events.indexOf("write 200")).toBeLessThan(
      events.indexOf(`read ${String(ROWS)}`)
    );
    expect(
      pages.flat().map(reading => [reading.key, reading.readsAs])
    ).toEqual(
      Array.from({ length: ROWS }, (_, at) => [
        { id: String(at + 1) },
        String(at + 1),
      ])
    );
  });
});
