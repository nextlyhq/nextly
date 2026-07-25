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

  it("leaves built-in props without a plugin identity", () => {
    const configs = blockPropsToFieldConfigs({
      props: { text: { type: "text" } },
    });
    expect(configs[0]).not.toHaveProperty("custom");
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
          related: [{ relationTo: "posts", value: "p1" }],
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

  it("ties the stored reference shape to the target arity", async () => {
    // A single target fixes the collection, so the id stands alone; several
    // targets make a bare id ambiguous, so the reference must name its own.
    const single: BlockPropsSource = {
      props: { image: { type: "upload", relationTo: "media" } },
    };
    expect(await validateBlockPropValues({ image: "m1" }, single)).toEqual([]);
    expect(
      await validateBlockPropValues(
        { image: { relationTo: "media", value: "m1" } },
        single
      )
    ).toHaveLength(1);

    const many: BlockPropsSource = {
      props: { ref: { type: "relationship", relationTo: ["posts", "pages"] } },
    };
    expect(
      await validateBlockPropValues(
        { ref: { relationTo: "pages", value: "p1" } },
        many
      )
    ).toEqual([]);
    expect(await validateBlockPropValues({ ref: "p1" }, many)).toHaveLength(1);
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

describe("blockPropsToFieldConfigs unknown options", () => {
  it("refuses the nested validation object rather than dropping it", () => {
    // Silently ignoring it would leave a declaration that reads as if it
    // constrains its values while validating nothing.
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", validation: { maxLength: 5 } } },
        })
      )
    ).toEqual([{ path: "text.validation", code: "UNKNOWN_OPTION" }]);
  });

  it("refuses a validate function, which cannot reach the manifest", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", validate: () => "nope" } },
        })
      )
    ).toEqual([{ path: "text.validate", code: "UNKNOWN_OPTION" }]);
  });

  it("refuses a misspelled option and an option belonging to another type", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { text: { type: "text", maxLenght: 5 } },
        })
      )
    ).toEqual([{ path: "text.maxLenght", code: "UNKNOWN_OPTION" }]);
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { note: { type: "richText", maxLength: 5 } },
        })
      )
    ).toEqual([{ path: "note.maxLength", code: "UNKNOWN_OPTION" }]);
  });

  it("names every unknown option, not only the first", () => {
    const issues = issuesOf(() =>
      blockPropsToFieldConfigs({
        props: { text: { type: "text", nope: 1, alsoNope: 2 } },
      })
    );
    expect(issues.map(issue => issue.path)).toEqual([
      "text.nope",
      "text.alsoNope",
    ]);
  });
});

describe("blockPropsToFieldConfigs cardinality", () => {
  it("carries hasMany and row bounds onto text and number props", () => {
    const configs = blockPropsToFieldConfigs({
      props: {
        tags: { type: "text", hasMany: true, minRows: 1, maxRows: 3 },
        scores: { type: "number", hasMany: true, minRows: 2 },
      },
    });
    expect(configs[0]).toMatchObject({
      type: "text",
      hasMany: true,
      minRows: 1,
      maxRows: 3,
    });
    expect(configs[1]).toMatchObject({
      type: "number",
      hasMany: true,
      minRows: 2,
    });
  });

  it("keeps validation in step with what the binding API allows", async () => {
    // canBindFieldToProp accepts a many-valued source for a many-valued prop,
    // so validation must accept the array that binding would deliver.
    const source: BlockPropsSource = {
      props: { tags: { type: "text", hasMany: true } },
    };
    expect(await validateBlockPropValues({ tags: ["a", "b"] }, source)).toEqual(
      []
    );
    expect(await validateBlockPropValues({ tags: "a" }, source)).toHaveLength(
      1
    );
  });
});

describe("validateBlockPropValues value shapes", () => {
  it("rejects non-finite numbers, which JSON stores as null", async () => {
    const source: BlockPropsSource = { props: { count: { type: "number" } } };
    expect(
      await validateBlockPropValues({ count: Number.POSITIVE_INFINITY }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ count: Number.NEGATIVE_INFINITY }, source)
    ).toHaveLength(1);
    expect(await validateBlockPropValues({ count: 42 }, source)).toEqual([]);
  });

  it("rejects non-finite numbers inside a json prop", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    expect(
      await validateBlockPropValues({ data: { n: Number.NaN } }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { data: [Number.POSITIVE_INFINITY] },
        source
      )
    ).toHaveLength(1);
  });

  it("requires every chips entry to be text", async () => {
    const source: BlockPropsSource = { props: { tags: { type: "chips" } } };
    expect(
      await validateBlockPropValues({ tags: [1, {}] }, source)
    ).toHaveLength(1);
    expect(await validateBlockPropValues({ tags: ["a", "b"] }, source)).toEqual(
      []
    );
  });

  it("requires the rich-text root to be a root node with node children", async () => {
    const source: BlockPropsSource = { props: { body: { type: "richText" } } };
    expect(
      await validateBlockPropValues(
        { body: { root: { type: "paragraph", children: [] } } },
        source
      )
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { body: { root: { type: "root", children: [42] } } },
        source
      )
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { body: { root: { type: "root", children: [{ type: "paragraph" }] } } },
        source
      )
    ).toEqual([]);
  });

  it("rejects a reference to a collection the prop does not relate to", async () => {
    const source: BlockPropsSource = {
      props: { related: { type: "relationship", relationTo: ["posts"] } },
    };
    expect(
      await validateBlockPropValues(
        { related: { relationTo: "users", value: "u1" } },
        source
      )
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { related: { relationTo: "posts", value: "p1" } },
        source
      )
    ).toEqual([]);
  });
});

describe("validateBlockPropValues structural shapes", () => {
  it("enforces the row bounds a scalar list prop advertises", async () => {
    const source: BlockPropsSource = {
      props: {
        tags: { type: "text", hasMany: true, minRows: 2, maxRows: 3 },
        scores: { type: "number", hasMany: true, maxRows: 1 },
      },
    };
    expect(
      await validateBlockPropValues({ tags: ["only-one"] }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ tags: ["a", "b", "c", "d"] }, source)
    ).toHaveLength(1);
    expect(await validateBlockPropValues({ tags: ["a", "b"] }, source)).toEqual(
      []
    );
    expect(
      await validateBlockPropValues({ scores: [1, 2] }, source)
    ).toHaveLength(1);
    // An empty list never reaches the shared bounds rules for a hasMany
    // scalar, so the declared minimum is enforced alongside the shape check.
    expect(await validateBlockPropValues({ tags: [] }, source)).toEqual([
      {
        path: "tags",
        code: "TOO_FEW_ROWS",
        message: "tags must have at least 2 entries.",
      },
    ]);
  });

  it("requires structured props to hold plain JSON records", async () => {
    const source: BlockPropsSource = {
      props: {
        meta: { type: "group", fields: { note: { type: "text" } } },
        items: { type: "repeater", fields: { note: { type: "text" } } },
      },
    };
    // A Date survives the shared object check but becomes a string once the
    // document is encoded.
    expect(
      await validateBlockPropValues({ meta: new Date() }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ items: [new Date()] }, source)
    ).toHaveLength(1);
    const cyclic: Record<string, unknown> = { note: "a" };
    cyclic.self = cyclic;
    expect(
      await validateBlockPropValues({ meta: cyclic }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { meta: { note: "a" }, items: [{ note: "b" }] },
        source
      )
    ).toEqual([]);
  });

  it("rejects an empty list supplied for a prop holding one value", async () => {
    // The shared validator reads [] as an absent value and returns before any
    // type rule runs, so this is the one array shape it never inspects.
    const source: BlockPropsSource = {
      props: {
        title: { type: "text" },
        body: { type: "richText" },
        data: { type: "json" },
        tags: { type: "chips" },
      },
    };
    expect(await validateBlockPropValues({ title: [] }, source)).toEqual([
      {
        path: "title",
        code: "INVALID_TYPE",
        message: "title must not be a list.",
      },
    ]);
    expect(await validateBlockPropValues({ body: [] }, source)).toHaveLength(1);
    // An array is a legitimate JSON value, and chips are a list by definition.
    expect(
      await validateBlockPropValues({ data: [], tags: [] }, source)
    ).toEqual([]);
  });

  it("reaches empty lists nested inside groups and repeater rows", async () => {
    const source: BlockPropsSource = {
      props: {
        meta: { type: "group", fields: { note: { type: "text" } } },
        items: { type: "repeater", fields: { note: { type: "text" } } },
      },
    };
    const issues = await validateBlockPropValues(
      { meta: { note: [] }, items: [{ note: [] }] },
      source
    );
    expect(issues.map(issue => issue.path).sort()).toEqual([
      "items[0].note",
      "meta.note",
    ]);
  });
});

describe("blockPropsToFieldConfigs relation targets", () => {
  it("rejects a relationTo that no collection could be named", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { ref: { type: "relationship", relationTo: "Not valid!" } },
        })
      )
    ).toEqual([{ path: "ref", code: "MISSING_RELATION_TARGET" }]);
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: { ref: { type: "upload", relationTo: ["media", "Bad Slug"] } },
        })
      )
    ).toEqual([{ path: "ref", code: "MISSING_RELATION_TARGET" }]);
  });

  it("accepts canonical slugs in both forms", () => {
    const configs = blockPropsToFieldConfigs({
      props: {
        image: { type: "upload", relationTo: "media_files" },
        ref: { type: "relationship", relationTo: ["blog-posts", "pages"] },
      },
    });
    expect(configs[0]).toMatchObject({ relationTo: "media_files" });
    expect(configs[1]).toMatchObject({ relationTo: ["blog-posts", "pages"] });
  });
});

describe("validateBlockPropValues serializability", () => {
  it("rejects rich text that is well formed but cannot be stored", async () => {
    const source: BlockPropsSource = { props: { body: { type: "richText" } } };
    const child: Record<string, unknown> = { type: "paragraph" };
    child.self = child;
    const issues = await validateBlockPropValues(
      { body: { root: { type: "root", children: [child] } } },
      source
    );
    // Every structural rule passes; the value still cannot reach the document.
    expect(issues).toEqual([
      {
        path: "body",
        code: "NOT_SERIALIZABLE",
        message: expect.stringContaining("body"),
      },
    ]);
  });

  it("covers every prop type from one place", async () => {
    const source: BlockPropsSource = {
      props: {
        title: { type: "text" },
        image: { type: "upload", relationTo: "media" },
      },
    };
    // An upload reference carrying an unserializable extra still fails.
    const reference: Record<string, unknown> = { relationTo: "media" };
    reference.self = reference;
    expect(
      await validateBlockPropValues({ image: reference }, source)
    ).not.toEqual([]);
  });

  it("does not add a second issue where a type rule already spoke", async () => {
    const source: BlockPropsSource = { props: { count: { type: "number" } } };
    const issues = await validateBlockPropValues({ count: Number.NaN }, source);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("INVALID_TYPE");
  });
});

describe("blockPropsToFieldConfigs choices", () => {
  it("rejects an empty label or stored value", () => {
    // The shared rules read "" as absent, so such an option could never be
    // selected and would be indistinguishable from leaving the prop unset.
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            level: { type: "select", options: [{ label: "None", value: "" }] },
          },
        })
      )
    ).toEqual([{ path: "level", code: "INVALID_OPTIONS" }]);
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            level: { type: "radio", options: [{ label: "", value: "h1" }] },
          },
        })
      )
    ).toEqual([{ path: "level", code: "INVALID_OPTIONS" }]);
  });

  it("rejects a whitespace-only label or value", () => {
    // The shared rules trim before deciding emptiness, so a blank value is
    // read as absent exactly like an empty one.
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            level: { type: "select", options: [{ label: "Sp", value: "   " }] },
          },
        })
      )
    ).toEqual([{ path: "level", code: "INVALID_OPTIONS" }]);
  });

  it("rejects two options sharing a stored value", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            level: {
              type: "select",
              options: [
                { label: "Heading", value: "h1" },
                { label: "Title", value: "h1" },
              ],
            },
          },
        })
      )
    ).toEqual([{ path: "level", code: "DUPLICATE_OPTION" }]);
  });

  it("accepts distinct non-empty choices", () => {
    const configs = blockPropsToFieldConfigs({
      props: {
        level: {
          type: "select",
          options: [
            { label: "H1", value: "h1" },
            { label: "H2", value: "h2" },
          ],
        },
      },
    });
    expect(configs[0]).toMatchObject({ type: "select" });
  });
});

describe("block prop names", () => {
  it("refuses a name that shadows an Object.prototype member", () => {
    for (const reserved of ["toString", "constructor", "hasOwnProperty"]) {
      expect(
        issuesOf(() =>
          blockPropsToFieldConfigs({ props: { [reserved]: { type: "text" } } })
        ),
        reserved
      ).toEqual([{ path: reserved, code: "RESERVED_NAME" }]);
    }
  });

  it("refuses a reserved name nested inside a structured prop", () => {
    expect(
      issuesOf(() =>
        blockPropsToFieldConfigs({
          props: {
            meta: { type: "group", fields: { valueOf: { type: "text" } } },
          },
        })
      )
    ).toEqual([{ path: "meta.valueOf", code: "RESERVED_NAME" }]);
  });
});

describe("validateBlockPropValues stored-document safety", () => {
  it("checks props the declaration does not cover", async () => {
    // A stored node can carry a key no current declaration knows about; it is
    // written into the same document, so it answers to the same rule.
    const source: BlockPropsSource = { props: { title: { type: "text" } } };
    const issues = await validateBlockPropValues(
      { title: "ok", legacyExtra: () => 1 },
      source
    );
    expect(issues).toEqual([
      {
        path: "legacyExtra",
        code: "NOT_SERIALIZABLE",
        message: expect.stringContaining("legacyExtra"),
      },
    ]);
  });

  it("rejects values JSON reshapes instead of rejecting", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    // A Map encodes as {} and a Set as {}, losing their contents silently.
    expect(
      await validateBlockPropValues({ data: new Map([["a", 1]]) }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ data: { inner: new Set([1]) } }, source)
    ).toHaveLength(1);
  });

  it("accepts a value that defines its own encoded form", async () => {
    // A Date chooses an ISO string through toJSON, which is exactly how dates
    // are stored, so it is not a reshaping loss.
    const source: BlockPropsSource = { props: { when: { type: "date" } } };
    expect(
      await validateBlockPropValues({ when: new Date("2026-01-01") }, source)
    ).toEqual([]);
  });

  it("reports one issue for an empty list on a scalar choice", async () => {
    const source: BlockPropsSource = {
      props: {
        level: {
          type: "select",
          options: [{ label: "H1", value: "h1" }],
        },
      },
    };
    const issues = await validateBlockPropValues({ level: [] }, source);
    expect(issues).toHaveLength(1);
  });
});

describe("blockPropsToFieldConfigs reference bounds", () => {
  it("accepts and enforces row bounds on a multi-reference prop", async () => {
    const source: BlockPropsSource = {
      props: {
        gallery: {
          type: "upload",
          relationTo: "media",
          hasMany: true,
          minRows: 2,
          maxRows: 3,
        },
      },
    };
    const configs = blockPropsToFieldConfigs(source);
    expect(configs[0]).toMatchObject({ minRows: 2, maxRows: 3 });
    expect(
      await validateBlockPropValues({ gallery: ["a"] }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ gallery: ["a", "b", "c", "d"] }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ gallery: ["a", "b"] }, source)
    ).toEqual([]);
  });
});

describe("blockPropsToFieldConfigs list-only options", () => {
  it("refuses row bounds on a prop that holds one value", () => {
    // The bounds would constrain nothing, which is the failure mode this
    // module exists to prevent: a declaration advertising an unenforced rule.
    for (const declaration of [
      { type: "text", minRows: 2 },
      { type: "number", maxRows: 3 },
      { type: "upload", relationTo: "media", minRows: 1 },
      { type: "relationship", relationTo: "posts", maxRows: 2 },
    ]) {
      expect(
        issuesOf(() => blockPropsToFieldConfigs({ props: { p: declaration } })),
        declaration.type
      ).toEqual([{ path: "p", code: "INVALID_OPTION" }]);
    }
  });

  it("still accepts them on a list-shaped prop", () => {
    const configs = blockPropsToFieldConfigs({
      props: { tags: { type: "text", hasMany: true, minRows: 1, maxRows: 4 } },
    });
    expect(configs[0]).toMatchObject({ minRows: 1, maxRows: 4 });
  });

  it("leaves a repeater's own bounds alone", () => {
    const configs = blockPropsToFieldConfigs({
      props: {
        items: {
          type: "repeater",
          fields: { note: { type: "text" } },
          minRows: 1,
          maxRows: 2,
        },
      },
    });
    expect(configs[0]).toMatchObject({ minRows: 1, maxRows: 2 });
  });
});

describe("validateBlockPropValues skipped sentinels", () => {
  it("rejects a blank string where the prop cannot hold text", async () => {
    const source: BlockPropsSource = {
      props: {
        count: { type: "number" },
        rows: { type: "repeater", fields: { note: { type: "text" } } },
        image: { type: "upload", relationTo: "media" },
        flag: { type: "checkbox" },
      },
    };
    const issues = await validateBlockPropValues(
      { count: "", rows: "", image: "   ", flag: "" },
      source
    );
    expect(issues.map(issue => issue.path).sort()).toEqual([
      "count",
      "flag",
      "image",
      "rows",
    ]);
    expect(issues.every(issue => issue.code === "INVALID_TYPE")).toBe(true);
  });

  it("leaves a blank string alone where the prop does hold text", async () => {
    const source: BlockPropsSource = {
      props: { title: { type: "text" }, data: { type: "json" } },
    };
    expect(
      await validateBlockPropValues({ title: "", data: "" }, source)
    ).toEqual([]);
  });

  it("enforces required on an explicitly empty list", async () => {
    // The shared rules route a provided empty list past their required check
    // so it can reach the bounds rules, so nothing else would report this.
    const source: BlockPropsSource = {
      props: {
        tags: { type: "chips", required: true },
        items: {
          type: "repeater",
          required: true,
          fields: { note: { type: "text" } },
        },
      },
    };
    const issues = await validateBlockPropValues(
      { tags: [], items: [] },
      source
    );
    expect(issues.map(issue => issue.code)).toEqual(["REQUIRED", "REQUIRED"]);
    expect(
      await validateBlockPropValues(
        { tags: ["a"], items: [{ note: "b" }] },
        source
      )
    ).toEqual([]);
  });

  it("rejects a value whose own encoding makes it disappear", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    // JSON.stringify returns undefined here: the prop would vanish from the
    // document rather than be stored wrongly.
    const vanishing = { toJSON: () => undefined };
    expect(
      await validateBlockPropValues({ data: vanishing }, source)
    ).toHaveLength(1);
    // Nested, the containing object survives but the key is dropped.
    expect(
      await validateBlockPropValues({ data: { inner: vanishing } }, source)
    ).toHaveLength(1);
    // A toJSON producing a value JSON cannot represent is caught the same way.
    expect(
      await validateBlockPropValues(
        { data: { toJSON: () => new Map([["a", 1]]) } },
        source
      )
    ).toHaveLength(1);
  });

  it("survives a toJSON that throws or returns a fresh object each call", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    expect(
      await validateBlockPropValues(
        {
          data: {
            toJSON: () => {
              throw new Error("no");
            },
          },
        },
        source
      )
    ).toHaveLength(1);
    // A new object per call must not make the walk run forever.
    const churning = { toJSON: () => ({ nested: { value: 1 } }) };
    expect(await validateBlockPropValues({ data: churning }, source)).toEqual(
      []
    );
  });
});

describe("validateBlockPropValues stored shapes", () => {
  it("requires document ids to be strings", async () => {
    const source: BlockPropsSource = {
      props: {
        image: { type: "upload", relationTo: "media" },
        ref: { type: "relationship", relationTo: ["posts", "pages"] },
      },
    };
    // Every canonical contract types an id as a string.
    expect(await validateBlockPropValues({ image: 42 }, source)).toHaveLength(
      1
    );
    expect(
      await validateBlockPropValues(
        { ref: { relationTo: "posts", value: 42 } },
        source
      )
    ).toHaveLength(1);
    expect(await validateBlockPropValues({ image: "  " }, source)).toHaveLength(
      1
    );
    expect(await validateBlockPropValues({ image: "m1" }, source)).toEqual([]);
  });

  it("requires a rich-text envelope to be a stored JSON shape", async () => {
    const source: BlockPropsSource = { props: { body: { type: "richText" } } };
    // A class instance with the right keys encodes to whatever its own toJSON
    // decides, so the renderer would read back something else entirely.
    const disguised = Object.assign(new Date("2026-01-01"), {
      root: { type: "root", children: [] },
    });
    expect(
      await validateBlockPropValues({ body: disguised }, source)
    ).not.toEqual([]);
    expect(
      await validateBlockPropValues(
        { body: { root: { type: "root", children: [] } } },
        source
      )
    ).toEqual([]);
  });

  it("encodes an array through its own toJSON when it declares one", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    // Stored as [null], so the declared elements are not what persists.
    const lying = Object.assign([1, 2], { toJSON: () => [undefined] });
    expect(await validateBlockPropValues({ data: lying }, source)).toHaveLength(
      1
    );
    // The reverse: unsafe-looking elements, safe encoded output.
    const safe = Object.assign([() => 1], { toJSON: () => [1] });
    expect(await validateBlockPropValues({ data: safe }, source)).toEqual([]);
  });
});

describe("validateBlockPropValues stored-form fidelity", () => {
  it("validates only the props record's own keys", async () => {
    // An inherited value satisfies `field.name in data` but encodes to
    // nothing, so a required prop would pass while storing an empty object.
    const source: BlockPropsSource = {
      props: { title: { type: "text", required: true } },
    };
    const inherited = Object.create({ title: "inherited" }) as Record<
      string,
      unknown
    >;
    const issues = await validateBlockPropValues(inherited, source);
    expect(issues.map(issue => issue.code)).toEqual(["REQUIRED"]);
  });

  it("passes the containing key to a serializer that reads it", async () => {
    const source: BlockPropsSource = { props: { data: { type: "json" } } };
    // Encoding calls toJSON("data"), which drops the prop; calling it bare
    // would have made this look safe.
    const keySensitive = {
      toJSON: (key?: string) => (key === "data" ? undefined : { ok: true }),
    };
    expect(
      await validateBlockPropValues({ data: keySensitive }, source)
    ).toHaveLength(1);
  });

  it("refuses a shape-constrained record that replaces itself on encode", async () => {
    const source: BlockPropsSource = {
      props: {
        meta: { type: "group", fields: { child: { type: "text" } } },
        items: {
          type: "repeater",
          fields: { child: { type: "text" } },
        },
        body: { type: "richText" },
      },
    };
    // Each of these satisfies its declared shape and stores something else.
    expect(
      await validateBlockPropValues(
        { meta: { child: "ok", toJSON: () => "lost" } },
        source
      )
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        { items: [{ child: "ok", toJSON: () => "lost" }] },
        source
      )
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues(
        {
          body: {
            root: { type: "root", children: [] },
            toJSON: () => "lost",
          },
        },
        source
      )
    ).toHaveLength(1);
  });

  it("rejects a sparse array, whose holes encode as null", async () => {
    const source: BlockPropsSource = {
      props: { tags: { type: "chips" }, data: { type: "json" } },
    };
    const sparse: unknown[] = [];
    sparse[2] = "a";
    // Array methods skip the holes; encoding writes them as null.
    expect(
      await validateBlockPropValues({ tags: sparse }, source)
    ).toHaveLength(1);
    expect(
      await validateBlockPropValues({ data: sparse }, source)
    ).toHaveLength(1);
    expect(await validateBlockPropValues({ tags: ["a", "b"] }, source)).toEqual(
      []
    );
  });

  it("reports one issue when the container shape itself is wrong", async () => {
    const source: BlockPropsSource = {
      props: {
        tags: { type: "chips" },
        meta: { type: "group", fields: { child: { type: "text" } } },
      },
    };
    // The shared rules own the container-shape failure; the element and
    // record checks must not restate it.
    expect(await validateBlockPropValues({ tags: 123 }, source)).toHaveLength(
      1
    );
    expect(await validateBlockPropValues({ meta: 123 }, source)).toHaveLength(
      1
    );
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
    // The prop keeps its name, validates as the storage primitive the plugin
    // declared, and carries the contributed type so an inspector can still
    // dispatch the plugin's own component instead of the number control.
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      name: "score",
      type: "number",
      min: 1,
      max: 5,
      custom: { pluginFieldType: "rating" },
    });
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
