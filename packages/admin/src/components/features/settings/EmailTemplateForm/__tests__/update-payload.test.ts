/**
 * A save sends only what the site may change on that email right now.
 *
 * Sending a locked owner's field back as it was read can override the email
 * with the owner's previous text; sending a secret email's stored copies back
 * makes the server refuse every save.
 */
import { describe, expect, it } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import {
  DEFAULT_VALUES,
  formValuesToUpdatePayload,
  type TemplateFormValues,
} from "../schema";

const values: TemplateFormValues = {
  ...DEFAULT_VALUES,
  name: "Welcome",
  slug: "welcome",
  subject: "Hi",
  htmlContent: "<p>Hi</p>",
  description: "Sent on sign-up",
  fromOverride: "Shop <shop@example.com>",
  cc: ["team@example.com"],
};

function record(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t1",
    name: "Welcome",
    slug: "welcome",
    kind: "template",
    subject: "Hi",
    htmlContent: "<p>Hi</p>",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    fromOverride: null,
    replyTo: null,
    variables: null,
    useLayout: true,
    isActive: true,
    providerId: null,
    attachments: null,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    owner: { kind: "core" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    ...over,
  };
}

const OWNER_FIELDS = [
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
  "description",
  "variables",
];

describe("formValuesToUpdatePayload", () => {
  it("leaves the owner's fields out of a save on an owner's email", () => {
    const payload = formValuesToUpdatePayload(values, record({}));
    for (const field of OWNER_FIELDS) expect(payload).not.toHaveProperty(field);
    // The site's settings still go.
    expect(payload.fromOverride).toBe("Shop <shop@example.com>");
    expect(payload.name).toBe("Welcome");
  });

  it("sends them once the site has overridden it, or it's the site's own", () => {
    for (const saved of [
      record({ overridden: true }),
      record({ owner: { kind: "site" } }),
    ]) {
      const payload = formValuesToUpdatePayload(values, saved);
      expect(payload.subject).toBe("Hi");
      expect(payload.description).toBe("Sent on sign-up");
    }
  });

  it("leaves the copies alone on an email that carries a secret", () => {
    const payload = formValuesToUpdatePayload(
      values,
      record({ owner: { kind: "site" }, carriesSecret: true })
    );
    expect(payload).not.toHaveProperty("cc");
    expect(payload).not.toHaveProperty("bcc");
    // The control: an email without the mark sends them.
    expect(
      formValuesToUpdatePayload(values, record({ owner: { kind: "site" } })).cc
    ).toEqual(["team@example.com"]);
  });
});
