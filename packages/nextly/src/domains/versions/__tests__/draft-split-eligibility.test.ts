/**
 * The draft-split eligibility predicate is the single source of truth shared by
 * the mutation service (whether a status-less update stores a working draft) and
 * the schema-read paths (the admin's `draftsEnabled`). These pin every
 * disqualifier so the two can never present a status-less save as a draft while
 * the server writes the live row.
 */
import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  evaluateDraftSplitEligibility,
  isDraftSplitEligible,
  type DraftSplitEligibilityInput,
} from "../draft-split-eligibility";
import type { ComponentSchemas } from "../restore-snapshot";

const textFields = [
  { name: "title", type: "text" },
] as unknown as FieldConfig[];
const passwordFields = [
  { name: "secret", type: "password" },
] as unknown as FieldConfig[];

const components = (
  info: Partial<{
    fields: FieldConfig[];
    localized: boolean;
    resolved: boolean;
  }>
): ComponentSchemas =>
  new Map([
    [
      "hero",
      {
        fields: info.fields ?? textFields,
        localized: info.localized ?? false,
        resolved: info.resolved ?? true,
      },
    ],
  ]);

const base: DraftSplitEligibilityInput = {
  collectionHasStatus: true,
  draftsVersioningEnabled: true,
  fields: textFields,
  componentSchemas: new Map(),
};

describe("isDraftSplitEligible", () => {
  it("is eligible when the lifecycle is on and nothing disqualifies", () => {
    expect(isDraftSplitEligible(base)).toBe(true);
  });

  it("requires the Draft/Published lifecycle", () => {
    expect(isDraftSplitEligible({ ...base, collectionHasStatus: false })).toBe(
      false
    );
  });

  it("requires drafts-enabled versioning", () => {
    expect(
      isDraftSplitEligible({ ...base, draftsVersioningEnabled: false })
    ).toBe(false);
  });

  it("does not ask whether the document is localized", () => {
    // A localized document is eligible: a snapshot holds exactly one locale's
    // values, and the draft is keyed by that locale. Which locale, and whether
    // the writing surface can name one at all, is decided by `resolveDraftHold`
    // — keeping the two apart is what stops an edit being held under a key
    // nothing reads.
    expect(isDraftSplitEligible(base)).toBe(true);
  });

  it("is off for a top-level (or grouped) password field", () => {
    expect(isDraftSplitEligible({ ...base, fields: passwordFields })).toBe(
      false
    );
  });

  it("is off for a password inside a reachable component", () => {
    expect(
      isDraftSplitEligible({
        ...base,
        componentSchemas: components({ fields: passwordFields }),
      })
    ).toBe(false);
  });

  it("stays eligible with a localized component", () => {
    // Representable, for the same reason the document itself is: a snapshot
    // holds one locale's values and the draft is keyed by that locale. An
    // UNRESOLVED component is still refused, below.
    expect(
      isDraftSplitEligible({
        ...base,
        componentSchemas: components({ localized: true }),
      })
    ).toBe(true);
  });

  it("is off for an unresolved component", () => {
    expect(
      isDraftSplitEligible({
        ...base,
        componentSchemas: components({ resolved: false }),
      })
    ).toBe(false);
  });

  it("stays eligible with an ordinary resolved, non-localized component", () => {
    expect(
      isDraftSplitEligible({ ...base, componentSchemas: components({}) })
    ).toBe(true);
  });

  it("treats a null component map as no components when the cheap checks pass", () => {
    // The mutation service skips component resolution when a cheaper disqualifier
    // already forces false; a null map must not itself flip an otherwise-eligible
    // collection, since the cheap checks run first.
    expect(isDraftSplitEligible({ ...base, componentSchemas: null })).toBe(
      true
    );
  });

  it("still fails a cheap disqualifier even with a null component map", () => {
    expect(
      isDraftSplitEligible({
        ...base,
        collectionHasStatus: false,
        componentSchemas: null,
      })
    ).toBe(false);
  });
});

/**
 * The reason codes exist so a developer who configured the split and does not
 * get it can find out why. They are deliberately silent when the configuration
 * never asked for the split, so an ordinary collection carries no phantom
 * "disabled because" on its schema response.
 */
describe("evaluateDraftSplitEligibility", () => {
  it("reports no reason when the split runs", () => {
    expect(evaluateDraftSplitEligibility(base)).toEqual({
      eligible: true,
      reason: null,
      componentSlug: null,
    });
  });

  it("stays silent when the configuration never asked for drafts", () => {
    expect(
      evaluateDraftSplitEligibility({
        ...base,
        draftsVersioningEnabled: false,
      })
    ).toEqual({ eligible: false, reason: null, componentSlug: null });
  });

  it("names the missing lifecycle when drafts were asked for without it", () => {
    expect(
      evaluateDraftSplitEligibility({ ...base, collectionHasStatus: false })
    ).toEqual({
      eligible: false,
      reason: "lifecycle-disabled",
      componentSlug: null,
    });
  });

  it("names a password field in the collection's own fields", () => {
    expect(
      evaluateDraftSplitEligibility({ ...base, fields: passwordFields })
    ).toEqual({
      eligible: false,
      reason: "password-field",
      componentSlug: null,
    });
  });

  it("names the component a password field sits in", () => {
    expect(
      evaluateDraftSplitEligibility({
        ...base,
        componentSchemas: components({ fields: passwordFields }),
      })
    ).toEqual({
      eligible: false,
      reason: "password-field",
      componentSlug: "hero",
    });
  });

  it("names the component that failed to resolve", () => {
    expect(
      evaluateDraftSplitEligibility({
        ...base,
        componentSchemas: components({ resolved: false }),
      })
    ).toEqual({
      eligible: false,
      reason: "unresolvable-component",
      componentSlug: "hero",
    });
  });

  it("agrees with the boolean predicate on every input above", () => {
    const inputs: DraftSplitEligibilityInput[] = [
      base,
      { ...base, draftsVersioningEnabled: false },
      { ...base, collectionHasStatus: false },
      { ...base, fields: passwordFields },
      { ...base, componentSchemas: components({ fields: passwordFields }) },
      { ...base, componentSchemas: components({ resolved: false }) },
    ];
    for (const input of inputs) {
      expect(evaluateDraftSplitEligibility(input).eligible).toBe(
        isDraftSplitEligible(input)
      );
    }
  });
});
