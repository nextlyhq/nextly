/**
 * A custom source's inputs as the inspector reads and writes them: what an
 * empty input means, which inputs the note names, whether a draft can be
 * written, and the one write that makes it a list's whole source.
 */
import {
  defineNamedQuery,
  namedQueryDeclaration,
  param,
  readListQuery,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  emptyWords,
  inputsNote,
  judgedDraft,
  marksNeeded,
  namedSourceChanges,
  needsInput,
  sourceSearchText,
  withInput,
} from "./named-query-model";

const upcoming = namedQueryDeclaration(
  defineNamedQuery({
    name: "events.upcoming",
    label: "Upcoming events",
    description: "Events from today on, soonest first.",
    params: {
      city: param.choice({
        label: "City",
        required: true,
        options: [{ value: "lahore", label: "Lahore" }],
      }),
      keyword: param.text({ label: "Keyword", placeholder: "Any words" }),
      from: param.day({ label: "From", default: "today" }),
      within: param.number({ label: "Within", unit: "days", default: 30 }),
      venue: param.entry({ label: "Venue", collection: "venues" }),
    },
    reads: { collections: ["events", "venues"] },
    rows: { key: "id", fields: [{ name: "id", type: "text" }] },
    run: () => Promise.resolve({ rows: [] }),
  })
);

describe("what an empty input shows", () => {
  it("is what empty means: a prompt where it is needed, its default, or that it narrows nothing", () => {
    const words = Object.fromEntries(
      Object.entries(upcoming.params ?? {}).map(([key, each]) => [
        key,
        emptyWords(each),
      ])
    );
    expect(words).toEqual({
      city: "Choose a city",
      keyword: "Any words",
      from: "Today",
      within: "30",
      venue: "Any venue",
    });
  });
});

describe("the Inputs group's note", () => {
  it("names the input the query needs, and waits while it is empty", () => {
    expect(inputsNote(upcoming, [])).toBe(
      "Upcoming events needs a city. The rest are optional."
    );
    const { problems } = judgedDraft(upcoming, {});
    expect(inputsNote(upcoming, problems)).toBe(
      "Upcoming events needs a city. Nothing on the page changes until one is chosen."
    );
    expect(marksNeeded(upcoming)).toBe(false);
    expect(needsInput(upcoming)).toBe(true);
  });
});

describe("a draft of the inputs", () => {
  it("can be written once the query can run, and not before", () => {
    expect(judgedDraft(upcoming, {}).writable).toBe(false);
    const set = withInput({}, "city", "lahore");
    expect(judgedDraft(upcoming, set).writable).toBe(true);
    // A value the query does not take is refused as the save refuses it.
    expect(
      judgedDraft(upcoming, withInput(set, "within", "soon")).writable
    ).toBe(false);
  });

  it("leaves an emptied input out rather than storing it empty", () => {
    expect(
      withInput({ city: "lahore", keyword: "jazz" }, "keyword", undefined)
    ).toEqual({ city: "lahore" });
    expect(withInput({ city: "lahore" }, "city", undefined)).toEqual({});
  });

  it("stores a choice's empty value, which is one of its options, not an emptied input", () => {
    const blank = namedQueryDeclaration(
      defineNamedQuery({
        name: "events.by-tier",
        label: "Events by tier",
        params: {
          tier: param.choice({
            label: "Tier",
            required: true,
            options: [
              { value: "", label: "Untiered" },
              { value: "gold", label: "Gold" },
            ],
          }),
        },
        reads: { collections: ["events"] },
        rows: { key: "id", fields: [{ name: "id", type: "text" }] },
        run: () => Promise.resolve({ rows: [] }),
      })
    );
    const set = withInput({}, "tier", "");
    expect(set).toEqual({ tier: "" });
    // The required choice is set, so the source can be written.
    expect(judgedDraft(blank, set).writable).toBe(true);
  });
});

describe("the write that makes a custom source the list's source", () => {
  it("is the whole source, read back by the engine with nothing beside it", () => {
    const changes = namedSourceChanges("events.upcoming", { city: "lahore" });
    const stored = Object.fromEntries(
      Object.entries({
        collection: "posts",
        filters: [{ field: "title", op: "equals", value: "a" }],
        sort: "-title",
        paginate: true,
        limit: 6,
        ...changes,
      }).filter(([, value]) => value !== undefined)
    );
    const read = readListQuery(stored);
    // A custom source beside a collection, filters or sort is refused; the
    // write removes them in the same edit, so the engine finds no conflict.
    expect(read.problems).toEqual([]);
    expect(read.query.namedQuery).toEqual({
      name: "events.upcoming",
      params: { city: "lahore" },
    });
    expect(read.query.collection).toBeUndefined();
    // Pages go with the collection: a custom source's list is not split.
    expect(stored).not.toHaveProperty("paginate");
    expect(read.query.limit).toBe(6);
  });

  it("stores no inputs for a query given none", () => {
    expect(namedSourceChanges("posts.most-read", {}).namedQuery).toEqual({
      name: "posts.most-read",
    });
  });
});

describe("what the Source menu's search matches", () => {
  it("is a source's name and its line", () => {
    expect(sourceSearchText(upcoming)).toBe(
      "Upcoming events Events from today on, soonest first."
    );
  });
});
