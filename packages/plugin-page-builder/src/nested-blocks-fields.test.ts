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
  it("warns once per field, naming where it is and what to do", () => {
    const warn = vi.fn();
    const config = {
      logger: { warn },
      collections: [
        {
          slug: "pages",
          fields: [{ name: "hero", type: "group", fields: [blocks("layout")] }],
        },
      ],
    };

    warnNestedBlocksFields(config);
    // Setup can run more than once in one process; the operator is told once.
    warnNestedBlocksFields(config);

    expect(warn).toHaveBeenCalledOnce();
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('collection "pages"');
    expect(message).toContain('"hero.layout"');
    expect(message).toContain("top-level fields only");
    expect(message).toContain("Move it to the top level");
  });

  it("warns on the console when the config carries no logger", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnNestedBlocksFields({
      singles: [
        {
          slug: "landing",
          fields: [
            { name: "rows", type: "repeater", fields: [blocks("cell")] },
          ],
        },
      ],
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('single "landing"');
    warn.mockRestore();
  });

  it("says nothing when every blocks field is at the top level", () => {
    const warn = vi.fn();
    warnNestedBlocksFields({
      logger: { warn },
      collections: [{ slug: "posts", fields: [blocks("content")] }],
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
