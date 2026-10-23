/**
 * What taking the live values reports is judged by the caller's field read
 * rules, once, against the live document as it is: the judgement of one list
 * of fields must not change the document the other list is judged against,
 * nor the live document the caller goes on to use.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../shared/lib/field-level-registry";

import { takenLiveValues } from "./shared-publish-base";

afterEach(() => clearFieldFunctions());

/** Whether a group value still holds its protected `secret`. */
function holdsSecret(data: Record<string, unknown> | undefined): boolean {
  const details = data?.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "secret" in (details as Record<string, unknown>)
  );
}

describe("takenLiveValues", () => {
  it("judges a field whose rule reads a protected nested value against the whole live document", async () => {
    registerFieldFunctions("single", "site", [
      {
        name: "details",
        type: "group",
        fields: [
          { name: "label" },
          // Never readable.
          { name: "secret", access: { read: () => false } },
        ],
      },
      // Readable only while the details hold no secret.
      {
        name: "score",
        access: {
          read: ({ data }: { data?: Record<string, unknown> }) =>
            !holdsSecret(data),
        },
      },
    ]);
    const live = { details: { label: "Shop", secret: "s" }, score: 7 };

    const reported = await takenLiveValues(
      {
        kind: "single",
        slug: "site",
        overrideAccess: false,
        grants: () => Promise.resolve({ permissions: [], roles: [] }),
      },
      { taken: ["details"], remaining: ["score"], live }
    );

    // The score is hidden, as a read of this document hides it.
    expect(reported).toEqual({
      taken: ["details"],
      outOfDate: [],
      hiddenOutOfDate: 1,
    });
    // And the live document is untouched.
    expect(live).toEqual({ details: { label: "Shop", secret: "s" }, score: 7 });
  });
});
