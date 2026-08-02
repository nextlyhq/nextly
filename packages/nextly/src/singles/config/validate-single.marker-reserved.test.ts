/**
 * A Single gets the first-publication marker as a system column once the
 * draft/publish lifecycle is enabled, so a user field of that name would
 * collide with it in the table.
 *
 * A Single carries no owner column, so unlike a collection this is the only
 * reserved system field name here — which is also why the check had to be added
 * rather than extended: there was nothing for a Single's field to collide with
 * until the marker reached its table.
 */
import { describe, expect, it } from "vitest";

import { text } from "../../collections/fields/helpers";
import { validateSingleConfig } from "./validate-single";

function codesFor(fields: unknown[]): string[] {
  return validateSingleConfig({
    slug: "banner",
    fields,
  } as Parameters<typeof validateSingleConfig>[0]).errors.map(e => e.code);
}

describe("validateSingleConfig: first-publication marker reservation", () => {
  it("rejects a top-level first_published_at field", () => {
    expect(codesFor([text({ name: "first_published_at" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("rejects the camelCase firstPublishedAt alias", () => {
    expect(codesFor([text({ name: "firstPublishedAt" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("leaves an ordinary single untouched", () => {
    expect(codesFor([text({ name: "headline" })])).not.toContain(
      "FIELD_NAME_RESERVED"
    );
  });
});
