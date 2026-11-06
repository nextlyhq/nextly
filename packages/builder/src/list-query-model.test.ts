/**
 * A collection list's query as its inspector words and writes it: the
 * operators offered per kind of field, a sort's direction in words, a filter
 * as one sentence, when a row is complete enough to store, and the bounds of
 * how many entries show.
 */
import {
  LIST_FIELD_KINDS,
  LIST_KIND_OPS,
  readListQuery,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  completedFilter,
  dayWords,
  directionWords,
  filterLine,
  filterSentence,
  firstDirection,
  movedKey,
  OPERATORS,
  readBound,
  sortValue,
  valueFor,
  withFilter,
  type QueryField,
} from "./list-query-model";

const TITLE: QueryField = { name: "title", label: "Title", kind: "text" };
const PUBLISHED: QueryField = {
  name: "publishedAt",
  label: "Published date",
  kind: "date",
};
const CATEGORY: QueryField = {
  name: "category",
  label: "Category",
  kind: "choice",
  options: [
    { value: "news", label: "News" },
    { value: "guides", label: "Guides" },
    { value: "notes", label: "Notes" },
    { value: "events", label: "Events" },
  ],
};
const AUTHOR: QueryField = {
  name: "author",
  label: "Author",
  kind: "entry",
  relationTo: "authors",
};

/** The operators offered for a kind, by what they are called. */
const offered = (kind: QueryField["kind"]) =>
  OPERATORS[kind].map(choice => choice.label);

describe("the operators offered for a field", () => {
  it("offers each kind its own, in menu order", () => {
    expect(offered("text")).toEqual([
      "is",
      "is not",
      "contains",
      "is any of",
      "is none of",
      "has a value",
      "is empty",
    ]);
    expect(offered("date")).toEqual([
      "is after",
      "is on or after",
      "is before",
      "is on or before",
      "has a value",
      "is empty",
    ]);
    expect(offered("number")).toEqual([
      "is",
      "is not",
      "is more than",
      "is at least",
      "is less than",
      "is at most",
      "has a value",
      "is empty",
    ]);
    expect(offered("boolean")).toEqual(["is"]);
  });

  it("never offers contains but on text, nor an order on text", () => {
    for (const kind of [
      "number",
      "date",
      "choice",
      "boolean",
      "entry",
    ] as const) {
      expect(OPERATORS[kind].some(choice => choice.op === "contains")).toBe(
        false
      );
    }
    expect(
      OPERATORS.text.some(choice =>
        [
          "greater_than",
          "greater_than_equal",
          "less_than",
          "less_than_equal",
        ].includes(choice.op)
      )
    ).toBe(false);
  });

  it("offers exactly the operators the engine's judgement takes, for each kind", () => {
    for (const kind of LIST_FIELD_KINDS) {
      expect([...new Set(OPERATORS[kind].map(choice => choice.op))]).toEqual(
        LIST_KIND_OPS[kind]
      );
    }
  });
});

describe("a sort's direction, in words", () => {
  it("is said for the kind of field it orders", () => {
    expect(directionWords("date")).toEqual({
      ascending: "Oldest first",
      descending: "Newest first",
    });
    expect(directionWords("text")).toEqual({
      ascending: "A–Z",
      descending: "Z–A",
    });
    expect(directionWords("number")).toEqual({
      ascending: "Lowest first",
      descending: "Highest first",
    });
    expect(directionWords(undefined)).toEqual({
      ascending: "Ascending",
      descending: "Descending",
    });
  });

  it("starts newest first for a date, and ascending otherwise", () => {
    expect(firstDirection("date")).toBe(true);
    expect(firstDirection("text")).toBe(false);
  });
});

describe("a filter as one sentence", () => {
  it("reads a choice list by its names, cut short after two", () => {
    const two = filterSentence(
      { field: "category", op: "in", value: ["news", "guides"] },
      CATEGORY
    );
    expect(filterLine(two)).toBe("Category is any of News, Guides");
    const four = filterSentence(
      {
        field: "category",
        op: "in",
        value: ["news", "guides", "notes", "events"],
      },
      CATEGORY
    );
    expect(four.value).toBe("News, Guides and 2 more");
  });

  it("reads text quoted, a day as an author writes it and an entry by its title", () => {
    expect(
      filterLine(
        filterSentence(
          { field: "title", op: "contains", value: "build" },
          TITLE
        )
      )
    ).toBe("Title contains “build”");
    expect(
      filterLine(
        filterSentence(
          {
            field: "publishedAt",
            op: "greater_than_equal",
            value: "2026-09-01",
          },
          PUBLISHED
        )
      )
    ).toBe("Published date is on or after 1 Sept 2026");
    expect(
      filterLine(
        filterSentence(
          { field: "author", op: "equals", value: "a1" },
          AUTHOR,
          id => (id === "a1" ? "Ada Okafor" : undefined)
        )
      )
    ).toBe("Author is Ada Okafor");
  });

  it("reads has a value and is empty with no value, and a missing value as such", () => {
    expect(
      filterLine(
        filterSentence({ field: "title", op: "exists", value: false }, TITLE)
      )
    ).toBe("Title is empty");
    expect(filterSentence({ field: "title", op: "equals" }, TITLE).value).toBe(
      "no value"
    );
  });

  it("names a field the collection no longer has as removed", () => {
    expect(
      filterSentence(
        { field: "readingTime", op: "less_than_equal", value: 5 },
        undefined
      ).field
    ).toBe("readingTime (removed)");
  });

  it("writes a day as the stored day, whatever the time zone", () => {
    expect(dayWords("2026-01-31")).toBe("31 Jan 2026");
  });
});

describe("when a row can be stored", () => {
  it("is complete once its field, operator and value make a row the engine reads", () => {
    expect(
      completedFilter({ field: "title", op: "contains", value: "build" }, TITLE)
    ).toEqual({ filter: { field: "title", op: "contains", value: "build" } });
  });

  it("says what is missing, by the field's kind", () => {
    expect(completedFilter({ field: "author", op: "equals" }, AUTHOR)).toEqual({
      missing: "Choose an entry for Author, or remove this filter.",
    });
    expect(
      completedFilter({ field: "title", op: "in", value: [] }, TITLE)
    ).toEqual({
      missing: "Choose a value for Title, or remove this filter.",
    });
    expect(completedFilter({}, undefined)).toEqual({
      missing: "Choose a field, or remove this filter.",
    });
  });

  it("keeps the value an operator change can keep", () => {
    const anyOf = OPERATORS.text.find(choice => choice.op === "in");
    const is = OPERATORS.text.find(choice => choice.op === "equals");
    const exists = OPERATORS.text.find(choice => choice.key === "exists:false");
    if (anyOf === undefined || is === undefined || exists === undefined) {
      throw new Error("operators missing");
    }
    expect(valueFor("text", anyOf, "build")).toEqual(["build"]);
    expect(valueFor("text", is, ["build", "ship"])).toBe("build");
    expect(valueFor("text", exists, "build")).toBe(false);
  });
});

describe("the edits a row and a key make", () => {
  const rows = [
    { field: "title", op: "contains" as const, value: "a" },
    { field: "kind", op: "equals" as const, value: "b" },
  ];

  it("replaces, adds and removes a row, and stores no filters for none", () => {
    const next = { field: "views", op: "greater_than" as const, value: 3 };
    expect(withFilter(rows, 1, next)).toEqual([rows[0], next]);
    expect(withFilter(rows, 2, next)).toEqual([...rows, next]);
    expect(withFilter([rows[0] ?? next], 0, undefined)).toBeUndefined();
  });

  it("moves a key and writes the sort the engine reads back", () => {
    const keys = [
      { field: "publishedAt", descending: true },
      { field: "title", descending: false },
    ];
    const moved = movedKey(keys, 1, 0);
    expect(sortValue(moved)).toBe("title,-publishedAt");
    expect(readListQuery({ sort: sortValue(moved) }).query.sort).toEqual(moved);
    expect(movedKey(keys, 0, -1)).toEqual(keys);
    expect(sortValue([])).toBeUndefined();
  });
});

describe("how many entries show", () => {
  it("takes a whole number from 1 to 100, and says the bounds otherwise", () => {
    expect(readBound("limit", "6")).toEqual({ value: 6 });
    expect(readBound("limit", "101")).toEqual({
      problem: "Show between 1 and 100 entries.",
    });
    expect(readBound("limit", "2.5")).toEqual({
      problem: "Show between 1 and 100 entries.",
    });
    expect(readBound("limit", "")).toEqual({ value: undefined });
  });

  it("skips a whole number from 0", () => {
    expect(readBound("offset", "0")).toEqual({ value: 0 });
    expect(readBound("offset", "-1")).toEqual({
      problem: "Skip a whole number of entries, 0 or more.",
    });
  });
});
