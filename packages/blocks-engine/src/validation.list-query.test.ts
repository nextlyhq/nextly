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
  isListFieldKind,
  isListFilterOp,
  LIST_FIELD_KINDS,
  LIST_ISSUE_CODES,
  LIST_KIND_OPS,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  listFieldKind,
  listKindSortable,
  listQueryIssues,
  listRelationTarget,
  listSortText,
  outerListOf,
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
      { name: "views", type: "number" },
      { name: "startsAt", type: "date", timeOnly: true },
      { name: "body", type: "richText" },
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
            { field: "author", op: "in", value: ["a1", "a2"] },
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

  it("names a collection in its words by the name authors read it by", () => {
    const named: ListFieldSource = {
      fieldsOf: collection => {
        const found = FIELDS[collection];
        return found === undefined
          ? undefined
          : {
              ...found,
              label: collection === "posts" ? "Posts" : "Categories",
            };
      },
    };
    const [unknown] = listIssues(
      validate(page(list("l", { collection: "posts", sort: "-rating" })), {
        ...shapeOnly,
        listFields: named,
      })
    );
    expect(unknown?.message).toBe(
      'This list sorts by "rating", which Posts doesn\'t have. Choose another field.'
    );
    // Absent a name, the slug stands in.
    const [bare] = listIssues(
      validate(
        page(list("l", { collection: "posts", sort: "-rating" })),
        withSchema
      )
    );
    expect(bare?.message).toBe(
      'This list sorts by "rating", which posts doesn\'t have. Choose another field.'
    );
    const [other] = listIssues(
      validate(
        page(
          list("c", {
            collection: "posts",
            relation: { of: "entry", field: "categories" },
          })
        ),
        {
          ...shapeOnly,
          listFields: named,
          bindingEntry: { collection: "posts" },
        }
      )
    );
    expect(other?.message).toBe(
      '"categories" holds entries of Categories, not of Posts. Choose the list\'s source again.'
    );
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

  it("refuses a filter on a field holding several values", () => {
    // `in` on a has-many relation matches nothing on any database rather
    // than reading as "includes any of", so such a filter is refused.
    const issues = listIssues(
      validate(
        page(
          list("l", {
            collection: "posts",
            filters: [{ field: "categories", op: "in", value: ["c1"] }],
          })
        ),
        withSchema
      )
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "list-field-unfilterable",
        path: "/nodes/0/props/filters",
        message: expect.stringContaining('"categories"'),
      }),
    ]);
  });

  it("refuses a filter comparing a field in a way its kind does not take", () => {
    // A day-shaped value is a date only on a field holding a date: on text
    // it is text, and an order on text is not one the list offers.
    const judged = (filters: unknown[]) =>
      listIssues(
        validate(page(list("l", { collection: "posts", filters })), withSchema)
      ).map(issue => [issue.code, issue.message]);
    expect(
      judged([{ field: "title", op: "greater_than", value: "2026-09-01" }])
    ).toEqual([
      [
        "list-filter-unsuited",
        'Filter 1 compares "title" with "greater_than", which a text field doesn\'t take.',
      ],
    ]);
    expect(
      judged([{ field: "publishedAt", op: "less_than", value: 5 }])
    ).toEqual([
      [
        "list-filter-unsuited",
        'Filter 1 compares "publishedAt", which holds a date, with 5. Choose a day, written YYYY-MM-DD.',
      ],
    ]);
    expect(
      judged([
        { field: "publishedAt", op: "greater_than", value: "2026-09-01" },
        { field: "title", op: "contains", value: "2026-09-01" },
      ])
    ).toEqual([]);
  });

  it("offers each kind exactly the operators its judgement takes", () => {
    for (const kind of LIST_FIELD_KINDS) {
      expect(LIST_KIND_OPS[kind].every(isListFilterOp)).toBe(true);
    }
    expect(LIST_KIND_OPS.text).not.toContain("greater_than");
    expect(LIST_KIND_OPS.date).not.toContain("contains");
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

  it("refuses a filter or a sort on a field no list offers, as the editor offers none", () => {
    // A time of day and rich text have no one value a list compares, and a
    // relation orders by its stored id, so the editor offers none of them.
    const judged = (props: Record<string, unknown>) =>
      listIssues(
        validate(page(list("l", { collection: "posts", ...props })), withSchema)
      ).map(issue => [issue.code, issue.message]);
    expect(judged({ sort: "author" })).toEqual([
      [
        "list-field-unsortable",
        'This list sorts by "author", which links to another entry, so it has no order an author could mean. Choose another field.',
      ],
    ]);
    expect(
      judged({
        filters: [{ field: "startsAt", op: "exists", value: true }],
        sort: "body",
      })
    ).toEqual([
      [
        "list-field-unfilterable",
        'This list filters by "startsAt", which holds a value a list cannot compare, such as a time of day, rich text or media. Choose another field.',
      ],
      [
        "list-field-unsortable",
        'This list sorts by "body", which holds a value a list cannot order by, such as a time of day, rich text or media. Choose another field.',
      ],
    ]);
    // The editor's own offer is still accepted.
    expect(
      judged({
        filters: [{ field: "author", op: "equals", value: "a1" }],
        sort: "-views,title",
      })
    ).toEqual([]);
  });

  it("refuses a number filter compared with anything but a number", () => {
    const judged = (filters: unknown[]) =>
      listIssues(
        validate(page(list("l", { collection: "posts", filters })), withSchema)
      ).map(issue => [issue.code, issue.message]);
    expect(
      judged([
        { field: "views", op: "equals", value: "5" },
        { field: "views", op: "not_equals", value: true },
      ])
    ).toEqual([
      [
        "list-filter-unsuited",
        'Filter 1 compares "views", which holds a number, with "5". Choose a number.',
      ],
      [
        "list-filter-unsuited",
        'Filter 2 compares "views", which holds a number, with true. Choose a number.',
      ],
    ]);
    expect(
      judged([
        { field: "views", op: "equals", value: 5 },
        { field: "views", op: "exists", value: false },
      ])
    ).toEqual([]);
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

    it("judges a list in another's empty state by the item that list sits in, as it draws", () => {
      // A list's empty state is drawn with no entry of its own, so a list
      // there shows the related entries of the item around the outer list,
      // never of an entry the outer list did not find.
      const inEmpty = (inner: Record<string, unknown>, around?: unknown) => {
        const outer = {
          ...list("cats", { collection: "categories" }),
          slots: { children: [], empty: [list("inner", inner)] },
        };
        return listIssues(
          validate(
            page(
              around === undefined
                ? outer
                : list("posts", { collection: "posts" }, [outer])
            ),
            withSchema
          )
        ).map(issue => [issue.code, issue.path]);
      };
      const featured = {
        collection: "posts",
        relation: { of: "item", field: "featuredPosts" },
      };
      expect(inEmpty(featured)).toEqual([
        ["list-relation-invalid", "/nodes/0/slots/empty/0/props/relation"],
      ]);
      // Inside a list of posts, the item is a post, which has no
      // featuredPosts, and its categories are what the empty state reads.
      expect(inEmpty(featured, "posts")).toEqual([
        [
          "list-field-unknown",
          "/nodes/0/slots/children/0/slots/empty/0/props/relation",
        ],
      ]);
      expect(
        inEmpty(
          {
            collection: "categories",
            relation: { of: "item", field: "categories" },
          },
          "posts"
        )
      ).toEqual([]);
    });

    it("refuses the entry's relation on a page that is no collection's entry", () => {
      const issues = listIssues(
        validate(
          page(
            list("cats", {
              collection: "categories",
              relation: { of: "entry", field: "categories" },
            })
          ),
          { ...withSchema, bindingEntry: { single: "home" } }
        )
      );
      expect(issues.map(issue => [issue.code, issue.message])).toEqual([
        [
          "list-relation-no-entry",
          "This page isn't an entry in a collection, so it has no related entries to show. Choose a collection.",
        ],
      ]);
      // Not knowing the page is still judged by shape alone.
      expect(
        listQueryIssues(
          [
            list("cats", {
              collection: "categories",
              relation: { of: "entry", field: "categories" },
            }),
          ],
          { fields }
        )
      ).toEqual([]);
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

  it("holds a sort to the most keys and characters a list stores", () => {
    const keys = (count: number, name = "title") =>
      Array.from({ length: count }, (_, index) => `${name}${String(index)}`);
    // The most a list holds: every key naming a 63-character column.
    const widest = keys(LIST_MAX_SORT_KEYS, "f".repeat(61)).join(",");
    expect(readListQuery({ sort: widest }).problems).toEqual([]);
    expect(readListQuery({ sort: widest }).query.sort).toHaveLength(
      LIST_MAX_SORT_KEYS
    );
    // One key more, and the same keys padded past the length, read as no
    // sort, told apart from none by the problem.
    const tooMany = readListQuery({
      sort: keys(LIST_MAX_SORT_KEYS + 1).join(","),
    });
    expect(tooMany.query.sort).toEqual([]);
    expect(tooMany.problems).toEqual([
      {
        prop: "sort",
        code: "list-sort-invalid",
        message: `A list sorts by at most ${String(LIST_MAX_SORT_KEYS)} fields; this one sorts by ${String(LIST_MAX_SORT_KEYS + 1)}.`,
      },
    ]);
    const padded = `title${" ".repeat(LIST_MAX_SORT_LENGTH)},`;
    expect(readListQuery({ sort: padded }).problems).toEqual([
      {
        prop: "sort",
        code: "list-sort-invalid",
        message: `A list's sort holds at most ${String(LIST_MAX_SORT_LENGTH)} characters; this one holds ${String(padded.length)}.`,
      },
    ]);
  });
});

describe("listSortText", () => {
  it("writes keys as the stored comma string that reads back as the same keys", () => {
    const keys = [
      { field: "publishedAt", descending: true },
      { field: "title", descending: false },
    ];
    const text = listSortText(keys);
    expect(text).toBe("-publishedAt,title");
    expect(readListQuery({ sort: text }).query.sort).toEqual(keys);
  });

  it("writes nothing for no keys, which removes the sort", () => {
    expect(listSortText([])).toBeUndefined();
  });
});

describe("a list field's kind", () => {
  it("names each scalar a list filters by, from the binding vocabulary", () => {
    const kinds = [
      { name: "a", type: "text" },
      { name: "b", type: "email" },
      { name: "c", type: "number" },
      { name: "d", type: "date" },
      { name: "e", type: "select", options: ["x"] },
      { name: "f", type: "radio", options: ["x"] },
      { name: "g", type: "checkbox" },
      { name: "h", type: "relationship", relationTo: "authors" },
    ].map(listFieldKind);
    expect(kinds).toEqual([
      "text",
      "text",
      "number",
      "date",
      "choice",
      "choice",
      "boolean",
      "entry",
    ]);
  });

  it("offers none for a field holding several values, a time of day or no scalar", () => {
    expect(
      [
        { name: "a", type: "text", hasMany: true },
        {
          name: "b",
          type: "relationship",
          relationTo: "tags",
          hasMany: true,
        },
        { name: "c", type: "date", timeOnly: true },
        { name: "d", type: "richText" },
        { name: "e", type: "json" },
        { name: "f", type: "upload", relationTo: "media" },
        { name: "g", type: "relationship", relationTo: ["a", "b"] },
        { name: "h", type: "group" },
      ].map(listFieldKind)
    ).toEqual(Array(8).fill(undefined));
  });

  it("reads a kind off the wire only when it is one of the set", () => {
    expect(isListFieldKind("choice")).toBe(true);
    expect(isListFieldKind("relationship")).toBe(false);
    expect(isListFieldKind(undefined)).toBe(false);
  });

  it("sorts by every kind but a relation", () => {
    expect(listKindSortable("date")).toBe(true);
    expect(listKindSortable("entry")).toBe(false);
  });
});

describe("listRelationTarget", () => {
  it("names the collection of a to-many relation, and nothing for any other field", () => {
    expect(
      listRelationTarget({
        name: "categories",
        type: "relationship",
        relationTo: "categories",
        hasMany: true,
      })
    ).toBe("categories");
    expect(
      listRelationTarget({
        name: "author",
        type: "relationship",
        relationTo: "authors",
      })
    ).toBeUndefined();
  });
});

describe("listQueryIssues", () => {
  it("names the list each issue is about, so an editor shows it there", () => {
    const issues = listQueryIssues(
      [
        list("fine", { collection: "posts", limit: 3 }),
        list("wrong", { collection: "posts", limit: 0 }),
      ],
      { fields }
    );
    expect(issues.map(issue => [issue.nodeId, issue.code])).toEqual([
      ["wrong", "list-limit-invalid"],
    ]);
  });
});

describe("outerListOf", () => {
  it("names the list whose entries hold a block, passing over an empty state", () => {
    const inner = list("inner", { collection: "categories" });
    const nodes = [
      list("posts", { collection: "posts" }, [
        {
          ...list("cats", { collection: "categories" }),
          slots: { children: [inner], empty: [list("none", {})] },
        },
      ]),
    ] as never;
    expect(outerListOf(nodes, "inner")?.id).toBe("cats");
    // The empty state is drawn with the item around its list.
    expect(outerListOf(nodes, "none")?.id).toBe("posts");
    expect(outerListOf(nodes, "cats")?.id).toBe("posts");
    expect(outerListOf(nodes, "posts")).toBeUndefined();
  });
});
