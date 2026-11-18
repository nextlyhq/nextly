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
      stored("5", "abc", "1.5", null)
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
  });

  it("blocks a value read in a new form no save writes yet, and passes one stored as it reads", async () => {
    // "5" is stored as the number reads; "01" and "5.0" read as 1 and 5 only once rewritten.
    const numbers = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      stored("5", "01", "5.0")
    );
    expect(
      numbers.judgement.reasons.find(r => r.kind === "needs-rewrite")?.rows
    ).toEqual({ first: [{ id: "2" }, { id: "3" }], count: 2 });
    expect(numbers.counts).toMatchObject({ changed: 1, blocked: 2 });
    // MySQL's checkbox column holds 1 and 0: a stored "true" reads as true only once rewritten.
    const checkbox = await collectTypeChange(
      typeOf("mysql", "text"),
      typeOf("mysql", "checkbox"),
      stored("true")
    );
    expect(checkbox.judgement.reasons).toEqual([
      {
        kind: "needs-rewrite",
        class: "blocked",
        rows: { first: [{ id: "1" }], count: 1 },
      },
    ]);
    // A one-item list of texts read as its item: the column keeps the list's writing.
    const unwrapped = await collectTypeChange(
      typeOf("postgresql", "text", { hasMany: true }),
      typeOf("postgresql", "text"),
      stored('["a"]')
    );
    expect(unwrapped.judgement.class).toBe("blocked");
    // A number read as text is the database's own text of it, which its cast writes.
    const asText = await collectTypeChange(
      typeOf("mysql", "number"),
      typeOf("mysql", "text"),
      stored("4")
    );
    expect(asText.judgement.class).toBe("safe");
    // One link becoming a list of links: every road's reference-list conversion writes it.
    const linked = await collectTypeChange(
      typeOf("postgresql", "relationship", { relationTo: "people" }),
      typeOf("postgresql", "relationship", {
        relationTo: "people",
        hasMany: true,
      }),
      stored("p1")
    );
    expect(linked.judgement.class).toBe("safe");
  });

  it("hands each kept or changed value, as the new type reads it, to the caller that asks", async () => {
    const seen: { key: unknown; readsAs: string }[] = [];
    await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      stored("01", "abc"),
      undefined,
      { onReading: (key, readsAs) => seen.push({ key, readsAs }) }
    );
    expect(seen).toEqual([{ key: { id: "1" }, readsAs: "1" }]);
  });

  it("blocks a unique field's change where two values read as one value of the new type", async () => {
    const result = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      stored("1", "2", "01", null, null),
      undefined,
      { unique: true }
    );
    expect(result.judgement.class).toBe("blocked");
    expect(result.judgement.reasons.find(r => r.kind === "repeated")).toEqual({
      kind: "repeated",
      class: "blocked",
      rows: { first: [{ id: "1" }, { id: "3" }], count: 2 },
    });
    // A field that is not unique holds the same value twice.
    const plain = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      stored("1", "1")
    );
    expect(plain.judgement.class).toBe("safe");
  });

  it("counts a unique translated field's repeats within each language", async () => {
    async function* perLanguage(): AsyncGenerator<StoredValue> {
      yield { key: { parent: "a", locale: "en" }, text: "1" };
      yield { key: { parent: "a", locale: "fr" }, text: "01" };
      yield { key: { parent: "b", locale: "fr" }, text: "1" };
    }
    const result = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "number"),
      perLanguage(),
      undefined,
      { unique: true }
    );
    expect(
      result.judgement.reasons.find(r => r.kind === "repeated")?.rows
    ).toEqual({
      first: [
        { parent: "a", locale: "fr" },
        { parent: "b", locale: "fr" },
      ],
      count: 2,
    });
  });

  it("blocks a JSON value holding a number JavaScript cannot keep, rather than judging it rounded", async () => {
    // 0.10000000000000001 parses to 0.1: judged from the parse, the change would look safe while
    // the digits are lost. Read from its writing, the number is one a double rounds.
    const result = await collectTypeChange(
      typeOf("postgresql", "json"),
      typeOf("postgresql", "number", { options: { format: "float" } }),
      stored("0.10000000000000001", "0.5", "[0.10000000000000001]")
    );
    expect(result.judgement.class).toBe("blocked");
    expect(
      result.judgement.reasons.find(r => r.kind === "rounded")?.rows
    ).toEqual({ first: [{ id: "1" }, { id: "3" }], count: 2 });
    expect(result.counts.kept + result.counts.changed).toBe(1);
  });

  it("blocks a kept value whose stored form is not its reading, as a text kept as a JSON string", async () => {
    // "foo" read as the JSON string "foo" is stored unquoted: PostgreSQL's cast refuses it, and a
    // stored "1" would become the number 1.
    const json = await collectTypeChange(
      typeOf("postgresql", "text"),
      typeOf("postgresql", "json"),
      stored("foo", "1")
    );
    expect(json.judgement.reasons).toEqual([
      {
        kind: "needs-rewrite",
        class: "blocked",
        rows: { first: [{ id: "1" }, { id: "2" }], count: 2 },
      },
    ]);
    // A number kept from one number column to another is the same number, however written.
    const numbers = await collectTypeChange(
      typeOf("postgresql", "number", { options: { format: "float" } }),
      typeOf("postgresql", "number", { dbType: "decimal" }),
      stored("2", "2.50")
    );
    expect(numbers.judgement.class).toBe("safe");
  });

  it("blocks a stored empty list becoming a single value, and keeps it becoming another list", async () => {
    const scalar = await collectTypeChange(
      typeOf("postgresql", "text", { hasMany: true }),
      typeOf("postgresql", "text"),
      stored("[]", null)
    );
    expect(scalar.judgement.reasons).toEqual([
      {
        kind: "needs-rewrite",
        class: "blocked",
        rows: { first: [{ id: "1" }], count: 1 },
      },
    ]);
    const list = await collectTypeChange(
      typeOf("postgresql", "text", { hasMany: true }),
      typeOf("postgresql", "number", { hasMany: true }),
      stored("[]", null)
    );
    expect(list.judgement.class).toBe("safe");
  });

  it("counts a MySQL text column's bytes in its table's character set", async () => {
    // 40,000 ASCII characters are 40,000 UTF-8 bytes, which a text column holds, and 80,000 in
    // UTF-16, which it does not.
    const long = "a".repeat(40_000);
    const into = (charset?: string) => ({
      ...typeOf("mysql", "text"),
      textBound: {
        unit: "bytes" as const,
        most: 65_535,
        ...(charset !== undefined ? { charset } : {}),
      },
    });
    const utf8 = await collectTypeChange(
      typeOf("mysql", "textarea"),
      into(),
      stored(long)
    );
    expect(utf8.judgement.class).toBe("safe");
    const utf16 = await collectTypeChange(
      typeOf("mysql", "textarea"),
      into("utf16"),
      stored(long)
    );
    expect(utf16.judgement.reasons.map(r => r.kind)).toEqual(["too-long"]);
  });

  it("judges a blank link becoming a list as the empty list its conversion writes", async () => {
    // Every road's reference-list conversion writes a blank link as `[]`: a required list refuses
    // it, where read as `[""]` it would pass.
    const toField = {
      name: "f",
      type: "relationship",
      relationTo: "people",
      hasMany: true,
      required: true,
    } as unknown as FieldDefinition;
    const to = fieldTypeOnDialect(toField, "postgresql", "collection");
    const result = await collectTypeChange(
      typeOf("postgresql", "relationship", { relationTo: "people" }),
      to,
      stored("", "  ", "p1"),
      fieldAccepts(to, toField)
    );
    expect(result.cleared).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.counts).toMatchObject({ lost: 2, changed: 1 });
  });

  it("asks a required list whether it holds a stored empty list", async () => {
    // `[]` is not a null, so no NOT NULL rule refuses it: the required field's own rule does.
    const toField = {
      name: "f",
      type: "number",
      hasMany: true,
      required: true,
    } as unknown as FieldDefinition;
    const to = fieldTypeOnDialect(toField, "postgresql", "collection");
    const result = await collectTypeChange(
      typeOf("postgresql", "text", { hasMany: true }),
      to,
      stored("[]", null),
      fieldAccepts(to, toField)
    );
    expect(result.cleared).toEqual([{ id: "1" }]);
    expect(result.judgement.reasons.map(r => r.kind)).toEqual([
      "field-refuses",
    ]);
  });

  it("blocks a relationship kept as a list becoming one link, where a row holds several", async () => {
    const list = typeOf("postgresql", "relationship", {
      relationTo: "people",
      hasMany: true,
    });
    const one = typeOf("postgresql", "relationship", { relationTo: "people" });
    expect([list.relation?.kept, one.relation?.kept]).toEqual(["list", "one"]);
    const result = await collectTypeChange(
      list,
      one,
      stored('["p1","p2"]', '["p3"]', "[]")
    );
    expect(result.judgement.class).toBe("blocked");
    expect(
      result.judgement.reasons.find(r => r.kind === "several-items")?.rows
    ).toEqual({ first: [{ id: "1" }], count: 1 });
    // The one-link list read as its link is a new form no save writes yet, and the empty list is
    // stored as `[]`, which one link's column would keep as that text (`needs-rewrite`).
    expect(
      result.judgement.reasons.find(r => r.kind === "needs-rewrite")?.rows
    ).toEqual({ first: [{ id: "2" }, { id: "3" }], count: 2 });
    expect(result.counts).toMatchObject({ changed: 0, blocked: 3, kept: 0 });
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
