/**
 * A block's visibility conditions, judged at save: the operator always, and
 * the field against the entry's or the list item's schema when the caller
 * can answer for it. The save refuses what the renderer would hide, so an
 * author is told at once rather than finding the block missing.
 */
import { describe, expect, it } from "vitest";

import type { BindingFieldShape } from "./binding-rules";
import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import {
  COLLECTION_LIST_TYPE,
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
import {
  canonicalConditions,
  CONDITION_FIELD_CODES,
  CONDITION_ISSUE_CODES,
  CONDITION_MAX,
  CONDITION_REGISTRY,
  conditionIssues,
} from "./visibility-conditions";

function fieldsOf(
  readable: readonly BindingFieldShape[],
  hidden: readonly string[] = [],
  label?: string
): ListFields {
  return {
    declared: new Set(["id", ...readable.map(field => field.name), ...hidden]),
    readable: [{ name: "id", type: "text" }, ...readable],
    ...(label === undefined ? {} : { label }),
  };
}

const FIELDS: Readonly<Record<string, ListFields>> = {
  posts: fieldsOf(
    [
      { name: "title", type: "text" },
      { name: "tier", type: "select", options: ["free", "vip"] },
      { name: "rating", type: "number" },
    ],
    ["internalScore"],
    "Posts"
  ),
  authors: fieldsOf(
    [
      { name: "name", type: "text" },
      { name: "verified", type: "checkbox" },
    ],
    ["email"],
    "Authors"
  ),
};

const fields: ListFieldSource = { fieldsOf: collection => FIELDS[collection] };

function box(id: string, conditions: unknown, children: unknown[] = []) {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    visibility: { conditions },
    slots: { children },
  };
}

function list(id: string, collection: string, children: unknown[]) {
  return {
    id,
    type: COLLECTION_LIST_TYPE,
    version: 1,
    props: { collection },
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

const onPost: ValidationContext = {
  ...shapeOnly,
  listFields: fields,
  bindingEntry: { collection: "posts" },
};

function conditionCodes(issues: readonly ValidationIssue[]): string[] {
  return issues
    .filter(issue => issue.code.startsWith("condition-"))
    .map(issue => `${issue.code} ${issue.severity} ${issue.path}`);
}

describe("a block's conditions at save", () => {
  it("lists every condition code in the issue vocabulary", () => {
    for (const [code, description] of Object.entries(CONDITION_ISSUE_CODES)) {
      expect(ISSUE_CODES).toHaveProperty(code, description);
    }
  });

  it("accepts conditions on the entry's public fields, older spellings included", () => {
    const issues = validate(
      page(
        box("a", [
          [
            { field: "tier", op: "equals", value: "vip" },
            { field: "rating", op: "gt", value: 3 },
          ],
        ])
      ),
      onPost
    );
    expect(conditionCodes(issues)).toEqual([]);
  });

  it("refuses an unknown operator without a schema", () => {
    const issues = validate(
      page(box("a", [[{ field: "tier", op: "matches", value: "v" }]])),
      shapeOnly
    );
    expect(conditionCodes(issues)).toEqual([
      "condition-op-unknown error /nodes/0/visibility/conditions/0/0",
    ]);
  });

  it("judges fields by their shape alone without a schema", () => {
    const issues = validate(
      page(box("a", [[{ field: "internalScore", op: "gt", value: 3 }]])),
      shapeOnly
    );
    expect(conditionCodes(issues)).toEqual([]);
  });

  it("refuses a field the public may not read", () => {
    const issues = validate(
      page(
        box("a", [[{ field: "internalScore", op: "greater_than", value: 3 }]])
      ),
      onPost
    );
    expect(conditionCodes(issues)).toEqual([
      "condition-field-protected error /nodes/0/visibility/conditions/0/0",
    ]);
    expect(
      issues.find(issue => issue.code === "condition-field-protected")?.message
    ).toContain("visitors can't see");
  });

  it("refuses an unknown field, and a field whose kind does not take the operator or value", () => {
    const issues = validate(
      page(
        box("a", [
          [
            { field: "nope", op: "exists" },
            { field: "title", op: "greater_than", value: 3 },
            { field: "tier", op: "equals", value: "gold" },
          ],
        ])
      ),
      onPost
    );
    expect(conditionCodes(issues)).toEqual([
      "condition-field-unknown error /nodes/0/visibility/conditions/0/0",
      "condition-unsuited error /nodes/0/visibility/conditions/0/1",
      "condition-unsuited error /nodes/0/visibility/conditions/0/2",
    ]);
  });

  it("judges a block inside a list against the list item's fields", () => {
    const doc = page(
      list("l", "authors", [
        box("in", [
          [
            { field: "verified", op: "is_true" },
            { field: "email", op: "exists" },
            { field: "tier", op: "equals", value: "vip" },
          ],
        ]),
      ])
    );
    expect(conditionCodes(validate(doc, onPost))).toEqual([
      "condition-field-protected error /nodes/0/slots/children/0/visibility/conditions/0/1",
      "condition-field-unknown error /nodes/0/slots/children/0/visibility/conditions/0/2",
    ]);
  });

  it("refuses more conditions than a block may hold", () => {
    const group = Array.from({ length: CONDITION_MAX + 1 }, () => ({
      field: "title",
      op: "exists",
    }));
    expect(conditionCodes(validate(page(box("a", [group])), onPost))).toEqual([
      "condition-too-many error /nodes/0/visibility/conditions",
    ]);
  });

  it("refuses a field path, since a condition names one field", () => {
    const issues = validate(
      page(box("a", [[{ field: "author.name", op: "exists" }]])),
      onPost
    );
    expect(conditionCodes(issues)).toEqual([
      "condition-malformed error /nodes/0/visibility/conditions",
    ]);
    // The older shape check still holds for its own cases, without a second code.
    const broken = validate(page(box("b", "vip")), onPost);
    expect(conditionCodes(broken)).toEqual([]);
    expect(broken.map(issue => issue.code)).toContain("invalid-visibility");
  });

  it("warns, rather than refuses, a problem the stored page already held", () => {
    const doc = page(box("a", [[{ field: "internalScore", op: "exists" }]]));
    const issues = validate(doc, { ...onPost, stored: [doc] });
    expect(conditionCodes(issues)).toEqual([
      "condition-field-protected warning /nodes/0/visibility/conditions/0/0",
    ]);
  });

  it("names the block each finding is about", () => {
    const found = conditionIssues(
      page(
        list("l", "authors", [box("in", [[{ field: "email", op: "exists" }]])])
      ).nodes,
      { fields, entryCollection: "posts" }
    );
    expect(found).toEqual([
      expect.objectContaining({
        nodeId: "in",
        code: "condition-field-protected",
        severity: "error",
      }),
    ]);
  });

  it("leaves conditions that restrict nobody alone", () => {
    const issues = validate(
      page(box("a", [[], [{ field: "x", op: "bogus" }]])),
      onPost
    );
    expect(conditionCodes(issues)).toEqual([]);
  });

  it("refuses a source the registry decides on each visit, as the page would hide it", () => {
    const perVisit = {
      ...CONDITION_REGISTRY,
      sources: { ...CONDITION_REGISTRY.sources, entry: "request" as const },
    };
    const found = conditionIssues(
      page(box("a", [[{ field: "tier", op: "equals", value: "vip" }]])).nodes,
      { fields, entryCollection: "posts", registry: perVisit }
    );
    expect(found.map(issue => `${issue.code} ${issue.severity}`)).toEqual([
      "condition-not-static error",
    ]);
  });

  it("refuses a condition on the entry of a page that has none, but not on a list's item there", () => {
    const doc = page(
      box("a", [[{ field: "tier", op: "exists" }]]),
      list("l", "authors", [box("in", [[{ field: "name", op: "exists" }]])])
    );
    const onSingle: ValidationContext = {
      ...shapeOnly,
      listFields: fields,
      bindingEntry: { single: "home" },
    };
    expect(conditionCodes(validate(doc, onSingle))).toEqual([
      "condition-source-unavailable error /nodes/0/visibility/conditions",
    ]);
  });

  it("judges a block in a list's empty state against the page's entry, not the item", () => {
    const empty = {
      ...list("l", "authors", []),
      slots: {
        children: [],
        empty: [box("e", [[{ field: "tier", op: "equals", value: "vip" }]])],
      },
    };
    expect(conditionCodes(validate(page(empty), onPost))).toEqual([]);
    const wrong = {
      ...empty,
      slots: {
        children: [],
        empty: [box("e", [[{ field: "verified", op: "is_true" }]])],
      },
    };
    expect(conditionCodes(validate(page(wrong), onPost))).toEqual([
      "condition-field-unknown error /nodes/0/slots/empty/0/visibility/conditions/0/0",
    ]);
  });

  it("warns, rather than refuses, a field path the stored page already held", () => {
    const doc = page(box("a", [[{ field: "author.name", op: "exists" }]]));
    expect(conditionCodes(validate(doc, { ...onPost, stored: [doc] }))).toEqual(
      ["condition-malformed warning /nodes/0/visibility/conditions"]
    );
  });

  it("keeps a held problem a warning when a group added beside it renames its place", () => {
    const held = { field: "internalScore", op: "exists" };
    const stored = page(box("a", [[held]]));
    const edited = page(
      box("a", [[held], [{ field: "tier", op: "equals", value: "vip" }]])
    );
    expect(
      conditionCodes(validate(edited, { ...onPost, stored: [stored] }))
    ).toEqual([
      "condition-field-protected warning /nodes/0/visibility/conditions/0/0",
    ]);
    // A different value on the same field is a new problem, not the held one.
    const changed = page(box("a", [[{ ...held, op: "not_exists" }]]));
    expect(
      conditionCodes(validate(changed, { ...onPost, stored: [stored] }))
    ).toEqual([
      "condition-field-protected error /nodes/0/visibility/conditions/0/0",
    ]);
  });

  it("names only codes a schema or host decides as field codes", () => {
    expect([...CONDITION_FIELD_CODES].sort()).toEqual([
      "condition-field-protected",
      "condition-field-unknown",
      "condition-source-unavailable",
      "condition-unsuited",
    ]);
  });

  it("keeps a held problem a warning once its older spelling is rewritten", () => {
    const storedConditions = [[{ field: "internalScore", op: "gt", value: 3 }]];
    const stored = page(box("a", storedConditions));
    const rewritten = page(
      box("a", canonicalConditions(storedConditions).conditions)
    );
    expect(
      conditionCodes(validate(rewritten, { ...onPost, stored: [stored] }))
    ).toEqual([
      "condition-field-protected warning /nodes/0/visibility/conditions/0/0",
    ]);
  });

  it("holds one current problem per stored one, so a copy added beside it is refused", () => {
    const held = { field: "internalScore", op: "exists" };
    const stored = page(box("a", [[held]]));
    const doubled = page(box("a", [[held, held]]));
    expect(
      conditionCodes(validate(doubled, { ...onPost, stored: [stored] }))
    ).toEqual([
      "condition-field-protected warning /nodes/0/visibility/conditions/0/0",
      "condition-field-protected error /nodes/0/visibility/conditions/0/1",
    ]);
  });
});
