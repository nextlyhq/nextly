/**
 * Which validation issues a caller is told, by the read rules of the fields
 * they name: the shapes the integration suite does not reach — a row inside a
 * repeater, a field of a field group, an issue on the whole document and a
 * path this cannot read.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import type { ValidationIssue } from "../entry-validation";
import {
  clearFieldFunctions,
  registerFieldFunctions,
  type CallerGrants,
} from "../field-level-registry";
import {
  issuesTheReaderMaySee,
  UNREADABLE_FIELD_ISSUE,
} from "../unreadable-field-issues";

const SLUG = "reports";
const hidden = { read: () => false };

// Each field rule here decides by nothing the caller holds, so the grants are
// answered without a database.
const NO_GRANTS: CallerGrants = { permissions: [], roles: [] };
const reader = {
  user: { id: "author" },
  grants: () => Promise.resolve(NO_GRANTS),
};

const issue = (path: string, message = `${path} is invalid.`) => ({
  path,
  code: "CUSTOM",
  message,
});

function told(
  issues: ValidationIssue[],
  document: Record<string, unknown>,
  fields: FieldConfig[],
  options: {
    overrideAccess?: boolean;
    fieldGroups?: Record<string, FieldConfig[]>;
  } = {}
) {
  const groups = options.fieldGroups;
  return issuesTheReaderMaySee(issues, {
    kind: "collection",
    slug: SLUG,
    document,
    fields,
    ...(groups
      ? {
          fieldGroups: {
            getComponentFields: componentSlug =>
              Promise.resolve(groups[componentSlug] ?? null),
          },
        }
      : {}),
    reader: {
      ...reader,
      ...(options.overrideAccess === undefined
        ? {}
        : { overrideAccess: options.overrideAccess }),
    },
  });
}

afterEach(() => {
  clearFieldFunctions();
});

describe("issuesTheReaderMaySee", () => {
  const fields = [
    { name: "title", type: "text" },
    { name: "secret", type: "text", access: hidden },
    {
      name: "rows",
      type: "repeater",
      fields: [
        { name: "label", type: "text" },
        { name: "cost", type: "number", access: hidden },
      ],
    },
  ] as unknown as FieldConfig[];

  it("withholds an issue on a hidden field, and one on a hidden field of a row", async () => {
    registerFieldFunctions("collection", SLUG, fields);
    const document = {
      title: "t",
      secret: "s",
      rows: [{ label: "a", cost: 99 }],
    };

    const result = await told(
      [
        issue("title"),
        issue("secret", "Code s is not allowed."),
        issue("rows[0].label"),
        issue("rows[0].cost"),
      ],
      document,
      fields
    );

    expect(result).toEqual([
      issue("title"),
      UNREADABLE_FIELD_ISSUE,
      issue("rows[0].label"),
    ]);
    // The document the write goes on with is the one it handed in.
    expect(document).toEqual({
      title: "t",
      secret: "s",
      rows: [{ label: "a", cost: 99 }],
    });
  });

  it("withholds an issue on a hidden field the document leaves out", async () => {
    registerFieldFunctions("collection", SLUG, fields);

    expect(
      await told([issue("secret", "secret is required.")], {}, fields)
    ).toEqual([UNREADABLE_FIELD_ISSUE]);
  });

  it("keeps an issue on the whole document, and withholds a path it cannot read", async () => {
    registerFieldFunctions("collection", SLUG, fields);

    expect(
      await told([issue(""), issue("rows[x].cost")], { title: "t" }, fields)
    ).toEqual([issue(""), UNREADABLE_FIELD_ISSUE]);
  });

  it("tells trusted code every issue", async () => {
    registerFieldFunctions("collection", SLUG, fields);
    const issues = [issue("title"), issue("secret")];

    expect(
      await told(issues, { title: "t", secret: "s" }, fields, {
        overrideAccess: true,
      })
    ).toEqual(issues);
  });

  it("withholds an issue on a hidden field of a field group the document holds", async () => {
    const withGroup = [
      { name: "title", type: "text" },
      { name: "meta", type: "component", component: "meta" },
    ] as unknown as FieldConfig[];
    const metaFields = [
      { name: "summary", type: "text" },
      { name: "note", type: "text", access: hidden },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, withGroup);
    registerFieldFunctions("fieldGroup", "meta", metaFields);

    expect(
      await told(
        [issue("meta.summary"), issue("meta.note")],
        { title: "t", meta: { summary: "s", note: "n" } },
        withGroup,
        { fieldGroups: { meta: metaFields } }
      )
    ).toEqual([issue("meta.summary"), UNREADABLE_FIELD_ISSUE]);
  });
});
