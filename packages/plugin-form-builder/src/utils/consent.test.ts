/**
 * A consent's stored value: the choice with the form's text, never a text the
 * visitor sent, and refused unless agreed; the edits that would change a
 * stored consent; and the builder keeping a consent required.
 */
import { describe, expect, it } from "vitest";

import { prepareSubmission } from "../handlers/prepare-submission";
import type { AnyFormField, ConsentFormField } from "../types";

import {
  CONSENT_REQUIRED_REASON,
  consentFieldEdit,
  editedConsents,
} from "./consent";
import { formatExportValue } from "./export-formats";

const CONSENT: ConsentFormField = {
  type: "consent",
  name: "privacy",
  label: "Privacy",
  required: true,
  agreementText: "I agree to the privacy policy",
};
const NAME: AnyFormField = { type: "text", name: "name", label: "Name" };

const stored = (data: Record<string, unknown>) =>
  prepareSubmission({ data, fields: [NAME, CONSENT], validate: true });

describe("a consent's stored value", () => {
  it.each([true, "on", "true", "1"])(
    "is the agreement with the form's text for a ticked box sent as %j",
    sent => {
      const result = stored({ name: "Ada", privacy: sent });
      expect(result.validationErrors).toBeUndefined();
      expect(result.data.privacy).toEqual({
        agreed: true,
        text: "I agree to the privacy policy",
      });
    }
  );

  it("keeps the form's text when the visitor sends one of their own", () => {
    const result = stored({
      privacy: { agreed: true, text: "I agree to nothing" },
    });
    expect(result.data.privacy).toEqual({
      agreed: true,
      text: "I agree to the privacy policy",
    });
  });

  it.each([false, "off", "yes please", 0, undefined])(
    "is refused for %j, which is not an agreement",
    sent => {
      const result = stored({ name: "Ada", privacy: sent });
      expect(Object.keys(result.validationErrors ?? {})).toEqual(["privacy"]);
    }
  );

  it("is required even when the field says it is not", () => {
    const result = prepareSubmission({
      data: { name: "Ada" },
      fields: [NAME, { ...CONSENT, required: false }],
      validate: true,
    });
    expect(Object.keys(result.validationErrors ?? {})).toEqual(["privacy"]);
  });

  it("reads as the choice and the text agreed to", () => {
    expect(formatExportValue({ agreed: true, text: "I agree" }, CONSENT)).toBe(
      'Agreed: "I agree"'
    );
  });
});

describe("an edit of a stored consent", () => {
  const before = {
    name: "Ada",
    privacy: { agreed: true, text: "I agree to the privacy policy" },
  };

  it("passes when the consent is carried as it is", () => {
    expect(
      editedConsents([NAME, CONSENT], before, { ...before, name: "Grace" })
    ).toEqual([]);
  });

  it.each([
    ["withdrawn", { agreed: false, text: "I agree to the privacy policy" }],
    ["given another text", { agreed: true, text: "I agree to less" }],
    ["sent as a bare yes", true],
    ["dropped", undefined],
  ])("is caught when %s", (_, privacy) => {
    expect(
      editedConsents([NAME, CONSENT], before, { name: "Ada", privacy })
    ).toEqual(["privacy"]);
  });
});

describe("the builder's consent", () => {
  it("refuses being made optional, saying why", () => {
    expect(consentFieldEdit(CONSENT, { ...CONSENT, required: false })).toEqual({
      refused: CONSENT_REQUIRED_REASON,
    });
  });

  it("becomes required with a text when a field is made one", () => {
    const made = consentFieldEdit(NAME, {
      ...NAME,
      type: "consent",
      required: false,
    } as AnyFormField);
    expect(made).toEqual({
      field: expect.objectContaining({
        type: "consent",
        required: true,
        agreementText: "I agree to the privacy policy",
      }),
    });
  });

  it("leaves other fields' edits alone", () => {
    const edited = { ...NAME, required: false };
    expect(consentFieldEdit(NAME, edited)).toEqual({ field: edited });
  });
});
