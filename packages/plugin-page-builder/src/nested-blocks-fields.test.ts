import { describe, expect, it, vi } from "vitest";

import {
  nestedBlocksFields,
  warnNestedBlocksFields,
} from "./nested-blocks-fields";

const blocks = (name: string) => ({ name, type: "blocks" });

describe("nestedBlocksFields", () => {
  it("names a blocks field inside a named group, by its path", () => {
    expect(
      nestedBlocksFields({
        collections: [
          {
            slug: "pages",
            fields: [
              { name: "title", type: "text" },
              { name: "hero", type: "group", fields: [blocks("layout")] },
            ],
          },
        ],
      })
    ).toEqual([{ kind: "collection", slug: "pages", path: "hero.layout" }]);
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
          ],
        },
      ],
    };

    warnNestedBlocksFields(config, warn);
    // A reload in one process runs it again; the operator is told once per
    // field, and every field is told: a single "warned already" flag would
    // say the first and drop the second.
    warnNestedBlocksFields(config, warn);

    expect(warn).toHaveBeenCalledTimes(2);
    const messages = warn.mock.calls.map(call => call[0] as string);
    expect(messages[0]).toContain('collection "pages"');
    expect(messages[0]).toContain('"hero.layout"');
    expect(messages[0]).toContain("top-level fields only");
    expect(messages[0]).toContain("Move it to the top level");
    expect(messages[1]).toContain('"rows.cell"');
  });

  it("says nothing when every blocks field is at the top level", () => {
    const warn = vi.fn();
    warnNestedBlocksFields(
      { collections: [{ slug: "posts", fields: [blocks("content")] }] },
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
