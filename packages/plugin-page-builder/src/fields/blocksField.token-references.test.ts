/**
 * A page write that adds a reference to a variable the site does not define
 * is refused; a reference the stored page already held still saves. This is
 * what fences a variable's removal: once the site style is written without
 * it, no later save can bring a first use of it.
 */
import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";

/** A page whose nodes each use the variables listed, one value apiece. */
const page = (...variables: string[][]) => ({
  formatVersion: 1,
  kind: "page",
  nodes: variables.map((list, index) => ({
    id: `n${index}`,
    type: "core/text",
    version: 1,
    props: {},
    styles: {
      base: {
        base: Object.fromEntries(
          list.map((identity, at) => [
            ["color", "backgroundColor", "borderColor"][at] ?? "color",
            { $token: identity },
          ])
        ),
      },
    },
  })),
});

/** A page using a variable only in its own settings. */
const settingsUsing = (identity: string) => ({
  formatVersion: 1,
  kind: "page",
  nodes: [],
  settings: {
    styles: { base: { base: { backgroundColor: { $token: identity } } } },
  },
});

/**
 * An entry write whose stored forms hold `published` and `draft`, at the
 * field path `at` (the top-level `content` unless named); recording the
 * fields each stored read named.
 */
function write(
  stored: {
    published?: unknown;
    draft?: unknown;
    id?: string;
  },
  at = "content",
  read: string[] = []
): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    ...(stored.id === undefined ? { id: "p1" } : {}),
    inTransaction: false,
    readStored: async target => {
      read.push(target.field);
      if (target.field !== at) return { kind: "absent" };
      const value =
        target.form === "published" ? stored.published : stored.draft;
      return value === undefined
        ? { kind: "absent" }
        : { kind: "value", value };
    },
  } as PluginFieldWrite;
}

const SITE_VARIABLES = new Set(["color.brand"]);

function setup() {
  const siteDefinitions = vi.fn(async () => ({
    classIds: new Set<string>(),
    breakpointIds: new Set(["base"]),
    tokenIds: SITE_VARIABLES,
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
  how: { mode: "create" | "update"; write?: PluginFieldWrite; path?: string }
) {
  const path = how.path ?? "content";
  return setup().field.validate?.(value, {
    path,
    field: { name: path.split(".").at(-1), type: "blocks" },
    data: {},
    mode: how.mode,
    ...(how.write === undefined ? {} : { write: how.write }),
  } as never);
}

const codes = (result: unknown) =>
  Array.isArray(result)
    ? result.map((issue: { code: string }) => issue.code)
    : result;

describe("a page write's references to the site's variables", () => {
  it("refuses a newly added variable the site does not define", async () => {
    const result = await validate(page(["color.brand"], ["color.gone"]), {
      mode: "update",
      write: write({ published: page(["color.brand"]) }),
    });
    expect(codes(result)).toEqual(["unknown-token"]);
    expect(JSON.stringify(result)).toContain("color.gone");
  });

  it("refuses one added in the page's own settings, which no block holds", async () => {
    expect(
      codes(
        await validate(settingsUsing("color.gone"), {
          mode: "update",
          write: write({ published: page([]) }),
        })
      )
    ).toEqual(["unknown-token"]);
  });

  it("keeps saving a reference the stored page already held", async () => {
    // A variable removed before this rule existed, or by a trusted import, is
    // the page's to clean up; refusing it would make the page unsavable.
    expect(
      await validate(page(["color.gone"], ["color.brand"]), {
        mode: "update",
        write: write({ published: page(["color.gone"]) }),
      })
    ).toBe(true);
  });

  it("counts a reference held only by the draft as stored", async () => {
    expect(
      await validate(page(["color.gone"]), {
        mode: "update",
        write: write({ published: page([]), draft: page(["color.gone"]) }),
      })
    ).toBe(true);
  });

  it("refuses an undefined variable on a new page", async () => {
    expect(
      codes(
        await validate(page(["color.gone"]), {
          mode: "create",
          write: write({ id: "none" }),
        })
      )
    ).toEqual(["unknown-token"]);
  });

  it("passes a page whose variables the site defines", async () => {
    expect(
      await validate(page(["color.brand"]), {
        mode: "update",
        write: write({ published: page([]) }),
      })
    ).toBe(true);
  });

  it("asks nothing of a value judged on its own, with no write behind it", async () => {
    const { field, siteDefinitions } = setup();
    expect(
      await field.validate?.(page(["color.gone"]), {
        path: "content",
        field: { name: "content", type: "blocks" },
        mode: "update",
      } as never)
    ).toBe(true);
    expect(siteDefinitions).not.toHaveBeenCalled();
  });
});

describe("a blocks field inside named groups", () => {
  it("refuses a newly added undefined variable, read against the stored value at its path", async () => {
    const read: string[] = [];
    const result = await validate(page(["color.gone"]), {
      mode: "update",
      path: "hero.body",
      write: write({ published: page(["color.brand"]) }, "hero.body", read),
    });
    expect(codes(result)).toEqual(["unknown-token"]);
    expect(read).toContain("hero.body");
  });

  it("keeps saving a reference the stored value at its path already held", async () => {
    // The control: the same write, with the reference already stored there.
    expect(
      await validate(page(["color.gone"]), {
        mode: "update",
        path: "hero.body",
        write: write({ published: page(["color.gone"]) }, "hero.body"),
      })
    ).toBe(true);
  });

  it("refuses an undefined variable where the stored read cannot name the field", async () => {
    // A group kept per language: nothing proves the page held it already.
    const refusing = {
      ...write({}),
      readStored: async () => {
        throw NextlyError.invalidInput({
          message:
            '"pages.hero.body" cannot be read here: it is inside a group kept per language.',
        });
      },
    } as PluginFieldWrite;
    expect(
      codes(
        await validate(page(["color.gone"]), {
          mode: "update",
          path: "hero.body",
          write: refusing,
        })
      )
    ).toEqual(["unknown-token"]);
  });

  it("does not judge a field in a repeater's rows, which has no stored path", async () => {
    expect(
      await validate(page(["color.gone"]), {
        mode: "update",
        path: "rows[0].body",
        write: write({ published: page([]) }, "rows[0].body"),
      })
    ).toBe(true);
  });
});
