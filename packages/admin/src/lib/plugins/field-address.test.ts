/**
 * A field's address through a repeater's row, resolved against the document's
 * fields and values: the row is named by its saved id, found wherever it now
 * stands, and an address whose row is not there opens nothing — never the row
 * that now stands where it stood.
 */
import { describe, expect, it } from "vitest";

import {
  resolveViewField,
  rowFieldAddress,
  viewFieldCandidates,
  viewFieldPathIn,
} from "./document-view-registry";
import { resolveAddress } from "./field-address";

const body = { name: "body", label: "Body", type: "blocks" };

/** A `sections` repeater whose rows hold a heading and a blocks field. */
const sections = {
  name: "sections",
  label: "Sections",
  type: "repeater",
  labels: { singular: "Section", plural: "Sections" },
  fields: [{ name: "heading", type: "text" }, body],
};

const fields = [{ name: "title", type: "text" }, sections];

/** Three saved rows, in their stored order. */
const rows = [
  { id: "row-a", heading: "Intro", body: { kind: "page", nodes: ["a"] } },
  { id: "row-b", heading: "Hero banner", body: { kind: "page", nodes: ["b"] } },
  { id: "row-c", heading: "", body: { kind: "page", nodes: ["c"] } },
];

const saved = { sections: rows };

describe("an address through a repeater's row", () => {
  it("opens the row it names by id, at that row's place in the form", () => {
    const opened = resolveViewField(
      "blocks",
      fields,
      "sections.row-b.body",
      undefined,
      {
        current: saved,
        saved,
      }
    );

    expect(opened).toMatchObject({
      kind: "field",
      // The address stays the row's id; the form path is its position now.
      name: "sections.row-b.body",
      formPath: "sections.1.body",
      declaration: body,
      // A condition inside the row reads beside that row, as the form does.
      bases: ["", "sections.1"],
      // The row is named by its title, as the form's own row header names it.
      location: "Sections · Hero banner · Body",
    });
  });

  it("stays on the same row after the rows are reordered", () => {
    // `row-b` dragged to the top: the row at position 1 is now `row-a`, and
    // the address opens `row-b` at its new place, never `row-a`.
    const reordered = { sections: [rows[1], rows[0], rows[2]] };
    const opened = resolveViewField(
      "blocks",
      fields,
      "sections.row-b.body",
      undefined,
      {
        current: reordered,
        saved,
      }
    );

    expect(opened).toMatchObject({
      kind: "field",
      name: "sections.row-b.body",
      formPath: "sections.0.body",
      location: "Sections · Hero banner · Body",
    });
  });

  it("is refused when its row is gone, and never opens another row", () => {
    // `row-b` removed: two rows remain, and the one now at position 1 is
    // `row-c`. The address opens nothing, and is not corrected to a field.
    const removed = { sections: [rows[0], rows[2]] };

    expect(
      resolveViewField("blocks", fields, "sections.row-b.body", undefined, {
        current: removed,
        saved,
      })
    ).toEqual({ kind: "refused", reason: "rowGone" });
  });

  it("is refused when it names a row by its position", () => {
    // `sections.1.body` would open whichever row stands second, which after a
    // reorder is another row's page.
    expect(
      resolveViewField("blocks", fields, "sections.1.body", undefined, {
        current: saved,
        saved,
      })
    ).toEqual({ kind: "refused", reason: "position" });
  });

  it("does not open a field in the row that is not of the view's type", () => {
    // `heading` is text: the address names no blocks field, so the view asks
    // rather than opening a row's other field or another row.
    const asked = resolveViewField(
      "blocks",
      fields,
      "sections.row-b.heading",
      undefined,
      {
        current: saved,
        saved,
      }
    );

    expect(asked.kind).toBe("choose");
  });

  it("is refused in a repeater whose rows declare their own id", () => {
    // Such rows get no saved id, so an id in the address is the author's own
    // value and names no row reliably.
    const ownIds = [
      {
        name: "slides",
        type: "repeater",
        fields: [{ name: "id", type: "text" }, body],
      },
    ];

    expect(
      resolveViewField("blocks", ownIds, "slides.s1.body", undefined, {
        current: { slides: [{ id: "s1", body: null }] },
        saved: { slides: [{ id: "s1", body: null }] },
      })
    ).toEqual({ kind: "refused", reason: "ownIds" });
  });

  it("reaches a group inside a row", () => {
    const grouped = [
      {
        name: "sections",
        type: "repeater",
        fields: [
          { name: "hero", label: "Hero", type: "group", fields: [body] },
        ],
      },
    ];
    const values = {
      sections: [
        { id: "r1", hero: { body: null } },
        { id: "r2", hero: { body: null } },
      ],
    };

    expect(
      resolveViewField("blocks", grouped, "sections.r2.hero.body", undefined, {
        current: values,
        saved: values,
      })
    ).toMatchObject({
      kind: "field",
      formPath: "sections.1.hero.body",
      bases: ["", "sections.1", "sections.1.hero"],
      // No title in the row: its place, as its header falls back to it.
      location: "Sections · Item 2 · Hero · Body",
    });
  });

  it("reaches a row inside a group, and a row inside a row", () => {
    const nested = [
      {
        name: "page",
        type: "group",
        fields: [
          {
            name: "columns",
            type: "repeater",
            fields: [
              {
                name: "cells",
                type: "repeater",
                fields: [body],
              },
            ],
          },
        ],
      },
    ];
    const values = {
      page: {
        columns: [
          { id: "c1", cells: [{ id: "x", body: null }] },
          {
            id: "c2",
            cells: [
              { id: "y", body: null },
              { id: "z", body: null },
            ],
          },
        ],
      },
    };

    expect(
      resolveViewField(
        "blocks",
        nested,
        "page.columns.c2.cells.z.body",
        undefined,
        { current: values, saved: values }
      )
    ).toMatchObject({
      kind: "field",
      formPath: "page.columns.1.cells.1.body",
    });
    // The inner row is looked for in its own row only: `x` is in `c1`.
    expect(
      resolveViewField(
        "blocks",
        nested,
        "page.columns.c2.cells.x.body",
        undefined,
        { current: values, saved: values }
      )
    ).toEqual({ kind: "refused", reason: "rowGone" });
  });

  it("never opens a row because it is the only field, with no address naming it", () => {
    // One saved row: the view asks rather than opening it unasked, so a stale
    // or missing address never lands on a row.
    const one = { sections: [rows[0]] };
    const asked = resolveViewField("blocks", fields, undefined, undefined, {
      current: one,
      saved: one,
    });

    expect(asked).toMatchObject({
      kind: "choose",
      candidates: [
        { name: "sections.row-a.body", formPath: "sections.0.body" },
      ],
    });
  });

  it("offers in the question only rows saved with their id", () => {
    // `row-new` was added in the form and never saved: a reload would not
    // find it, so it is not offered.
    const current = {
      sections: [...rows, { id: "row-new", heading: "Draft", body: null }],
    };

    expect(
      viewFieldCandidates("blocks", fields, { current, saved }).map(
        candidate => candidate.name
      )
    ).toEqual([
      "sections.row-a.body",
      "sections.row-b.body",
      "sections.row-c.body",
    ]);
  });
});

describe("where a write for a row's field goes", () => {
  it("finds the row by id in the values as they are when asked", () => {
    // Reordered since the editor opened: the write goes to `row-b`'s new
    // place, and the other rows' places are not touched.
    const reordered = { sections: [rows[2], rows[0], rows[1]] };

    expect(
      viewFieldPathIn("blocks", fields, "sections.row-b.body", reordered)
    ).toBe("sections.2.body");
  });

  it("answers nowhere once the row is gone, rather than another row", () => {
    const removed = { sections: [rows[0], rows[2]] };

    expect(
      viewFieldPathIn("blocks", fields, "sections.row-b.body", removed)
    ).toBeUndefined();
  });

  it("answers the path itself for a field outside rows", () => {
    expect(viewFieldPathIn("blocks", [body], "body", {})).toBe("body");
  });
});

describe("a field's address from its place in the form", () => {
  it("names the row by its saved id", () => {
    expect(rowFieldAddress(fields, "sections.1.body", saved, saved)).toEqual({
      kind: "address",
      address: "sections.row-b.body",
    });
  });

  it("follows the row after a reorder, by id", () => {
    // `row-b` now first: the field at position 0 is `row-b`'s.
    const reordered = { sections: [rows[1], rows[0], rows[2]] };

    expect(
      rowFieldAddress(fields, "sections.0.body", reordered, saved)
    ).toEqual({
      kind: "address",
      address: "sections.row-b.body",
    });
  });

  it("has none for a row not saved yet, with or without an id", () => {
    // A row the form added carries a fresh id that the stored document does
    // not have yet; a legacy row carries none.
    const current = {
      sections: [...rows, { id: "row-new", body: null }, { body: null }],
    };

    expect(rowFieldAddress(fields, "sections.3.body", current, saved)).toEqual({
      kind: "refused",
      reason: "unsavedRow",
    });
    expect(rowFieldAddress(fields, "sections.4.body", current, saved)).toEqual({
      kind: "refused",
      reason: "unsavedRow",
    });
  });

  it("has none in a repeater whose rows declare their own id", () => {
    const ownIds = [
      {
        name: "slides",
        type: "repeater",
        fields: [{ name: "id", type: "text" }, body],
      },
    ];
    const values = { slides: [{ id: "s1", body: null }] };

    expect(rowFieldAddress(ownIds, "slides.0.body", values, values)).toEqual({
      kind: "refused",
      reason: "ownIds",
    });
  });

  it("is no row's address for a path through no repeater", () => {
    expect(
      rowFieldAddress(
        [{ name: "hero", type: "group", fields: [body] }],
        "hero.body",
        {},
        {}
      )
    ).toBeUndefined();
  });
});

describe("resolveAddress", () => {
  it("never takes a row's position for its id", () => {
    // A row standing at position 0 whose id is not "0": the step "0" names no
    // row, and is said to be a position.
    expect(
      resolveAddress(
        [
          { kind: "name", name: "sections" },
          { kind: "row", repeater: sections },
          { kind: "name", name: "body" },
        ],
        "sections.0.body",
        saved
      )
    ).toEqual({ kind: "refused", reason: "position" });
  });
});
