/**
 * A collection list's query, judged at save: its bounds, filter rows and
 * sort by their shape always, the fields they name against the schema when
 * the caller can answer for it, and how deep related lists nest.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape } from "./binding-rules";
import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import {
  COLLECTION_LIST_TYPE,
  LIST_ISSUE_CODES,
  readListQuery,
  type ListFields,
  type ListFieldSource,
} from "./list-query";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";
import {
  ISSUE_CODES,
  validate,
  type ValidationContext,
  type ValidationIssue,
} from "./validation";

/** Each collection's fields: every one declared, and the public's. */
function fieldsOf(
  readable: readonly BindingFieldShape[],
  hidden: readonly string[] = []
): ListFields {
  return {
    declared: new Set([
      "id",
      "createdAt",
      ...readable.map(field => field.name),
      ...hidden,
    ]),
    readable: [{ name: "id", type: "text" }, ...readable],
  };
}

const FIELDS: Readonly<Record<string, ListFields>> = {
  posts: fieldsOf(
    [
      { name: "title", type: "text" },
      { name: "publishedAt", type: "date" },
      {
        name: "categories",
        type: "relationship",
        relationTo: "categories",
        hasMany: true,
      },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "tags", type: "text", hasMany: true },
    ],
    ["internalScore", "editorNotes"]
  ),
  categories: fieldsOf([
    { name: "name", type: "text" },
    {
      name: "featuredPosts",
      type: "relationship",
      relationTo: "posts",
      hasMany: true,
    },
  ]),
};

const fields: ListFieldSource = {
  fieldsOf: collection => FIELDS[collection],
};

function list(
  id: string,
  props: Record<string, unknown>,
  children: unknown[] = []
): Record<string, unknown> {
  return {
    id,
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props,
    slots: { children },
  };
}

function page(...nodes: unknown[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

const shapeOnly: ValidationContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  mode: "forgiving",
};

const withSchema: ValidationContext = { ...shapeOnly, listFields: fields };

function listIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter(issue => issue.code.startsWith("list-"));
}

describe("a collection list's query at save", () => {
  it("lists every list code in the issue vocabulary", () => {
    for (const [code, description] of Object.entries(LIST_ISSUE_CODES)) {
      expect(ISSUE_CODES).toHaveProperty(code, description);
    }
  });

  it("accepts a list stored before queries had filters, offset or relations", () => {
    const issues = validate(
      page(list("old", { collection: "posts", limit: 10, sort: "-title" })),
      withSchema
    );
    expect(listIssues(issues)).toEqual([]);
  });

  it("accepts a full query of public fields", () => {
    const issues = validate(
      page(
        list("full", {
          collection: "posts",
          filters: [
            { field: "title", op: "contains", value: "build" },
            {
              field: "publishedAt",
              op: "greater_than_equal",
              value: "2026-09-01",
            },
            { field: "categories", op: "in", value: ["news", "guides"] },
            { field: "author", op: "exists", value: true },
          ],
          sort: "-publishedAt,title",
          limit: 6,
          offset: 0,
        })
      ),
      withSchema
    );
    expect(listIssues(issues)).toEqual([]);
  });

  it.each([
    ["an offset of -1", { offset: -1 }, "list-offset-invalid", "/offset"],
    ["a fractional offset", { offset: 1.5 }, "list-offset-invalid", "/offset"],
    ["a limit of 0", { limit: 0 }, "list-limit-invalid", "/limit"],
    ["a limit of 101", { limit: 101 }, "list-limit-invalid", "/limit"],
    ["a limit given as text", { limit: "10" }, "list-limit-invalid", "/limit"],
  ])("refuses %s", (_, props, code, prop) => {
    const issues = listIssues(
      validate(page(list("l", { collection: "posts", ...props })), shapeOnly)
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code,
        severity: "error",
        path: `/nodes/0/props${prop}`,
      }),
    ]);
  });

  it("accepts the bounds themselves", () => {
    for (const props of [
      { limit: 1, offset: 0 },
      { limit: 100, offset: 5000 },
    ]) {
      expect(
        listIssues(
          validate(
            page(list("l", { collection: "posts", ...props })),
            shapeOnly
          )
        )
      ).toEqual([]);
    }
  });

  it.each([
    ["an operator outside the set", { field: "title", op: "like", value: "a" }],
    [
      "a value an exists row does not take",
      { field: "title", op: "exists", value: "yes" },
    ],
    ["an empty any-of list", { field: "title", op: "in", value: [] }],
    [
      "text where an order compares",
      { field: "publishedAt", op: "less_than", value: "soon" },
    ],
    [
      "a day that does not exist",
      { field: "publishedAt", op: "less_than", value: "2026-02-30" },
    ],
    [
      "a field that is a path",
      { field: "author.name", op: "equals", value: "a" },
    ],
    [
      "a key a row does not take",
      { field: "title", op: "equals", value: "a", where: {} },
    ],
  ])("refuses a filter row with %s", (_, row) => {
    const issues = listIssues(
      validate(
        page(list("l", { collection: "posts", filters: [row] })),
        shapeOnly
      )
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "list-filter-invalid",
        severity: "error",
        path: "/nodes/0/props/filters",
      }),
    ]);
  });

  it("refuses a sort naming something that is not a field name", () => {
    const issues = listIssues(
      validate(
        page(list("l", { collection: "posts", sort: "title,-" })),
        shapeOnly
      )
    );
    expect(issues.map(issue => issue.code)).toEqual(["list-sort-invalid"]);
  });

  it("refuses an unknown sort or filter field, naming it", () => {
    const issues = listIssues(
      validate(
        page(
          list("l", {
            collection: "posts",
            sort: "-rating",
            filters: [{ field: "readingTime", op: "less_than", value: 5 }],
          })
        ),
        withSchema
      )
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "list-field-unknown",
        severity: "error",
        path: "/nodes/0/props/filters",
        message: expect.stringContaining('"readingTime"'),
      }),
      expect.objectContaining({
        code: "list-field-unknown",
        severity: "error",
        path: "/nodes/0/props/sort",
        message: expect.stringContaining('"rating"'),
      }),
    ]);
  });

  it("refuses a filter and a sort on a field the public may not read", () => {
    const issues = listIssues(
      validate(
        page(
          list("l", {
            collection: "posts",
            sort: "internalScore",
            filters: [{ field: "editorNotes", op: "exists", value: true }],
          })
        ),
        withSchema
      )
    );
    expect(issues.map(issue => [issue.code, issue.path])).toEqual([
      ["list-field-protected", "/nodes/0/props/filters"],
      ["list-field-protected", "/nodes/0/props/sort"],
    ]);
    expect(issues[1]?.message).toContain("visitors can't see");
  });

  it("does not judge fields it was given no schema for", () => {
    const issues = validate(
      page(list("l", { collection: "posts", sort: "internalScore" })),
      shapeOnly
    );
    expect(listIssues(issues)).toEqual([]);
  });

  it("refuses a sort on a field holding several values", () => {
    const issues = listIssues(
      validate(
        page(list("l", { collection: "posts", sort: "tags" })),
        withSchema
      )
    );
    expect(issues.map(issue => issue.code)).toEqual(["list-field-unsortable"]);
  });

  describe("related sources", () => {
    const entryContext: ValidationContext = {
      ...withSchema,
      bindingEntry: { collection: "posts" },
    };

    it("accepts the entry's to-many relation", () => {
      const issues = validate(
        page(
          list("cats", {
            collection: "categories",
            relation: { of: "entry", field: "categories" },
            sort: "name",
          })
        ),
        entryContext
      );
      expect(listIssues(issues)).toEqual([]);
    });

    it("accepts each outer item's relation, one level deep", () => {
      const issues = validate(
        page(
          list("posts", { collection: "posts" }, [
            list("cats", {
              collection: "categories",
              relation: { of: "item", field: "categories" },
            }),
          ])
        ),
        withSchema
      );
      expect(listIssues(issues)).toEqual([]);
    });

    it("refuses a third level, without being given the schema", () => {
      const issues = listIssues(
        validate(
          page(
            list("posts", { collection: "posts" }, [
              list(
                "cats",
                {
                  collection: "categories",
                  relation: { of: "item", field: "categories" },
                },
                [
                  list("featured", {
                    collection: "posts",
                    relation: { of: "item", field: "featuredPosts" },
                  }),
                ]
              ),
            ])
          ),
          shapeOnly
        )
      );
      expect(issues).toEqual([
        expect.objectContaining({
          code: "list-too-deep",
          severity: "error",
          path: "/nodes/0/slots/children/0/slots/children/0/props/relation",
        }),
      ]);
    });

    it("refuses an item relation outside any list", () => {
      const issues = listIssues(
        validate(
          page(
            list("cats", {
              collection: "categories",
              relation: { of: "item", field: "categories" },
            })
          ),
          shapeOnly
        )
      );
      expect(issues.map(issue => issue.code)).toEqual([
        "list-relation-invalid",
      ]);
    });

    it("refuses a relation that is not to-many, or not to the list's collection", () => {
      const notToMany = listIssues(
        validate(
          page(
            list("a", {
              collection: "authors",
              relation: { of: "entry", field: "author" },
            })
          ),
          entryContext
        )
      );
      expect(notToMany.map(issue => issue.code)).toEqual([
        "list-relation-unsuitable",
      ]);
      const otherCollection = listIssues(
        validate(
          page(
            list("c", {
              collection: "posts",
              relation: { of: "entry", field: "categories" },
            })
          ),
          entryContext
        )
      );
      expect(otherCollection).toEqual([
        expect.objectContaining({
          code: "list-relation-unsuitable",
          path: "/nodes/0/props/collection",
        }),
      ]);
    });

    it("refuses a relation with no collection or a malformed source", () => {
      for (const props of [
        { relation: { of: "entry", field: "categories" } },
        { collection: "categories", relation: { of: "page", field: "x" } },
        { collection: "categories", relation: "categories" },
      ]) {
        expect(
          listIssues(validate(page(list("c", props)), shapeOnly)).map(
            issue => issue.code
          )
        ).toEqual(["list-relation-invalid"]);
      }
    });
  });

  it("keeps a problem a stored form already held as a warning", () => {
    const stored = page(list("l", { collection: "posts", sort: "-rating" }));
    const again = validate(stored, { ...withSchema, stored: [stored] });
    expect(listIssues(again)).toEqual([
      expect.objectContaining({
        code: "list-field-unknown",
        severity: "warning",
      }),
    ]);
    // A new problem on the same list is still refused.
    const changed = page(
      list("l", { collection: "posts", sort: "-rating", limit: 0 })
    );
    expect(
      listIssues(validate(changed, { ...withSchema, stored: [stored] })).map(
        issue => [issue.code, issue.severity]
      )
    ).toEqual([
      ["list-limit-invalid", "error"],
      ["list-field-unknown", "warning"],
    ]);
  });
});

describe("readListQuery", () => {
  it("reads a stored legacy sort string as keys in order", () => {
    expect(
      readListQuery({
        collection: " posts ",
        sort: " -date , title,,",
        limit: 3,
      })
    ).toEqual({
      query: {
        collection: "posts",
        filters: [],
        sort: [
          { field: "date", descending: true },
          { field: "title", descending: false },
        ],
        limit: 3,
      },
      problems: [],
    });
  });

  it("leaves out a part stored badly and names it", () => {
    const { query, problems } = readListQuery({
      collection: "posts",
      limit: 500,
      filters: [
        { field: "title", op: "equals", value: "a" },
        { field: "title", op: "nope", value: "a" },
      ],
    });
    expect(query.limit).toBeUndefined();
    expect(query.filters).toEqual([
      { field: "title", op: "equals", value: "a" },
    ]);
    expect(problems.map(problem => problem.prop)).toEqual(["limit", "filters"]);
  });
});
