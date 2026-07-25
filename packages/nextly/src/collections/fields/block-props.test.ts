import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../errors/nextly-error";

import {
  blockPropsToFieldConfigs,
  validateBlockPropValues,
  type BlockPropsSource,
} from "./block-props";

/** The issues carried by a conversion failure, or an empty list. */
function issuesOf(fn: () => unknown): Array<{ path: string; code: string }> {
  try {
    fn();
  } catch (error) {
    if (
      NextlyError.is(error) &&
      error.publicData &&
      "errors" in error.publicData
    ) {
      return error.publicData.errors.map(issue => ({
        path: issue.path,
        code: issue.code,
      }));
    }
    throw error;
  }
  return [];
}

describe("blockPropsToFieldConfigs", () => {
  it("returns nothing for a block with no props", () => {
    expect(blockPropsToFieldConfigs({ name: "core/spacer" })).toEqual([]);
  });

  it("converts declarations in order, keyed by prop name", () => {
    const configs = blockPropsToFieldConfigs({
      name: "core/heading",
      props: {
        text: { type: "text", maxLength: 120, required: true },
        level: {
          type: "select",
          options: [
            { label: "H1", value: "h1" },
            { label: "H2", value: "h2" },
          ],
        },
      },
    });
    expect(configs.map(config => config.name)).toEqual(["text", "level"]);
    expect(configs[0]).toMatchObject({
      name: "text",
      type: "text",
      maxLength: 120,
      required: true,
    });
    expect(configs[1]).toMatchObject({
      name: "level",
      type: "select",
      options: [
        { label: "H1", value: "h1" },
        { label: "H2", value: "h2" },
      ],
    });
  });

  it("marks only top-level props named in `localized`", () => {
    const configs = blockPropsToFieldConfigs({
      name: "core/card",
      localized: ["title"],
      props: {
        title: { type: "text" },
        slug: { type: "text" },
        items: {
          type: "repeater",
          // A nested field sharing a localized prop's name is a different
          // value and must not inherit the flag.
          fields: { title: { type: "text" } },
        },
      },
    });
    expect(configs[0]).toMatchObject({ name: "title", localized: true });
    expect(configs[1]?.localized).toBeUndefined();
    const repeater = configs[2];
    expect(repeater?.type).toBe("repeater");
    expect(
      repeater && "fields" in repeater ? repeater.fields[0]?.localized : "unset"
    ).toBeUndefined();
  });

  it("does not copy defaults onto the field configs", () => {
    const configs = blockPropsToFieldConfigs({
      name: "core/heading",
      props: { text: { type: "text" } },
    });
    expect(configs[0]).not.toHaveProperty("defaultValue");
  });

  it("recurses into repeater and group prop declarations", () => {
    const configs = blockPropsToFieldConfigs({
      name: "core/features",
      props: {
        items: {
          type: "repeater",
          minRows: 1,
          maxRows: 6,
          fields: {
            heading: { type: "text" },
            body: { type: "textarea", maxLength: 400 },
          },
        },
        meta: {
          type: "group",
          fields: { note: { type: "text" } },
        },
      },
    });
    const repeater = configs[0];
    expect(repeater).toMatchObject({
      type: "repeater",
      minRows: 1,
      maxRows: 6,
    });
    expect(
      repeater && "fields" in repeater
        ? repeater.fields.map(field => field.name)
        : []
    ).toEqual(["heading", "body"]);
    const group = configs[1];
    expect(
      group && "fields" in group ? group.fields.map(field => field.name) : []
    ).toEqual(["note"]);
  });

  it("carries relation targets through for upload and relationship props", () => {
    const configs = blockPropsToFieldConfigs({
      name: "core/media",
      props: {
        image: { type: "upload", relationTo: "media" },
        related: {
          type: "relationship",
          relationTo: ["posts", "pages"],
          hasMany: true,
        },
      },
    });
    expect(configs[0]).toMatchObject({ type: "upload", relationTo: "media" });
    expect(configs[1]).toMatchObject({
      type: "relationship",
      relationTo: ["posts", "pages"],
      hasMany: true,
    });
  });
});

describe("blockPropsToFieldConfigs rejections", () => {
  it("rejects a field type a block prop may not declare", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          name: "core/secret",
          props: { token: { type: "password" } },
        })
      )
    ).toEqual([{ path: "token", code: "UNKNOWN_FIELD_TYPE" }]);
  });

  it("rejects a prop name that is not an identifier", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { "not a name": { type: "text" } },
        })
      )
    ).toEqual([{ path: "not a name", code: "INVALID_NAME" }]);
  });

  it("reports every bad declaration at once, not just the first", () => {
    const issues = issuesOf(() =>
      blockPropsToFieldConfigs({
        name: "core/broken",
        props: {
          one: { type: "nope" },
          two: { type: "select" },
          three: { type: "upload" },
        },
      })
    );
    expect(issues).toEqual([
      { path: "one", code: "UNKNOWN_FIELD_TYPE" },
      { path: "two", code: "MISSING_OPTIONS" },
      { path: "three", code: "MISSING_RELATION_TARGET" },
    ]);
  });

  it("rejects an option whose value has the wrong type", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", maxLength: "80" } },
        })
      )
    ).toEqual([{ path: "text.maxLength", code: "INVALID_OPTION" }]);
  });

  it("rejects a non-finite numeric option", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { count: { type: "number", max: Number.NaN } },
        })
      )
    ).toEqual([{ path: "count.max", code: "INVALID_OPTION" }]);
  });

  it("rejects malformed choice entries", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { level: { type: "select", options: [{ label: "H1" }] } },
        })
      )
    ).toEqual([{ path: "level", code: "INVALID_OPTIONS" }]);
  });

  it("rejects a structured prop with no nested fields", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { items: { type: "repeater", fields: {} } },
        })
      )
    ).toEqual([{ path: "items", code: "MISSING_FIELDS" }]);
  });

  it("paths nested failures under their parent prop", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            items: { type: "repeater", fields: { bad: { type: "password" } } },
          },
        })
      )
    ).toEqual([{ path: "items.bad", code: "UNKNOWN_FIELD_TYPE" }]);
  });

  it("survives a declaration that is not an object", () => {
    const source = {
      props: { broken: null },
    } as unknown as BlockPropsSource;
    expect(issuesOf(() => blockPropsToFieldConfigs(source))).toEqual([
      { path: "broken", code: "INVALID_DECLARATION" },
    ]);
  });
});

describe("blockPropsToFieldConfigs bounds", () => {
  it("rejects a lower bound greater than its upper bound", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", minLength: 10, maxLength: 5 } },
        })
      )
    ).toEqual([{ path: "text", code: "INVALID_BOUNDS" }]);
  });

  it("rejects inverted bounds on numbers, chips, and rows", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["count", { type: "number", min: 10, max: 1 }],
      ["tags", { type: "chips", minChips: 3, maxChips: 1 }],
      [
        "items",
        {
          type: "repeater",
          fields: { a: { type: "text" } },
          minRows: 4,
          maxRows: 2,
        },
      ],
    ];
    for (const [name, declaration] of cases) {
      expect(
        issuesOf(() =>
          blockPropsToFieldConfigs({ props: { [name]: declaration } })
        ),
        name
      ).toEqual([{ path: name, code: "INVALID_BOUNDS" }]);
    }
  });

  it("rejects a negative or fractional count bound", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", maxLength: -1 } },
        })
      )
    ).toEqual([{ path: "text.maxLength", code: "INVALID_OPTION" }]);
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", minLength: 1.5 } },
        })
      )
    ).toEqual([{ path: "text.minLength", code: "INVALID_OPTION" }]);
  });

  it("still allows a number prop to range below zero and hold fractions", () => {
    const configs = blockPropsToFieldConfigs({
      props: { offset: { type: "number", min: -10.5, max: 10.5 } },
    });
    expect(configs[0]).toMatchObject({ min: -10.5, max: 10.5 });
  });

  it("accepts equal bounds", () => {
    const configs = blockPropsToFieldConfigs({
      props: { code: { type: "text", minLength: 4, maxLength: 4 } },
    });
    expect(configs[0]).toMatchObject({ minLength: 4, maxLength: 4 });
  });

  it("stops recursion at the nesting limit instead of overflowing", () => {
    // A declaration that contains itself: legal to write, impossible to walk.
    const cyclic: Record<string, unknown> = { type: "group" };
    cyclic.fields = { inner: cyclic };
    const issues = issuesOf(() =>
      blockPropsToFieldConfigs({
        props: { root: cyclic as never },
      })
    );
    expect(issues.at(-1)?.code).toBe("NESTING_TOO_DEEP");
  });
});

describe("validateBlockPropValues shape checks", () => {
  it("rejects a rich text value that is not editor content", async () => {
    const source: BlockPropsSource = { props: { body: { type: "richText" } } };
    expect(await validateBlockPropValues({ body: 42 }, source)).toHaveLength(1);
    expect(
      await validateBlockPropValues({ body: { nope: true } }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { body: { root: { type: "root", children: [] } } },
        source
      )
    ).toEqual([]);
  });

  it("rejects a malformed reference on upload and relationship props", async () => {
    const source: BlockPropsSource = {
      props: {
        image: { type: "upload", relationTo: "media" },
        related: { type: "relationship", relationTo: ["posts"], hasMany: true },
      },
    };
    const issues = await validateBlockPropValues(
      { image: { nonsense: true }, related: [{ bad: 1 }] },
      source
    );
    expect(issues.map(issue => issue.path).sort()).toEqual([
      "image",
      "related",
    ]);
  });

  it("accepts ids and polymorphic references, honoring cardinality", async () => {
    const source: BlockPropsSource = {
      props: {
        image: { type: "upload", relationTo: "media" },
        related: { type: "relationship", relationTo: ["posts"], hasMany: true },
      },
    };
    expect(
      await validateBlockPropValues(
        {
          image: "media-1",
          related: [{ relationTo: "posts", value: "p1" }, "p2"],
        },
        source
      )
    ).toEqual([]);
    // A list where a single reference belongs, and the reverse.
    expect(
      await validateBlockPropValues(
        { image: ["media-1"], related: "p1" },
        source
      )
    ).toHaveLength(2);
  });

  it("rejects a json prop value JSON cannot represent", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    expect(
      await validateBlockPropValues({ data: () => 1 }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ data: { nested: [Symbol("x")] } }, source)
    ).toHaveLength(1);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      await validateBlockPropValues({ data: cyclic }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ data: { ok: [1, "two", null] } }, source)
    ).toEqual([]);
  });
});

describe("plugin field types as block props", () => {
  afterEach(() => {
    clearFieldTypes();
  });

  it("admits a plugin type that opted into the blocks surface", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "plugin/rating",
      surfaces: ["blocks"],
    });
    const configs = blockPropsToFieldConfigs({
      name: "core/review",
      props: { score: { type: "rating", min: 1, max: 5 } },
    });
    // The prop keeps its name and validates as the storage primitive the
    // plugin declared; the plugin's own component renders it.
    expect(configs).toEqual([
      { name: "score", type: "number", min: 1, max: 5 },
    ]);
  });

  it("refuses a plugin type that did not opt into the blocks surface", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "plugin/rating",
      surfaces: ["forms"],
    });
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({ props: { score: { type: "rating" } } })
      )
    ).toEqual([{ path: "score", code: "UNKNOWN_FIELD_TYPE" }]);
  });

  it("refuses a plugin type that declared no surfaces", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "plugin/rating",
    });
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({ props: { score: { type: "rating" } } })
      )
    ).toEqual([{ path: "score", code: "UNKNOWN_FIELD_TYPE" }]);
  });

  it("maps every storage primitive to a block prop type", () => {
    const primitives = [
      ["text", "text"],
      ["longText", "textarea"],
      ["boolean", "checkbox"],
      ["number", "number"],
      ["timestamp", "date"],
      ["json", "json"],
    ] as const;
    for (const [storage, expected] of primitives) {
      clearFieldTypes();
      registerFieldType({
        type: "custom",
        storage,
        component: "plugin/custom",
        surfaces: ["blocks"],
      });
      const configs = blockPropsToFieldConfigs({
        props: { value: { type: "custom" } },
      });
      expect(configs[0]?.type, storage).toBe(expected);
    }
  });
});

describe("validateBlockPropValues", () => {
  const source: BlockPropsSource = {
    name: "core/heading",
    props: {
      text: { type: "text", required: true, maxLength: 10 },
      level: {
        type: "select",
        options: [
          { label: "H1", value: "h1" },
          { label: "H2", value: "h2" },
        ],
      },
    },
  };

  it("accepts values that satisfy the declarations", async () => {
    expect(
      await validateBlockPropValues({ text: "Hello", level: "h1" }, source)
    ).toEqual([]);
  });

  it("enforces the same rules an entry field would", async () => {
    const issues = await validateBlockPropValues(
      { text: "far too long to fit", level: "h9" },
      source
    );
    expect(issues.map(issue => issue.path).sort()).toEqual(["level", "text"]);
  });

  it("treats an absent required prop as missing rather than untouched", async () => {
    const issues = await validateBlockPropValues({ level: "h1" }, source);
    expect(issues.map(issue => issue.path)).toEqual(["text"]);
  });
});
