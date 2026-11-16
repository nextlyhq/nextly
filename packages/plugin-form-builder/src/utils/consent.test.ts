/**
 * A consent's stored value: the choice with the form's text, never a text the
 * visitor sent, and refused unless agreed; the edits that would change a
 * stored consent; and the builder keeping a consent required.
 */
import { describe, expect, it } from "vitest";

import { prepareSubmission } from "../handlers/prepare-submission";
import type { AnyFormField, ConsentFormField } from "../types";

import {
  blankConsentFields,
  CONSENT_REQUIRED_REASON,
  CONSENT_TEXT_CHANGED,
  consentFieldEdit,
  editedConsents,
  storedConsentNames,
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

  it("is refused when the visitor agreed to a text the form no longer shows", () => {
    const result = stored({
      name: "Ada",
      privacy: { agreed: true, text: "I agree to the old policy" },
    });
    expect(result.validationErrors).toEqual({
      privacy: CONSENT_TEXT_CHANGED,
    });
  });

  it("is the agreement when the visitor sends the text the form shows", () => {
    const result = stored({
      name: "Ada",
      privacy: { agreed: true, text: "I agree to the privacy policy" },
    });
    expect(result.validationErrors).toBeUndefined();
    expect(result.data.privacy).toEqual({
      agreed: true,
      text: "I agree to the privacy policy",
    });
  });

  it("keeps the form's text, whatever the payload says, outside a new submission", () => {
    const result = prepareSubmission({
      data: { privacy: { agreed: true, text: "I agree to nothing" } },
      fields: [CONSENT],
      validate: true,
      fresh: false,
    });
    expect(result.validationErrors).toBeUndefined();
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

describe("the consents a stored submission holds", () => {
  const answer = { agreed: true, text: "I agree" };

  it("are the form's consent fields and every answer stored as a consent", () => {
    expect(
      storedConsentNames([NAME, CONSENT], {
        name: "Ada",
        privacy: answer,
        terms: answer,
      })
    ).toEqual(["privacy", "terms"]);
    // A stored consent stays one when another field takes its name.
    expect(
      storedConsentNames([{ ...NAME, name: "terms" }], { terms: answer })
    ).toEqual(["terms"]);
  });

  it("are held to the stored answer once their field is gone", () => {
    expect(
      editedConsents([NAME], { terms: answer }, { name: "Grace" })
    ).toEqual(["terms"]);
    expect(
      editedConsents([NAME], { terms: answer }, { terms: answer })
    ).toEqual([]);
  });
});

describe("a consent with no text", () => {
  it.each([undefined, "", "   "])("is found for a text of %j", text => {
    const field = { ...CONSENT, agreementText: text } as AnyFormField;
    expect(blankConsentFields([NAME, field]).map(f => f.name)).toEqual([
      "privacy",
    ]);
  });

  it("is not found for a consent with a text", () => {
    expect(blankConsentFields([NAME, CONSENT])).toEqual([]);
  });
});
