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

  it("names one inside a repeater, and inside a Single", () => {
    expect(
      nestedBlocksFields({
        singles: [
          {
            slug: "home",
            fields: [
              { name: "sections", type: "repeater", fields: [blocks("body")] },
            ],
          },
        ],
      })
    ).toEqual([{ kind: "single", slug: "home", path: "sections.body" }]);
  });

  it("names one inside a repeater whatever the groups around it", () => {
    // A group inside a repeater's row, and a repeater inside a group: either
    // way the path runs through a row.
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
      })
    ).toEqual([
      { kind: "collection", slug: "pages", path: "rows.hero.a" },
      { kind: "collection", slug: "pages", path: "page.rows.b" },
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
  it("warns once per field, naming where each is and what to do", () => {
    const warn = vi.fn();
    const config = {
      collections: [
        {
          slug: "pages",
          fields: [
            { name: "hero", type: "group", fields: [blocks("layout")] },
            { name: "rows", type: "repeater", fields: [blocks("cell")] },
            { name: "more", type: "repeater", fields: [blocks("cell")] },
          ],
        },
      ],
    };

    warnNestedBlocksFields(config, warn);
    // A reload in one process runs it again; the operator is told once per
    // field, and every field is told: a single "warned already" flag would
    // say the first and drop the second.
    warnNestedBlocksFields(config, warn);

    // The grouped field opens in the Page Builder, so it is not mentioned.
    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map(call => call[0] as string);
    expect(messages[0]).toContain('collection "pages"');
    expect(messages[0]).toContain('"rows.cell"');
    expect(messages[0]).toContain("inside a repeater");
    expect(messages[0]).toContain("Move it out of the repeater");
    expect(messages[1]).toContain('"more.cell"');
    expect(messages.join("\n")).not.toContain("hero.layout");
  });

  it("says nothing when every blocks field is at the top level or in a group", () => {
    const warn = vi.fn();
    warnNestedBlocksFields(
      {
        collections: [
          {
            slug: "posts",
            fields: [
              blocks("content"),
              { name: "hero", type: "group", fields: [blocks("body")] },
            ],
          },
        ],
      },
      warn
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("names a Single as a Single", () => {
    const warn = vi.fn();
    warnNestedBlocksFields(
      {
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
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('single "landing"');
  });
});
