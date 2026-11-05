/**
 * A page write that adds a reference to a class the site does not define is
 * refused; a reference the stored page already held still saves. The engine
 * keeps the rule a warning, since it cannot tell a new reference from an old
 * one; the write path can, by comparing with the stored forms.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";

const page = (...classes: string[][]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: classes.map((list, index) => ({
    id: `n${index}`,
    type: "core/text",
    version: 1,
    props: {},
    classes: list,
  })),
});

/** An entry write whose stored forms hold `published` and `draft`. */
function write(stored: {
  published?: unknown;
  draft?: unknown;
  id?: string;
}): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    ...(stored.id === undefined ? { id: "p1" } : {}),
    inTransaction: false,
    readStored: async target => {
      const value =
        target.form === "published" ? stored.published : stored.draft;
      return value === undefined
        ? { kind: "absent" }
        : { kind: "value", value };
    },
  } as PluginFieldWrite;
}

const SITE_CLASSES = new Set(["c-card"]);

function setup() {
  const siteDefinitions = vi.fn(async () => ({
    classIds: SITE_CLASSES,
    breakpointIds: new Set(["base"]),
  }));
  const composition: CompositionSetup = {
    store: { collection: "components", field: "definition" },
    limits: DEFAULT_LIMITS,
    composesDocuments: false,
    siteDefinitions,
  };
  return {
    siteDefinitions,
    field: blocksFieldType(undefined, () => composition),
  };
}

async function validate(
  value: unknown,
  how: { mode: "create" | "update"; write?: PluginFieldWrite }
) {
  return setup().field.validate?.(value, {
    path: "content",
    field: { name: "content", type: "blocks" },
    data: {},
    mode: how.mode,
    ...(how.write === undefined ? {} : { write: how.write }),
  } as never);
}

const codes = (result: unknown) =>
  Array.isArray(result)
    ? result.map((issue: { code: string }) => issue.code)
    : result;

describe("a page write's references to the site's shared styles", () => {
  it("refuses a newly added class the site does not define", async () => {
    const result = await validate(page(["c-card"], ["c-gone"]), {
      mode: "update",
      write: write({ published: page(["c-card"]) }),
    });
    expect(codes(result)).toEqual(["unknown-class"]);
    expect(JSON.stringify(result)).toContain("c-gone");
  });

  it("keeps saving a reference the stored page already held", async () => {
    // A class removed from the library before this rule existed, or by a
    // trusted import, is the page's to clean up; refusing it would make the
    // page unsavable for a change nobody made.
    expect(
      await validate(page(["c-gone"], ["c-card"]), {
        mode: "update",
        write: write({ published: page(["c-gone"]) }),
      })
    ).toBe(true);
  });

  it("counts a reference held only by the draft as stored", async () => {
    expect(
      await validate(page(["c-gone"]), {
        mode: "update",
        write: write({ published: page([]), draft: page(["c-gone"]) }),
      })
    ).toBe(true);
  });

  it("refuses an undefined class on a new page", async () => {
    expect(
      codes(
        await validate(page(["c-gone"]), {
          mode: "create",
          write: write({ id: "none" }),
        })
      )
    ).toEqual(["unknown-class"]);
  });

  it("passes a page whose classes the site defines", async () => {
    expect(
      await validate(page(["c-card"]), {
        mode: "update",
        write: write({ published: page([]) }),
      })
    ).toBe(true);
  });

  it("asks nothing of a value judged on its own, with no write behind it", async () => {
    const { field, siteDefinitions } = setup();
    expect(
      await field.validate?.(page(["c-gone"]), {
        path: "content",
        field: { name: "content", type: "blocks" },
        mode: "update",
      } as never)
    ).toBe(true);
    expect(siteDefinitions).not.toHaveBeenCalled();
  });
});
