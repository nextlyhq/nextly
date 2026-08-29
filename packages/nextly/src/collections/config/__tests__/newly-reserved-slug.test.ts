/**
 * What an operator is told when a slug that USED to be legal is refused.
 *
 * A reserved name is normally met by somebody naming something new, who simply
 * picks another. `content-releases` is different: it became reserved when
 * scheduled content releases were added, so the first person to meet it is an
 * operator whose existing install stops booting — and to them "slug is
 * reserved" describes the config that worked in the previous version without
 * saying that the rule changed rather than their collection.
 *
 * @module collections/config/__tests__/newly-reserved-slug.test
 */
import { describe, expect, it } from "vitest";

import { NEWLY_RESERVED_SLUG_NOTES } from "../../../schemas/_zod/rbac";
import { validateSingleConfig } from "../../../singles/config/validate-single";
import type { SingleConfig } from "../../../singles/config/define-single";
import type { CollectionConfig } from "../define-collection";
import { validateCollectionConfig } from "../validate-config";

function reservedError(messages: string[]): string {
  const found = messages.find(m => m.includes("is reserved"));
  expect(found).toBeDefined();
  return found as string;
}

describe("a slug that became reserved in this version", () => {
  it("tells a COLLECTION owner the rule changed and what to do", () => {
    const result = validateCollectionConfig({
      slug: "content-releases",
      fields: [{ name: "title", type: "text" }],
    } as unknown as CollectionConfig);

    const message = reservedError(result.errors.map(e => e.message));
    expect(message).toContain("content-releases");
    expect(message).toContain("became a reserved system resource");
    expect(message).toContain("must rename it");
  });

  it("tells a SINGLE owner the same thing", () => {
    // Both halves reject the slug, and an operator meets whichever they happen
    // to have. A note wired into only one of them would be missing exactly
    // half the time — which is indistinguishable from it working.
    const result = validateSingleConfig({
      slug: "content-releases",
      fields: [{ name: "title", type: "text" }],
    } as unknown as SingleConfig);

    const message = reservedError(result.errors.map(e => e.message));
    expect(message).toContain("became a reserved system resource");
    expect(message).toContain("must rename it");
  });

  it("leaves an ALWAYS-reserved slug's message alone", () => {
    // The control. A note appended to every reservation would satisfy both
    // cases above while telling somebody naming a new `users` collection that
    // an upgrade broke their install.
    const result = validateCollectionConfig({
      slug: "users",
      fields: [{ name: "title", type: "text" }],
    } as unknown as CollectionConfig);

    const message = reservedError(result.errors.map(e => e.message));
    expect(message).toBe(
      "Collection slug 'users' is reserved and cannot be used"
    );
  });

  it("carries a note for every name added to the reserved list since 0.0.1", () => {
    // The list and its explanations drift apart silently: adding a name to
    // SYSTEM_RESOURCES is one line, and nothing about that line fails when the
    // sentence an operator needs is missing.
    expect([...NEWLY_RESERVED_SLUG_NOTES.keys()]).toEqual(["content-releases"]);
  });
});
