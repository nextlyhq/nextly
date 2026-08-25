import { describe, expect, it } from "vitest";

import {
  documentLabel,
  selectionKey,
  groupChoices,
} from "./RedirectPagePicker";

describe("selectionKey", () => {
  const many = ["pages", "posts"];

  it("reads the shape the picker itself writes", () => {
    expect(selectionKey({ relationTo: "posts", value: "p1" }, many)).toBe(
      "posts:p1"
    );
  });

  it("reads a value populated by a read at depth", () => {
    // A form saved and reloaded serves the row under `value`; showing the
    // control blank there would invite an author to re-pick what is already
    // set, and saving blank is a different document than the one stored.
    expect(
      selectionKey({ relationTo: "pages", value: { id: "pg1" } }, many)
    ).toBe("pages:pg1");
  });

  it("reads a bare id only when one collection is configured", () => {
    expect(selectionKey("pg1", ["pages"])).toBe("pages:pg1");
    expect(selectionKey("pg1", many)).toBeUndefined();
  });

  it("shows nothing for an unset or unreadable value", () => {
    for (const empty of [null, undefined, "", [], { relationTo: "pages" }]) {
      expect(selectionKey(empty, many)).toBeUndefined();
    }
  });
});

describe("documentLabel", () => {
  it("prefers the field an author would recognise", () => {
    expect(documentLabel({ id: "1", title: "About", slug: "about" })).toBe(
      "About"
    );
    expect(documentLabel({ id: "1", name: "Contact" })).toBe("Contact");
    expect(documentLabel({ id: "1", slug: "pricing" })).toBe("pricing");
  });

  it("skips a blank field rather than showing an empty row", () => {
    expect(documentLabel({ id: "1", title: "   ", slug: "about" })).toBe(
      "about"
    );
  });

  it("falls back to the id, then to a placeholder", () => {
    expect(documentLabel({ id: "pg1" })).toBe("pg1");
    expect(documentLabel({})).toBe("Untitled");
  });
});

describe("groupChoices", () => {
  const choice = (collection: string, id: string) => ({
    collection,
    id,
    label: id,
  });

  it("orders groups by configuration", () => {
    const groups = groupChoices(
      [choice("posts", "p1"), choice("pages", "g1")],
      ["pages", "posts"]
    );
    expect(groups.map(g => g.collection)).toEqual(["pages", "posts"]);
    expect(groups.every(g => !g.removed)).toBe(true);
  });

  it("keeps a collection that is no longer configured, marked and last", () => {
    // The case that made the control blank: a stored target is recovered by
    // id, and filtering the render by configuration dropped it — over a value
    // that is still saved, with the unreadable warning cleared because the
    // recovery had succeeded.
    const groups = groupChoices(
      [choice("pages", "g1"), choice("retired", "r1")],
      ["pages", "posts"]
    );
    expect(groups.map(g => g.collection)).toEqual(["pages", "retired"]);
    expect(groups[1].removed).toBe(true);
    expect(groups[1].label).toContain("no longer configured");
  });

  it("keeps the stored target when NO collection is configured", () => {
    // The zero-config case specifically. The previous test kept another
    // configured collection, so it exercised the grouping but never this — and
    // this is the state where the picker is the only thing that can tell an
    // author which page is still saved.
    const groups = groupChoices([choice("retired", "r1")], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].collection).toBe("retired");
    expect(groups[0].removed).toBe(true);
    expect(groups[0].choices).toHaveLength(1);
  });

  it("does not invent a group for a configured collection with no choices", () => {
    expect(
      groupChoices([choice("pages", "g1")], ["pages", "posts"]).map(
        g => g.collection
      )
    ).toEqual(["pages"]);
  });

  it("puts every choice in exactly one group", () => {
    const choices = [
      choice("pages", "a"),
      choice("pages", "b"),
      choice("x", "c"),
    ];
    const groups = groupChoices(choices, ["pages"]);
    expect(groups.flatMap(g => g.choices)).toHaveLength(choices.length);
  });
});
