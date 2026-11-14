/**
 * The Organization tab's brand details in the settings draft: read from the
 * stored value and written back unchanged, sent only once edited, and moved
 * fact by fact onto settings saved meanwhile.
 */
import { describe, expect, it } from "vitest";

import { brandDetailsDraftOf, storedBrandDetails } from "../brand-draft";
import { changesOf, draftOf, rebasedDraft } from "../settings-draft";

const STORED = {
  email: "hello@example.com",
  foundingDate: "2024",
  contactPoints: [
    { contactType: "customer support", email: "help@example.com" },
    { contactType: "sales", telephone: "+1 555 0100" },
  ],
  parentOrganization: {
    name: "Example Holdings",
    url: "https://holdings.example",
  },
};

describe("brand details in the draft", () => {
  it("are written back as they were stored", () => {
    expect(storedBrandDetails(brandDetailsDraftOf(STORED))).toEqual(STORED);
  });

  it("are nothing at all where every fact is blank", () => {
    expect(storedBrandDetails(brandDetailsDraftOf(undefined))).toBeNull();
    expect(changesOf({ _rev: "1" }, draftOf({ _rev: "1" }))).toBeNull();
  });

  it("are sent only once edited", () => {
    const stored = { _rev: "1", brandDetails: STORED };
    expect(changesOf(stored, draftOf(stored))).toBeNull();
    const draft = draftOf(stored);
    draft.brandDetails.telephone = "+44 20 7946 0000";
    expect(changesOf(stored, draft)).toEqual({
      brandDetails: { ...STORED, telephone: "+44 20 7946 0000" },
      _rev: "1",
    });
  });

  it("are moved fact by fact onto settings saved meanwhile", () => {
    const before = draftOf({ brandDetails: STORED });
    const draft = draftOf({ brandDetails: STORED });
    draft.brandDetails.email = "press@example.com";
    const after = draftOf({
      brandDetails: {
        ...STORED,
        parentOrganization: {
          ...STORED.parentOrganization,
          description: "Owns Example.",
        },
        contactPoints: [
          ...STORED.contactPoints,
          {
            contactType: "billing support",
            url: "https://example.com/billing",
          },
        ],
      },
    });
    const moved = rebasedDraft(draft, before, after);
    expect(moved.brandDetails.email).toBe("press@example.com");
    expect(moved.brandDetails.parentDescription).toBe("Owns Example.");
    expect(moved.brandDetails.contactPoints).toHaveLength(3);
  });
});
