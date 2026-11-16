/**
 * The ids a write gives repeater rows: kept where the writer sent one, and
 * otherwise kept from the stored row only where the match is unambiguous, so
 * an id never moves to another row.
 */
import { describe, expect, it } from "vitest";

import { NO_FIELD_GROUPS, type FieldGroupReach } from "../password-fields";
import {
  assignRepeaterRowIds,
  reachesRepeaterField,
} from "../repeater-row-ids";

/** A deterministic id maker, so a fresh id is told apart from a kept one. */
function counter(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

const LINES = [
  {
    name: "lines",
    type: "repeater",
    fields: [{ name: "label", type: "text" }],
  },
];

type Row = Record<string, unknown>;

function rowsOf(data: Record<string, unknown>, name = "lines"): Row[] {
  return data[name] as Row[];
}

describe("assignRepeaterRowIds", () => {
  it("keeps an id the writer sent", () => {
    const data = { lines: [{ id: "a", label: "x" }] };
    assignRepeaterRowIds(data, undefined, LINES, NO_FIELD_GROUPS, counter());
    expect(rowsOf(data)[0]?.id).toBe("a");
  });

  it("leaves an authored id field as it is, and gives its rows no system id", () => {
    // The schema declares `id` itself (through a layout container, too), so
    // the value is the author's: a number, a repeat or none stays so.
    const authored = [
      {
        name: "codes",
        type: "repeater",
        fields: [
          { type: "row", fields: [{ name: "id", type: "number" }] },
          {
            name: "lines",
            type: "repeater",
            fields: [{ name: "label", type: "text" }],
          },
        ],
      },
    ];
    const data = {
      codes: [
        { id: 7, lines: [{ label: "x" }] },
        { id: 7, lines: [] },
        { lines: [] },
      ],
    };
    assignRepeaterRowIds(data, undefined, authored, NO_FIELD_GROUPS, counter());
    const codes = rowsOf(data, "codes");
    expect(codes.map(row => row.id)).toEqual([7, 7, undefined]);
    // What a row holds is still given ids.
    expect((codes[0]?.lines as Row[])[0]?.id).toBe("new-1");
  });

  it("tells rows apart by an authored id inside a group, as by any value", () => {
    // Only the system's row ids are set aside: two rows told apart only by
    // a group's own `id` field are different rows, and swapping them gives
    // neither the other's stored id.
    const tagged = [
      {
        name: "lines",
        type: "repeater",
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [{ name: "id", type: "text" }],
          },
        ],
      },
    ];
    const stored = {
      lines: [
        { id: "a", meta: { id: "x" } },
        { id: "b", meta: { id: "y" } },
      ],
    };
    const data = { lines: [{ meta: { id: "y" } }, { meta: { id: "x" } }] };
    assignRepeaterRowIds(data, stored, tagged, NO_FIELD_GROUPS, counter());
    expect(rowsOf(data).map(row => row.id)).toEqual(["new-1", "new-2"]);
    // Unswapped, each keeps its own.
    const same = { lines: [{ meta: { id: "x" } }, { meta: { id: "y" } }] };
    assignRepeaterRowIds(same, stored, tagged, NO_FIELD_GROUPS, counter());
    expect(rowsOf(same).map(row => row.id)).toEqual(["a", "b"]);
  });

  it("gives a fresh id to every row without one on a create", () => {
    const data = { lines: [{ label: "x" }, { label: "y" }] };
    assignRepeaterRowIds(data, undefined, LINES, NO_FIELD_GROUPS, counter());
    expect(rowsOf(data).map(row => row.id)).toEqual(["new-1", "new-2"]);
  });

  it("gives a fresh id to a row repeating an id the list already carries", () => {
    const data = {
      lines: [
        { id: "a", label: "x" },
        { id: "a", label: "x" },
      ],
    };
    assignRepeaterRowIds(
      data,
      { lines: [{ id: "a", label: "x" }] },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data).map(row => row.id)).toEqual(["a", "new-1"]);
  });

  it("keeps the stored id of an unchanged row sent without one, at its own index", () => {
    const data = { lines: [{ label: "x" }, { label: "y" }] };
    assignRepeaterRowIds(
      data,
      {
        lines: [
          { id: "a", label: "x" },
          { id: "b", label: "y" },
        ],
      },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data).map(row => row.id)).toEqual(["a", "b"]);
  });

  it("never moves an id to another row when rows sent without ids are reordered", () => {
    // Pairing by position would hand `y` the id of `x`: each moved row gets a
    // fresh id instead.
    const data = { lines: [{ label: "y" }, { label: "x" }] };
    assignRepeaterRowIds(
      data,
      {
        lines: [
          { id: "a", label: "x" },
          { id: "b", label: "y" },
        ],
      },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data)).toEqual([
      { id: "new-1", label: "y" },
      { id: "new-2", label: "x" },
    ]);
  });

  it("follows the rows when they are reordered with their ids", () => {
    const data = {
      lines: [
        { id: "b", label: "y" },
        { id: "a", label: "x" },
      ],
    };
    assignRepeaterRowIds(
      data,
      {
        lines: [
          { id: "a", label: "x" },
          { id: "b", label: "y" },
        ],
      },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data).map(row => row.id)).toEqual(["b", "a"]);
  });

  it("gives a fresh id to an edited row sent without one", () => {
    const data = { lines: [{ label: "x, edited" }] };
    assignRepeaterRowIds(
      data,
      { lines: [{ id: "a", label: "x" }] },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data)[0]?.id).toBe("new-1");
  });

  it("gives a fresh id to a row inserted ahead of the stored rows without ids", () => {
    // The new row sits where `x` was and differs from it; `x` moved down a
    // place, so neither keeps `a`.
    const data = { lines: [{ label: "new" }, { label: "x" }] };
    assignRepeaterRowIds(
      data,
      { lines: [{ id: "a", label: "x" }] },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data).map(row => row.id)).toEqual(["new-1", "new-2"]);
  });

  it("never gives one stored id to two rows", () => {
    // Row 0 is unchanged and id-less, so it would keep `a`, but row 1 names
    // `a` itself: the id stays with the row that names it.
    const data = { lines: [{ label: "x" }, { id: "a", label: "x" }] };
    assignRepeaterRowIds(
      data,
      { lines: [{ id: "a", label: "x" }] },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    const ids = rowsOf(data).map(row => row.id);
    expect(ids).toEqual(["new-1", "a"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("treats an empty or non-string id as none", () => {
    const data = {
      lines: [
        { id: "", label: "x" },
        { id: 7, label: "y" },
      ],
    };
    assignRepeaterRowIds(data, undefined, LINES, NO_FIELD_GROUPS, counter());
    expect(rowsOf(data).map(row => row.id)).toEqual(["new-1", "new-2"]);
  });

  it("reads a stored value held as JSON text and writes a text value back as text", () => {
    const data: Record<string, unknown> = {
      lines: JSON.stringify([{ label: "x" }, { label: "changed" }]),
    };
    assignRepeaterRowIds(
      data,
      {
        lines: JSON.stringify([
          { id: "a", label: "x" },
          { id: "b", label: "y" },
        ]),
      },
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(typeof data.lines).toBe("string");
    expect(JSON.parse(data.lines as string)).toEqual([
      { id: "a", label: "x" },
      { id: "new-1", label: "changed" },
    ]);
  });

  it("never changes the stored value it reads", () => {
    const stored = { lines: [{ id: "a", label: "x" }, { label: "y" }] };
    const before = structuredClone(stored);
    assignRepeaterRowIds(
      { lines: [{ label: "x" }, { label: "y" }] },
      stored,
      LINES,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(stored).toEqual(before);
  });

  it("reaches a repeater inside a group and inside a layout container", () => {
    const fields = [
      {
        name: "box",
        type: "group",
        fields: [
          {
            name: "lines",
            type: "repeater",
            fields: [{ name: "label", type: "text" }],
          },
        ],
      },
      {
        type: "row",
        fields: [
          {
            name: "flat",
            type: "repeater",
            fields: [{ name: "label", type: "text" }],
          },
        ],
      },
    ];
    const data: Record<string, unknown> = {
      box: { lines: [{ label: "x" }, { label: "new" }] },
      flat: [{ label: "z" }],
    };
    assignRepeaterRowIds(
      data,
      {
        box: { lines: [{ id: "a", label: "x" }] },
        flat: [{ id: "f", label: "z" }],
      },
      fields,
      NO_FIELD_GROUPS,
      counter()
    );
    expect(rowsOf(data.box as Record<string, unknown>)).toEqual([
      { id: "a", label: "x" },
      { id: "new-1", label: "new" },
    ]);
    expect(rowsOf(data, "flat")).toEqual([{ id: "f", label: "z" }]);
  });

  describe("a repeater inside a repeater", () => {
    const NESTED = [
      {
        name: "lines",
        type: "repeater",
        fields: [
          { name: "label", type: "text" },
          {
            name: "items",
            type: "repeater",
            fields: [{ name: "text", type: "text" }],
          },
        ],
      },
    ];
    const STORED = {
      lines: [
        {
          id: "a",
          label: "x",
          items: [
            { id: "i1", text: "one" },
            { id: "i2", text: "two" },
          ],
        },
      ],
    };

    it("keeps nested ids of a row sent wholly without ids and unchanged", () => {
      const data = {
        lines: [{ label: "x", items: [{ text: "one" }, { text: "two" }] }],
      };
      assignRepeaterRowIds(data, STORED, NESTED, NO_FIELD_GROUPS, counter());
      expect(data).toEqual(STORED);
    });

    it("pairs the nested rows with the stored row of the same id", () => {
      // The parent keeps its id, so its nested rows pair with its stored ones:
      // the unchanged one keeps its id, the edited one gets a fresh id.
      const data = {
        lines: [
          {
            id: "a",
            label: "x",
            items: [{ text: "one" }, { text: "two, edited" }],
          },
        ],
      };
      assignRepeaterRowIds(data, STORED, NESTED, NO_FIELD_GROUPS, counter());
      expect(rowsOf(data)[0]?.items).toEqual([
        { id: "i1", text: "one" },
        { id: "new-1", text: "two, edited" },
      ]);
    });

    it("gives a fresh id to an id-less row whose child was edited, and fresh ids to its id-less children", () => {
      // The row is changed (a child differs), so it is not unambiguously the
      // stored row, and nothing pairs its children with stored ones either.
      const data = {
        lines: [
          { label: "x", items: [{ text: "one" }, { text: "two, edited" }] },
        ],
      };
      assignRepeaterRowIds(data, STORED, NESTED, NO_FIELD_GROUPS, counter());
      expect(data.lines[0]).toEqual({
        id: "new-1",
        label: "x",
        items: [
          { id: "new-2", text: "one" },
          { id: "new-3", text: "two, edited" },
        ],
      });
    });

    it("keeps a nested row's own id even where its parent gets a fresh one", () => {
      const data = {
        lines: [
          {
            label: "x, edited",
            items: [{ id: "i1", text: "one" }],
          },
        ],
      };
      assignRepeaterRowIds(data, STORED, NESTED, NO_FIELD_GROUPS, counter());
      expect(data.lines[0]).toEqual({
        id: "new-1",
        label: "x, edited",
        items: [{ id: "i1", text: "one" }],
      });
    });
  });

  describe("a field group held inline", () => {
    // One list per field group, as a resolved reach returns it: a stored
    // instance pairs only with one read by the same fields.
    const CARD = [
      { name: "title", type: "text" },
      {
        name: "links",
        type: "repeater",
        fields: [{ name: "url", type: "text" }],
      },
    ];
    const reach: FieldGroupReach = {
      fieldsOf: slug => (slug === "card" ? CARD : undefined),
    };
    const fields = [
      {
        name: "box",
        type: "group",
        fields: [{ name: "card", type: "component", component: "card" }],
      },
    ];

    it("gives ids to the rows of a repeater inside the instance, paired with the stored instance's", () => {
      const data: Record<string, unknown> = {
        box: {
          card: { title: "t", links: [{ url: "/a" }, { url: "/new" }] },
        },
      };
      assignRepeaterRowIds(
        data,
        { box: { card: { title: "t", links: [{ id: "l1", url: "/a" }] } } },
        fields,
        reach,
        counter()
      );
      const card = (data.box as Record<string, unknown>).card as Record<
        string,
        unknown
      >;
      expect(card.links).toEqual([
        { id: "l1", url: "/a" },
        { id: "new-1", url: "/new" },
      ]);
      // The instance itself is not a repeater row and gets no id.
      expect(Object.hasOwn(card, "id")).toBe(false);
    });

    it("keeps a row's id when the repeater inside its instance comes back without ids", () => {
      // A row holding an instance that holds a repeater, sent back unchanged
      // by a writer that leaves every id out: the instance is opened, so the
      // nested rows' ids are set aside and the row is matched as unchanged.
      const rowsWithCards = [
        {
          name: "lines",
          type: "repeater",
          fields: [{ name: "card", type: "component", component: "card" }],
        },
      ];
      const data: Record<string, unknown> = {
        lines: [{ card: { title: "t", links: [{ url: "/a" }] } }],
      };
      assignRepeaterRowIds(
        data,
        {
          lines: [
            {
              id: "row-1",
              card: {
                id: "inst-1",
                title: "t",
                links: [{ id: "l1", url: "/a" }],
              },
            },
          ],
        },
        rowsWithCards,
        reach,
        counter()
      );
      const [row] = rowsOf(data);
      expect(row?.id).toBe("row-1");
      expect((row?.card as Record<string, unknown>).links).toEqual([
        { id: "l1", url: "/a" },
      ]);
    });

    it("leaves a field group placed directly on the entry to its own table's write", () => {
      const direct = [{ name: "card", type: "component", component: "card" }];
      const data: Record<string, unknown> = {
        card: { title: "t", links: [{ url: "/a" }] },
      };
      assignRepeaterRowIds(data, undefined, direct, reach, counter());
      expect((data.card as Record<string, unknown>).links).toEqual([
        { url: "/a" },
      ]);
    });

    it("leaves an instance whose fields are not known as it is", () => {
      const data: Record<string, unknown> = {
        box: { card: { title: "t", links: [{ url: "/a" }] } },
      };
      assignRepeaterRowIds(data, undefined, fields, NO_FIELD_GROUPS, counter());
      expect(
        ((data.box as Record<string, unknown>).card as Record<string, unknown>)
          .links
      ).toEqual([{ url: "/a" }]);
    });
  });
});

describe("reachesRepeaterField", () => {
  it("finds a repeater at any depth, and none where the fields hold none", () => {
    expect(reachesRepeaterField(LINES, NO_FIELD_GROUPS)).toBe(true);
    expect(
      reachesRepeaterField(
        [{ name: "box", type: "group", fields: LINES }],
        NO_FIELD_GROUPS
      )
    ).toBe(true);
    expect(
      reachesRepeaterField([{ name: "title", type: "text" }], NO_FIELD_GROUPS)
    ).toBe(false);
  });
});
