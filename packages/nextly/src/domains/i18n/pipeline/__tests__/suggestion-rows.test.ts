/**
 * Suggested translations follow what they belong to: a renamed field's are found by the key of
 * their new address, a removed row's go with the row and with no other, and two kept for one text
 * under two spellings of a language become the newer one.
 *
 * Run against rows held in memory, which answer the conditions each function sends, so a test sees
 * which rows a change leaves and not only that it was asked for.
 */
import type {
  WhereClause,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it, vi } from "vitest";

import { TRANSLATION_SUGGESTIONS_TABLE } from "../../../../schemas/translation-suggestions";
import {
  convertSuggestionCodes,
  forgetDocumentSuggestions,
  forgetFieldSuggestions,
  forgetRemovedRowsSuggestions,
  newerSuggestion,
  renameFieldSuggestions,
  renameFieldSuggestionsStatements,
  type SuggestionRowsDb,
} from "../suggestion-rows";
import { fieldUnit, unitKey, type UnitAddress } from "../unit-address";

interface Row {
  id: string;
  scopeKind: string;
  scopeSlug: string;
  entryId: string;
  targetLocale: string;
  sourceLocale: string;
  fieldPath: string;
  unitKey: string;
  unitAddress: unknown;
  createdAt: Date;
}

/** One suggestion for the text at `address`, in Spanish from English unless it says otherwise. */
function row(id: string, address: UnitAddress, over: Partial<Row> = {}): Row {
  return {
    id,
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    targetLocale: "es",
    sourceLocale: "en",
    fieldPath: address[0].field,
    unitKey: unitKey(address),
    unitAddress: address,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    ...over,
  };
}

/** Whether a stored value is the one asked for, as a database compares the two. */
type SameValue = (stored: unknown, asked: unknown) => boolean;

/** Compared as MySQL does by its default rule: text without regard to case. */
const ignoringCase: SameValue = (stored, asked) =>
  typeof stored === "string" && typeof asked === "string"
    ? stored.toLowerCase() === asked.toLowerCase()
    : stored === asked;

/** Rows in memory, read and written by `=` and `IN` conditions, every one of which must hold. */
function memory(...held: Row[]): SuggestionRowsDb & { rows: Row[] } {
  return memoryComparing((stored, asked) => stored === asked, held);
}

/** {@link memory} under a database's own comparison. */
function memoryComparing(
  same: SameValue,
  held: Row[]
): SuggestionRowsDb & { rows: Row[] } {
  const db = { rows: held };
  const matches = (candidate: Row, where: WhereClause | undefined) =>
    (where?.and ?? []).every(each => {
      const { column, op, value } = each as WhereCondition;
      const own = candidate[column as keyof Row];
      if (op === "=") return same(own, value);
      if (op === "IN" && Array.isArray(value)) {
        return value.some(one => same(own, one));
      }
      throw new Error(`unanswered condition: ${op}`);
    });
  const asked = (table: string) =>
    expect(table).toBe(TRANSLATION_SUGGESTIONS_TABLE);
  return Object.assign(db, {
    select: async <T>(table: string, options?: { where?: WhereClause }) => {
      asked(table);
      return db.rows
        .filter(each => matches(each, options?.where))
        .map(each => ({ ...each })) as T[];
    },
    updateCount: async (
      table: string,
      data: Record<string, unknown>,
      where: WhereClause
    ) => {
      asked(table);
      const found = db.rows.filter(each => matches(each, where));
      for (const each of found) Object.assign(each, data);
      return found.length;
    },
    delete: async (table: string, where: WhereClause) => {
      asked(table);
      const before = db.rows.length;
      db.rows = db.rows.filter(each => !matches(each, where));
      return before - db.rows.length;
    },
  });
}

const SCOPE = { scopeKind: "collection" as const, scopeSlug: "posts" };
const DOCUMENT = { ...SCOPE, entryId: "e1" };

/** Each row left, by its id and what it is kept under. */
const keptUnder = (db: { rows: Row[] }) =>
  Object.fromEntries(
    db.rows.map(each => [
      each.id,
      [each.fieldPath, each.unitKey, each.unitAddress],
    ])
  );

describe("a renamed field's suggestions", () => {
  const rename = { ...SCOPE, from: "heading", to: "title2" };
  const caption = (field: string): UnitAddress => [
    { field },
    { row: "r1" },
    { field: "caption" },
  ];

  it("are kept under the key and address of the renamed field's texts, at any depth", async () => {
    const db = memory(
      row("own", fieldUnit("heading")),
      row("inside", caption("heading"))
    );

    await renameFieldSuggestions(db, rename);

    expect(keptUnder(db)).toEqual({
      own: ["title2", unitKey(fieldUnit("title2")), fieldUnit("title2")],
      inside: ["title2", unitKey(caption("title2")), caption("title2")],
    });
  });

  it("move alone: another field's, entity's or kind's stay as they were", async () => {
    const others = [
      row("field", fieldUnit("summary")),
      row("entity", fieldUnit("heading"), { scopeSlug: "pages" }),
      row("kind", fieldUnit("heading"), { scopeKind: "single" }),
    ];
    const before = keptUnder({ rows: others });
    const db = memory(...others.map(each => ({ ...each })));

    await renameFieldSuggestions(db, rename);

    expect(keptUnder(db)).toEqual(before);
  });

  it("take the place of what an earlier field left under the new name", async () => {
    const db = memory(
      row("stale", fieldUnit("title2")),
      row("moved", fieldUnit("heading"))
    );

    await renameFieldSuggestions(db, rename);

    expect(Object.keys(keptUnder(db))).toEqual(["moved"]);
  });

  it("stay once moved: a second move changes nothing", async () => {
    const db = memory(row("own", fieldUnit("heading")));
    await renameFieldSuggestions(db, rename);
    const moved = keptUnder(db);

    await renameFieldSuggestions(db, rename);

    expect(keptUnder(db)).toEqual(moved);
  });

  it("go where their address names no text of the field", async () => {
    const db = memory(
      row("unreadable", fieldUnit("heading"), { unitAddress: [{ row: "r1" }] }),
      row("elsewhere", fieldUnit("summary"), { fieldPath: "heading" }),
      row("own", fieldUnit("heading"))
    );

    await renameFieldSuggestions(db, rename);

    expect(Object.keys(keptUnder(db))).toEqual(["own"]);
  });

  it.each([
    [
      "postgresql" as const,
      `DELETE FROM "nextly_translation_suggestions" WHERE "scope_kind" = 'collection' AND "scope_slug" = 'posts' AND "field_path" = 'heading';`,
    ],
    [
      "sqlite" as const,
      `DELETE FROM "nextly_translation_suggestions" WHERE "scope_kind" = 'collection' AND "scope_slug" = 'posts' AND "field_path" = 'heading';`,
    ],
    [
      "mysql" as const,
      "DELETE FROM `nextly_translation_suggestions` WHERE `scope_kind` = 'collection' AND `scope_slug` = 'posts' AND `field_path` = 'heading';",
    ],
  ])("are removed by the statement given for %s", (dialect, statement) => {
    expect(renameFieldSuggestionsStatements(dialect, rename)).toEqual([
      statement,
    ]);
  });
});

describe("a removed field's suggestions", () => {
  it("go, and no other field's or entity's", async () => {
    const db = memory(
      row("gone", fieldUnit("heading")),
      row("field", fieldUnit("summary")),
      row("entity", fieldUnit("heading"), { scopeSlug: "pages" })
    );

    await forgetFieldSuggestions(db, SCOPE, ["heading"]);

    expect(Object.keys(keptUnder(db))).toEqual(["field", "entity"]);
  });

  it("stay where no field is removed", async () => {
    const db = memory(row("kept", fieldUnit("heading")));
    await forgetFieldSuggestions(db, SCOPE, []);
    expect(Object.keys(keptUnder(db))).toEqual(["kept"]);
  });
});

describe("a removed row's suggestions", () => {
  const inRow = (id: string): UnitAddress => [
    { field: "sections" },
    { row: id },
    { field: "caption" },
  ];
  const inPoint = (section: string, point: string): UnitAddress => [
    { field: "sections" },
    { row: section },
    { field: "points" },
    { row: point },
    { field: "text" },
  ];
  const written = (structure: unknown) => [{ field: "sections", structure }];

  /** The ids left once `structure` is written over a document holding `rows`. */
  async function leftAfter(
    structure: unknown,
    ...rows: Row[]
  ): Promise<string[]> {
    const db = memory(...rows);
    await forgetRemovedRowsSuggestions(db, DOCUMENT, written(structure));
    return db.rows.map(each => each.id);
  }

  it("go in every language, and a row moved within its list keeps its own", async () => {
    expect(
      await leftAfter(
        [{ id: "r3" }, { id: "r1" }],
        row("first", inRow("r1")),
        row("second", inRow("r2")),
        row("second-fr", inRow("r2"), { targetLocale: "fr" }),
        row("third", inRow("r3"))
      )
    ).toEqual(["first", "third"]);
  });

  it("go from a list inside a row that stays", async () => {
    expect(
      await leftAfter(
        [{ id: "r1", points: [{ id: "p1" }] }],
        row("caption", inRow("r1")),
        row("kept", inPoint("r1", "p1")),
        row("gone", inPoint("r1", "p2")),
        row("gone-with-its-row", inPoint("r2", "p1"))
      )
    ).toEqual(["caption", "kept"]);
  });

  it.each<[string, unknown]>([
    ["in its rows", { sections: [{ id: "r2" }] }],
    ["in one language's text of them", { sections: { r2: { caption: "x" } } }],
    ["as JSON text", JSON.stringify({ sections: [{ id: "r2" }] })],
  ])("stay with a row a held draft holds %s", async (_how, snapshot) => {
    const db = memory(row("held", inRow("r2")), row("gone", inRow("r3")));
    const drafts = async () => [{ snapshot: {} }, { snapshot }];

    await forgetRemovedRowsSuggestions(
      db,
      DOCUMENT,
      written([{ id: "r1" }]),
      drafts
    );

    expect(db.rows.map(each => each.id)).toEqual(["held"]);
  });

  it("ask for no held draft where no row went", async () => {
    const db = memory(row("kept", inRow("r1")));
    const drafts = vi.fn(async () => []);

    await forgetRemovedRowsSuggestions(
      db,
      DOCUMENT,
      written([{ id: "r1" }]),
      drafts
    );

    expect(drafts).not.toHaveBeenCalled();
  });

  it("go from a list inside a group", async () => {
    const link = (id: string): UnitAddress => [
      { field: "footer" },
      { field: "links" },
      { row: id },
      { field: "label" },
    ];
    const db = memory(row("kept", link("l1")), row("gone", link("l2")));

    await forgetRemovedRowsSuggestions(db, DOCUMENT, [
      { field: "footer", structure: { links: [{ id: "l1" }] } },
    ]);

    expect(db.rows.map(each => each.id)).toEqual(["kept"]);
  });

  it.each<[string, unknown]>([
    ["an emptied list", []],
    ["a cleared list", null],
    ["JSON text of one", "[]"],
  ])("all go with %s", async (_what, structure) => {
    expect(await leftAfter(structure, row("gone", inRow("r1")))).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["the structure does not hold the list", [{ id: "r1" }]],
    ["the structure is text that can't be read", "[{"],
  ])("stay where %s", async (_what, structure) => {
    expect(
      await leftAfter(structure, row("kept", inPoint("r1", "p1")))
    ).toEqual(["kept"]);
  });

  it("stay in a field the write did not touch, and in another document", async () => {
    const elsewhere: UnitAddress = [
      { field: "gallery" },
      { row: "r1" },
      { field: "caption" },
    ];
    expect(
      await leftAfter(
        [],
        row("field", elsewhere),
        row("document", inRow("r1"), { entryId: "e2" }),
        row("field-itself", fieldUnit("sections"))
      )
    ).toEqual(["field", "document", "field-itself"]);
  });
});

describe("a deleted document's suggestions", () => {
  const adapterWith = (present: boolean) => ({
    tableExists: vi.fn(async () => present),
    tableExistsThrough: vi.fn(async () => present),
  });

  it("go, and no other document's", async () => {
    const db = memory(
      row("gone", fieldUnit("heading")),
      row("gone-fr", fieldUnit("heading"), { targetLocale: "fr" }),
      row("document", fieldUnit("heading"), { entryId: "e2" }),
      row("entity", fieldUnit("heading"), { scopeSlug: "pages" })
    );

    await forgetDocumentSuggestions(
      { adapter: adapterWith(true) },
      db as never,
      DOCUMENT
    );

    expect(db.rows.map(each => each.id)).toEqual(["document", "entity"]);
  });

  it("are asked for on the delete's own connection, and nothing is deleted before the table is there", async () => {
    // Asked on the pool, the probe would wait for the connection the delete holds; a statement
    // against the missing table would end a PostgreSQL transaction, the delete with it.
    const adapter = adapterWith(false);
    const tx = { delete: vi.fn() };

    await forgetDocumentSuggestions({ adapter }, tx as never, DOCUMENT);

    expect(adapter.tableExistsThrough).toHaveBeenCalledWith(
      tx,
      TRANSLATION_SUGGESTIONS_TABLE
    );
    expect(adapter.tableExists).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });
});

describe("the newer of two suggestions for one text", () => {
  const at = (id: string, time: string) => ({
    id,
    createdAt: new Date(`2026-08-01T${time}Z`),
  });

  it("is the one made later, whichever comes first and whatever its id", () => {
    const older = at("z", "10:00:00");
    const newer = at("a", "10:00:01");
    expect(newerSuggestion(older, newer)).toBe(newer);
    expect(newerSuggestion(newer, older)).toBe(newer);
  });

  it("is the one with the greater id where both were made at once", () => {
    const one = at("a", "10:00:00");
    const other = at("b", "10:00:00");
    expect(newerSuggestion(one, other)).toBe(other);
    expect(newerSuggestion(other, one)).toBe(other);
  });
});

describe("suggestions under a language code written the earlier way", () => {
  const CONVERSION = { from: "pt_BR", to: "pt-BR" };
  const early = new Date("2026-08-01T10:00:00Z");
  const late = new Date("2026-08-02T10:00:00Z");
  const languages = (db: { rows: Row[] }) =>
    Object.fromEntries(
      db.rows.map(each => [each.id, [each.targetLocale, each.sourceLocale]])
    );

  it("move by the language they are in and by the one they were made from", async () => {
    const db = memory(
      row("target", fieldUnit("heading"), { targetLocale: "pt_BR" }),
      row("source", fieldUnit("heading"), { sourceLocale: "pt_BR" }),
      row("neither", fieldUnit("summary"))
    );

    await convertSuggestionCodes(db, CONVERSION);

    expect(languages(db)).toEqual({
      target: ["pt-BR", "en"],
      source: ["es", "pt-BR"],
      neither: ["es", "en"],
    });
  });

  it.each([
    ["the older spelling's", late, early, "older"],
    ["the standard code's", early, late, "standard"],
  ])(
    "become one where a text has two, %s kept when it is the newer",
    async (_whose, older, standard, kept) => {
      const db = memory(
        row("older", fieldUnit("heading"), {
          targetLocale: "pt_BR",
          createdAt: older,
        }),
        row("standard", fieldUnit("heading"), {
          targetLocale: "pt-BR",
          createdAt: standard,
        })
      );

      await convertSuggestionCodes(db, CONVERSION);

      expect(languages(db)).toEqual({ [kept]: ["pt-BR", "en"] });
    }
  );

  it("are kept where the codes differ only by case and the database compares without it", async () => {
    const db = memoryComparing(ignoringCase, [
      row("target", fieldUnit("heading"), { targetLocale: "pt-br" }),
      row("source", fieldUnit("summary"), { sourceLocale: "pt-br" }),
    ]);

    await convertSuggestionCodes(db, { from: "pt-br", to: "pt-BR" });

    expect(languages(db)).toEqual({
      target: ["pt-BR", "en"],
      source: ["es", "pt-BR"],
    });
  });

  it("stay two where they are of two texts or two documents", async () => {
    const db = memory(
      row("older", fieldUnit("heading"), { targetLocale: "pt_BR" }),
      row("text", fieldUnit("summary"), { targetLocale: "pt-BR" }),
      row("document", fieldUnit("heading"), {
        targetLocale: "pt-BR",
        entryId: "e2",
      })
    );

    await convertSuggestionCodes(db, CONVERSION);

    expect(Object.keys(languages(db)).sort()).toEqual([
      "document",
      "older",
      "text",
    ]);
  });
});
