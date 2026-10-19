/**
 * A promotion's field rules judge the document as it goes live.
 *
 * A pending change keeps the status it was saved under, which for a held
 * translation can be a draft's, while the promotion publishes it. A field rule
 * reading the document's status must be shown the status that is written, or a
 * value a rule allows only on a draft is promoted and published.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import {
  clearFieldFunctions,
  registerFieldFunctions,
} from "../../../shared/lib/field-level-registry";

import { assertDraftsMayBePromoted } from "./promote-gate";

afterEach(() => clearFieldFunctions());

describe("promoting a pending change", () => {
  it("shows a field rule the status the promotion writes", async () => {
    const seen: unknown[] = [];
    const fields = [{ name: "notes", type: "text" }];
    registerFieldFunctions("single", "landing", [
      {
        ...fields[0],
        access: {
          update: ({ data }: { data?: Record<string, unknown> }) => {
            seen.push(data?.status);
            return true;
          },
        },
      },
    ]);

    await assertDraftsMayBePromoted(
      [{ locale: null, snapshot: { notes: "held", status: "draft" } }],
      {
        slug: "landing",
        entryId: "s1",
        fields: fields as FieldConfig[],
        grants: async () => ({ permissions: [], roles: [] }),
        toLogical: doc => doc,
        liveStoredFor: async () => ({ notes: "live", status: "draft" }),
        status: "published",
        localizedFieldNames: new Set(),
        enforceLocalizedRequired: true,
      }
    );

    // The promoted document is judged first, then the live one it replaces.
    expect(seen[0]).toBe("published");
  });
});
