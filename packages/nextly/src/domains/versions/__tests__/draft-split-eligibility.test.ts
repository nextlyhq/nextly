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
