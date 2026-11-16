/**
 * A field's type change judged over stored values: each read as the old field reads its database's
 * text of it, judged, and collected into a class, reasons with their rows, and the rows a lost
 * value would clear.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import type { SupportedDialect } from "../../../services/field-column-descriptor";
import { reasonClass } from "../../judge-column";
import type { ConversionClass, StoredValue } from "../../types";
import { decodeStored } from "../decode-stored";
import { fieldTypeOnDialect } from "../field-type";
import { collectTypeChange, fieldAccepts } from "../judge-stored";

const typeOf = (dialect: SupportedDialect, type: string, extra: object = {}) =>
  fieldTypeOnDialect(
    { name: "f", type, ...extra } as FieldDefinition,
    dialect,
    "collection"
  );

async function* stored(
  ...texts: (string | null)[]
): AsyncGenerator<StoredValue> {
  let id = 0;
  for (const text of texts) {
    id += 1;
    yield { key: { id: String(id) }, text };
  }
}

const RANK: Record<ConversionClass, number> = { safe: 0, lossy: 1, blocked: 2 };

describe("a stored value read as its old field reads it", () => {
  it("reads each database's boolean, timestamp and JSON text", () => {
    expect(
      decodeStored(typeOf("postgresql", "checkbox"), { text: "true" })
    ).toEqual({ kind: "boolean", value: true });
    expect(decodeStored(typeOf("mysql", "checkbox"), { text: "0" })).toEqual({
      kind: "boolean",
      value: false,
    });
    expect(
      decodeStored(typeOf("postgresql", "date"), {
        text: "2026-01-02 03:04:05.120",
      })
    ).toEqual({
      kind: "date",
      date: { seconds: Date.UTC(2026, 0, 2, 3, 4, 5) / 1000, fraction: "12" },
    });
    expect(
      decodeStored(typeOf("sqlite", "date"), { text: "1767323045" })
    ).toEqual({
      kind: "date",
      date: { seconds: 1767323045, fraction: "" },
    });
    expect(decodeStored(typeOf("mysql", "json"), { text: '{"a":1}' })).toEqual({
      kind: "json",
      value: { a: 1 },
    });
    expect(decodeStored(typeOf("sqlite", "chips"), { text: "[]" })).toEqual({
      kind: "empty",
    });
    expect(
      decodeStored(typeOf("sqlite", "number", { hasMany: true }), {
        text: "[3]",
      })
    ).toMatchObject({
      kind: "list",
      items: [{ kind: "number" }],
    });
    expect(decodeStored(typeOf("postgresql", "text"), { text: null })).toEqual({
      kind: "empty",
    });
  });

  it("reads a SQLite real by every digit it holds, not its rounded text", () => {
    expect(
      decodeStored(
        typeOf("sqlite", "number", { options: { format: "float" } }),
        {
          text: "0.1",
          exactReal: "0.10000000000000001",
        }
      )
    ).toMatchObject({ kind: "number", number: { finite: true } });
  });
});

describe("a type change collected over its stored values", () => {
  it("counts each outcome, names each reason's rows, and clears only the lost values", async () => {
    const result = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      stored("01", "abc", "1.5", null)
    );
    expect(result.counts).toEqual({ kept: 1, changed: 1, lost: 1, blocked: 1 });
    expect(result.judgement.class).toBe("blocked");
    expect(result.cleared).toEqual([{ id: "2" }]);
    expect(
      Object.fromEntries(
        result.judgement.reasons.map(r => [r.kind, r.rows?.first])
      )
    ).toEqual({
      "new-form": [{ id: "1" }],
      "not-a-number": [{ id: "2" }],
      rounded: [{ id: "3" }],
    });
    expect(result.readings).toEqual([{ key: { id: "1" }, readsAs: "1" }]);
  });

  it("loses a value the new field's own validation refuses, though the rules would keep it", async () => {
    const toField = {
      name: "f",
      type: "text",
      validation: { minLength: 5 },
    } as unknown as FieldDefinition;
    const result = await collectTypeChange(
      typeOf("postgresql", "textarea"),
      fieldTypeOnDialect(toField, "postgresql", "collection"),
      stored("a", "long enough"),
      fieldAccepts(
        fieldTypeOnDialect(toField, "postgresql", "collection"),
        toField
      )
    );
    expect(result.counts).toEqual({ kept: 1, changed: 0, lost: 1, blocked: 0 });
    expect(result.cleared).toEqual([{ id: "1" }]);
    expect(result.judgement.reasons).toEqual([
      {
        kind: "field-refuses",
        class: "lossy",
        rows: { first: [{ id: "1" }], count: 1 },
      },
    ]);
  });

  it("blocks a pair blocked whatever its values hold, naming no rows", async () => {
    const result = await collectTypeChange(
      typeOf("mysql", "password"),
      typeOf("mysql", "text"),
      stored("hash")
    );
    expect(result.judgement).toEqual({
      class: "blocked",
      reasons: [{ kind: "pair-blocked", class: "blocked" }],
    });
  });

  it("gives a class that is its worst reason's, as the one table classes each reason", async () => {
    for (const [from, to, texts] of [
      ["text", "number", ["01", "x", "2.5"]],
      ["text", "email", ["a@b.io", "nope"]],
      ["number", "checkbox", ["1", "2"]],
      ["json", "date", ["5", '"2026-01-02"', '"2026-01-02T00:00:00Z"']],
      ["chips", "text", ['["a"]', '["a","b"]']],
    ] as const) {
      const result = await collectTypeChange(
        typeOf("postgresql", from),
        typeOf("postgresql", to),
        stored(...texts)
      );
      const worst = result.judgement.reasons
        .map(r => reasonClass(r.kind))
        .reduce<ConversionClass>((a, b) => (RANK[b] > RANK[a] ? b : a), "safe");
      expect([from, to, result.judgement.class]).toEqual([from, to, worst]);
      for (const reason of result.judgement.reasons) {
        expect([reason.kind, reason.class]).toEqual([
          reason.kind,
          reasonClass(reason.kind),
        ]);
      }
    }
  });
});
