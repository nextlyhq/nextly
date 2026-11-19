/**
 * A written email's blocks travel through the form: read from the record,
 * sent on a save in place of HTML (the server writes the HTML from them), and
 * locked with the owner's other fields on an email the site doesn't own.
 */
import { describe, expect, it } from "vitest";

import type {
  EmailTemplateRecord,
  WrittenDocument,
} from "@admin/services/emailTemplateApi";

import {
  DEFAULT_VALUES,
  formValuesToCreatePayload,
  formValuesToUpdatePayload,
  newEmailValues,
  templateSchemaFor,
  testDraftOf,
  templateToFormValues,
  type TemplateFormValues,
} from "../schema";

const DOC: WrittenDocument = {
  version: 1,
  blocks: [{ type: "heading", text: [{ type: "text", text: "Paid" }] }],
};

function record(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t1",
    name: "Order paid",
    slug: "order-paid",
    kind: "template",
    subject: "Paid",
    htmlContent: "<h1>Paid</h1>",
    plainTextContent: "Paid",
    preheader: null,
    layoutId: null,
    fromOverride: null,
    replyTo: null,
    variables: null,
    useLayout: true,
    isActive: true,
    providerId: null,
    attachments: null,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    owner: { kind: "site" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    ...over,
  };
}

const written: TemplateFormValues = {
  ...DEFAULT_VALUES,
  name: "Order paid",
  slug: "order-paid",
  subject: "Paid",
  format: "written",
  blocks: DOC,
};

describe("a written email in the form", () => {
  it("reads its format and blocks from the record", () => {
    const values = templateToFormValues(
      record({ format: "written", blocks: DOC })
    );
    expect(values.format).toBe("written");
    expect(values.blocks).toEqual(DOC);
  });

  it("reads a record without a format as coded, with no blocks", () => {
    const values = templateToFormValues(record({}));
    expect(values.format).toBe("code");
    expect(values.blocks).toBeNull();
  });

  it("sends its blocks on a create, and no HTML of its own", () => {
    expect(formValuesToCreatePayload(written)).toMatchObject({
      format: "written",
      blocks: DOC,
      htmlContent: "",
    });
  });

  it("sends a coded email exactly as before, with no format or blocks", () => {
    const payload = formValuesToCreatePayload({
      ...written,
      format: "code",
      blocks: null,
      htmlContent: "<p>Hi</p>",
    });
    expect(payload).not.toHaveProperty("format");
    expect(payload).not.toHaveProperty("blocks");
    expect(payload.htmlContent).toBe("<p>Hi</p>");
  });

  it("leaves its blocks out of a save of an owner's email the site hasn't overridden", () => {
    const payload = formValuesToUpdatePayload(
      written,
      record({ format: "written", blocks: DOC, owner: { kind: "core" } })
    );
    expect(payload).not.toHaveProperty("blocks");
    expect(payload).not.toHaveProperty("format");
  });

  it("leaves out its HTML and plain text on a save of a saved written email, which the server writes from its blocks", () => {
    const payload = formValuesToUpdatePayload(
      { ...written, htmlContent: "<h1>Paid</h1>", plainTextContent: "Paid" },
      record({ format: "written", blocks: DOC })
    );
    expect(payload).not.toHaveProperty("htmlContent");
    expect(payload).not.toHaveProperty("plainTextContent");
    expect(payload).toMatchObject({ format: "written", blocks: DOC });
  });

  it("carries its format and blocks in a test send's draft", () => {
    expect(testDraftOf(written)).toMatchObject({
      format: "written",
      blocks: DOC,
    });
    expect(
      testDraftOf({ ...written, format: "code", blocks: null })
    ).not.toHaveProperty("blocks");
  });

  it("needs no HTML when written, and still needs it when coded", () => {
    const schema = templateSchemaFor(false);
    expect(schema.safeParse(written).success).toBe(true);
    expect(
      schema.safeParse({ ...written, format: "code", blocks: null }).success
    ).toBe(false);
  });
});

describe("a new email's first values", () => {
  it("starts a written one with a heading and an empty text block", () => {
    const values = newEmailValues("Order paid", "written");
    expect(values).toMatchObject({
      name: "Order paid",
      slug: "order-paid",
      format: "written",
    });
    expect(values.blocks?.blocks.map(block => block.type)).toEqual([
      "heading",
      "text",
    ]);
  });

  it("starts a coded one as the editor always has, with no blocks", () => {
    expect(newEmailValues("Order paid", "code")).toEqual({
      ...DEFAULT_VALUES,
      name: "Order paid",
      slug: "order-paid",
    });
  });
});
