/**
 * What a test send carries, and what the inbox line shows.
 *
 * A test sends what is on screen, so its draft carries every field a save
 * would store that changes the email, attachments included: one added or
 * removed and not yet saved is in the test. The inbox line shows the server's
 * render once there is one, even when a field renders empty, and the text as
 * written only until the first render arrives.
 */
import { describe, expect, it } from "vitest";

import { shownInboxLine } from "../InboxStrip";
import {
  DEFAULT_VALUES,
  testDraftOf,
  type TemplateFormValues,
} from "../schema";

const values: TemplateFormValues = {
  ...DEFAULT_VALUES,
  subject: "Order {{ number }}",
  htmlContent: "<p>Hi</p>",
  providerId: "p-draft",
  attachments: [{ mediaId: "m-added", filename: "terms.pdf" }],
} as TemplateFormValues;

describe("a test send's draft", () => {
  it("carries the attachments on screen", () => {
    expect(testDraftOf(values).attachments).toEqual([
      { mediaId: "m-added", filename: "terms.pdf" },
    ]);
  });

  it("carries none when they were all removed", () => {
    expect(testDraftOf({ ...values, attachments: [] }).attachments).toBeNull();
  });

  it("carries the provider chosen on screen", () => {
    expect(testDraftOf(values).providerId).toBe("p-draft");
  });
});

describe("the inbox line", () => {
  const written = {
    subject: "Order {{ number }}",
    preheader: "{% if vip %}Thanks for staying{% endif %}",
    from: "{{ shop }} <shop@example.com>",
  };

  it("shows the render, even a field that renders empty", () => {
    expect(
      shownInboxLine(written, {
        subject: "Order 1042",
        preheader: "",
        from: '"Northwind" <shop@example.com>',
      })
    ).toEqual({
      subject: "Order 1042",
      preheader: "",
      from: '"Northwind" <shop@example.com>',
    });
  });

  it("shows no From when the draft sets none", () => {
    expect(
      shownInboxLine(
        { ...written, from: "" },
        { subject: "Order 1042", preheader: "", from: null }
      ).from
    ).toBe("");
  });

  it("shows the text as written until the first render arrives", () => {
    expect(shownInboxLine(written, null)).toEqual(written);
  });
});
