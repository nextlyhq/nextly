/**
 * `first_published_at` is injected as a system column once the draft/publish
 * lifecycle is enabled, so a user field of that name would collide with it in
 * the table. Reserved unconditionally: a collection can enable the lifecycle
 * later, and the collision would then surface at migration time rather than
 * where the name was chosen.
 *
 * Nested fields live inside JSON and do not collide, so the reservation is
 * top-level only — the same rule the owner column follows.
 */
import { describe, expect, it } from "vitest";

import { group, text } from "../fields/helpers";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function codesFor(
  fields: CollectionConfig["fields"],
  extra: Partial<CollectionConfig> = {}
): string[] {
  return validateCollectionConfig({
    slug: "posts",
    fields,
    ...extra,
  }).errors.map(e => e.code);
}

describe("validateCollectionConfig: first-publication marker reservation", () => {
  it("rejects a top-level first_published_at field", () => {
    expect(codesFor([text({ name: "first_published_at" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("rejects the camelCase firstPublishedAt alias", () => {
    // Config validation accepts camelCase names and snake-cases them to the same column, so
    // allowing the alias would reserve nothing.
    expect(codesFor([text({ name: "firstPublishedAt" })])).toContain(
      "FIELD_NAME_RESERVED"
    );
  });

  it("rejects it even when the lifecycle is off", () => {
    // The point of reserving it unconditionally: enabling `status` later must not turn a valid
    // config into a failed migration.
    expect(
      codesFor([text({ name: "first_published_at" })], { status: false })
    ).toContain("FIELD_NAME_RESERVED");
  });

  it("allows the name nested inside a group (JSON-stored, no column)", () => {
    expect(
      codesFor([
        group({ name: "meta", fields: [text({ name: "first_published_at" })] }),
      ])
    ).not.toContain("FIELD_NAME_RESERVED");
  });
});
