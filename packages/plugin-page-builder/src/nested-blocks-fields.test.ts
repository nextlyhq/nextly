import { describe, expect, it, vi } from "vitest";

import {
  nestedBlocksFields,
  warnNestedBlocksFields,
} from "./nested-blocks-fields";

const blocks = (name: string) => ({ name, type: "blocks" });

describe("nestedBlocksFields", () => {
  it("leaves a blocks field inside named groups alone, at any depth", () => {
    // The Page Builder opens a grouped field by its path (`hero.layout`).
    expect(
      nestedBlocksFields({
        collections: [
          {
            slug: "pages",
            fields: [
              { name: "title", type: "text" },
              { name: "hero", type: "group", fields: [blocks("layout")] },
              {
                name: "outer",
                type: "group",
                fields: [
                  { name: "inner", type: "group", fields: [blocks("deep")] },
                ],
              },
            ],
          },
        ],
      })
    ).toEqual([]);
  });

  it("leaves a blocks field inside a repeater's row alone, whatever the groups around it", () => {
    // The Page Builder opens a row's field by an address naming the row's
    // saved id (`rows.<rowId>.hero.a`), so a repeater no longer puts a blocks
    // field out of reach: a group in a row, a repeater in a group, a Single.
    expect(
      nestedBlocksFields({
        collections: [
          {
            slug: "pages",
            fields: [
              {
                name: "rows",
                type: "repeater",
                fields: [
                  { name: "hero", type: "group", fields: [blocks("a")] },
                ],
              },
              {
                name: "page",
                type: "group",
                fields: [
                  { name: "rows", type: "repeater", fields: [blocks("b")] },
                ],
              },
            ],
          },
        ],
        singles: [
          {
            slug: "home",
            fields: [
              { name: "sections", type: "repeater", fields: [blocks("body")] },
            ],
          },
        ],
      })
    ).toEqual([]);
  });

  it("names one inside a repeater whose rows declare their own id", () => {
    // Those rows get no saved id, so no address can name one of them.
    expect(
      nestedBlocksFields({
        collections: [
          {
            slug: "pages",
            fields: [
              {
                name: "rows",
                type: "repeater",
                fields: [{ name: "id", type: "text" }, blocks("body")],
              },
            ],
          },
        ],
      })
    ).toEqual([
      {
        kind: "collection",
        slug: "pages",
        path: "rows.body",
        because: "ownIdRows",
      },
    ]);
  });

  it("leaves a top-level field, and one in an unnamed group, alone", () => {
    // An unnamed group is presentation only: its fields are addressed at the
    // top level, where the Page Builder opens them.
    expect(
      nestedBlocksFields({
        collections: [
          {
            slug: "pages",
            fields: [
              blocks("content"),
              { type: "group", fields: [blocks("aside")] },
            ],
          },
        ],
      })
    ).toEqual([]);
  });

  it("reads past malformed declarations rather than throwing", () => {
    expect(
      nestedBlocksFields({
        collections: [
          { slug: "x", fields: "nope" },
          { fields: [{ name: "g", type: "group", fields: [blocks("b")] }] },
        ],
      } as never)
    ).toEqual([]);
  });
});

describe("warnNestedBlocksFields", () => {
  it("says nothing at startup about a blocks field inside a repeater", () => {
    // The Page Builder opens it, row by row, so there is nothing to warn
    // about; the warning used to name every such field.
    const warn = vi.fn();
    warnNestedBlocksFields(
      {
        collections: [
          {
            slug: "articles",
            fields: [
              { name: "rows", type: "repeater", fields: [blocks("cell")] },
              {
                name: "page",
                type: "group",
                fields: [
                  {
                    name: "more",
                    type: "repeater",
                    fields: [
                      { name: "hero", type: "group", fields: [blocks("x")] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        singles: [
          {
            slug: "landing",
            fields: [
              { name: "rows", type: "repeater", fields: [blocks("cell")] },
            ],
          },
        ],
      },
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per field in a repeater whose rows declare their own id, saying why", () => {
    const warn = vi.fn();
    const config = {
      collections: [
        {
          slug: "listings",
          fields: [
            { name: "hero", type: "group", fields: [blocks("layout")] },
            {
              name: "rows",
              type: "repeater",
              fields: [{ name: "id", type: "text" }, blocks("cell")],
            },
            { name: "more", type: "repeater", fields: [blocks("cell")] },
          ],
        },
      ],
    };

    warnNestedBlocksFields(config, warn);
    // A reload in one process runs it again; the operator is told once per
    // field.
    warnNestedBlocksFields(config, warn);

    // Only the field in the repeater with its own `id`: the grouped field and
    // the one in a repeater with saved row ids both open.
    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain('collection "listings"');
    expect(message).toContain('"rows.cell"');
    expect(message).toContain("declare their own `id` field");
    expect(warn.mock.calls.join("\n")).not.toContain("more.cell");
    expect(warn.mock.calls.join("\n")).not.toContain("hero.layout");
  });

  it("names a Single as a Single", () => {
    const warn = vi.fn();
    warnNestedBlocksFields(
      {
        singles: [
          {
            slug: "promo",
            fields: [
              {
                name: "rows",
                type: "repeater",
                fields: [{ name: "id", type: "text" }, blocks("cell")],
              },
            ],
          },
        ],
      },
      warn
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('single "promo"');
  });
});
