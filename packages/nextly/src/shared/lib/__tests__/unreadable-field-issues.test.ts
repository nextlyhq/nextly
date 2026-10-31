/**
 * Which validation issues a caller is told, by the read rules of the fields
 * they name: the shapes the integration suite does not reach — a row inside a
 * repeater, a field of a field group, an issue on the whole document and a
 * path this cannot read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { consoleLogger } from "../../types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { validateEntryData, type ValidationIssue } from "../entry-validation";
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
    entryId?: string;
    rowReadable?: boolean;
    tableName?: string;
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
    ...(options.entryId === undefined ? {} : { entryId: options.entryId }),
    ...(options.tableName === undefined
      ? {}
      : { tableName: options.tableName }),
    ...(options.rowReadable === undefined
      ? {}
      : { rowReadable: () => Promise.resolve(options.rowReadable === true) }),
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
  clearFieldTypes();
  vi.restoreAllMocks();
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

  it("withholds an issue inside a group the document leaves out, by the group's rule or its child's", async () => {
    const withGroups = [
      { name: "title", type: "text" },
      {
        name: "hiddenGroup",
        type: "group",
        access: hidden,
        fields: [{ name: "note", type: "text" }],
      },
      {
        name: "box",
        type: "group",
        fields: [
          { name: "label", type: "text" },
          { name: "cost", type: "number", access: hidden },
        ],
      },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, withGroups);

    expect(
      await told(
        [
          issue("hiddenGroup.note", "hiddenGroup.note is required."),
          issue("box.cost", "box.cost is required."),
          issue("box.label", "box.label is required."),
        ],
        { title: "t" },
        withGroups
      )
    ).toEqual([
      UNREADABLE_FIELD_ISSUE,
      issue("box.label", "box.label is required."),
    ]);
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
  it("judges a field named as an object's own method by the document's own value", async () => {
    const named = [
      { name: "title", type: "text" },
      { name: "toString", type: "text", access: hidden },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, named);

    expect(
      await told([issue("toString")], { title: "t", toString: "v" }, named)
    ).toEqual([UNREADABLE_FIELD_ISSUE]);
    expect(await told([issue("toString")], { title: "t" }, named)).toEqual([
      UNREADABLE_FIELD_ISSUE,
    ]);
  });

  it("hands a rule the stored entry's id where the judged document has none", async () => {
    const byEntry = [
      { name: "title", type: "text" },
      {
        name: "secret",
        type: "text",
        access: { read: ({ id }: { id?: unknown }) => id !== "protected" },
      },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, byEntry);

    expect(
      await told([issue("secret")], { secret: "s" }, byEntry, {
        entryId: "protected",
      })
    ).toEqual([UNREADABLE_FIELD_ISSUE]);
    expect(
      await told([issue("secret")], { secret: "s" }, byEntry, {
        entryId: "other",
      })
    ).toEqual([issue("secret")]);
  });

  it("judges each issue on the document as it is, not with another issue's field held", async () => {
    // Readable only while `flag` is held as empty: the document leaves `flag`
    // out, so a read of it removes `secret`.
    const bySibling = [
      { name: "flag", type: "text" },
      {
        name: "secret",
        type: "text",
        access: {
          read: ({ data }: { data?: Record<string, unknown> }) =>
            data?.flag === null,
        },
      },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, bySibling);

    expect(
      await told(
        [issue("flag", "flag is required."), issue("secret", "Code s.")],
        { secret: "s" },
        bySibling
      )
    ).toEqual([issue("flag", "flag is required."), UNREADABLE_FIELD_ISSUE]);
  });

  it("logs which paths were withheld, never their messages", async () => {
    registerFieldFunctions("collection", SLUG, fields);
    const info = vi.spyOn(consoleLogger, "info").mockImplementation(() => {});

    await told(
      [issue("secret", "Code TOPSECRET-4411 is not allowed.")],
      { secret: "TOPSECRET-4411" },
      fields
    );

    expect(info).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).toContain("secret");
    expect(logged).not.toContain("TOPSECRET");
  });
  it("withholds every issue on a field where the reader may not read the entry at all", async () => {
    registerFieldFunctions("collection", SLUG, fields);

    expect(
      await told(
        [issue(""), issue("title"), issue("rows[0].label")],
        { title: "t", rows: [{ label: "a" }] },
        fields,
        { rowReadable: false }
      )
    ).toEqual([issue(""), UNREADABLE_FIELD_ISSUE]);
  });

  it("withholds an issue on a password, which no read shows", async () => {
    const withPassword = [
      { name: "title", type: "text" },
      { name: "pin", type: "password" },
    ] as unknown as FieldConfig[];

    expect(
      await told(
        [issue("title"), issue("pin", "Pin $2b$10$hash is too weak.")],
        { title: "t", pin: "$2b$10$hash" },
        withPassword
      )
    ).toEqual([issue("title"), UNREADABLE_FIELD_ISSUE]);
  });

  it("withholds every issue on a field with a read rule where a field has an afterRead hook", async () => {
    // A read runs its hooks between two judgements, and a hook can change
    // what a rule decides: the rule's answer here may not be the read's.
    const hooked = [
      {
        name: "title",
        type: "text",
        hooks: { afterRead: [({ value }: { value: unknown }) => value] },
      },
      { name: "summary", type: "text" },
      { name: "note", type: "text", access: { read: () => true } },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, hooked);

    expect(
      await told(
        [issue("summary"), issue("note")],
        { title: "t", summary: "s", note: "n" },
        hooked
      )
    ).toEqual([issue("summary"), UNREADABLE_FIELD_ISSUE]);
  });
  it("judges rules without the columns a read never shows, such as the owner", async () => {
    // A read takes the owner column out before its rules run, so a rule
    // reading it never allows there; it must not allow here either.
    const byOwner = [
      { name: "title", type: "text" },
      {
        name: "secret",
        type: "text",
        access: {
          read: ({
            data,
            user,
          }: {
            data?: Record<string, unknown>;
            user?: { id?: unknown } | null;
          }) => data?.createdBy === user?.id,
        },
      },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, byOwner);

    expect(
      await told(
        [issue("secret", "Code s is not allowed.")],
        { title: "t", secret: "s", createdBy: "author" },
        byOwner,
        { tableName: "dc_reports" }
      )
    ).toEqual([UNREADABLE_FIELD_ISSUE]);
  });

  it("judges a plugin type's issue by the field that found it, wherever it is told", async () => {
    registerFieldType({
      type: "document",
      storage: "json",
      component: "@acme/docs/admin#DocumentInput",
      validate: value => [
        { path: "", message: `Document ${JSON.stringify(value)} refused` },
      ],
    });
    const withDocument = [
      { name: "title", type: "text" },
      { name: "body", type: "document", access: hidden },
    ] as unknown as FieldConfig[];
    registerFieldFunctions("collection", SLUG, withDocument);
    const document = { title: "t", body: { secret: "s" } };
    const issues = await validateEntryData(document, withDocument as never, {
      mode: "create",
    });

    expect(await told(issues, document, withDocument)).toEqual([
      UNREADABLE_FIELD_ISSUE,
    ]);
  });
});
