/**
 * Which permission slugs reveal each part of the admin.
 *
 * Written because the rule had NO coverage and the refactor that surfaced that
 * could not be trusted without it: dropping `manage-media` from the table left
 * the entire admin suite — 3170 tests — green. A capability rule that nothing
 * asserts is one where a slug can be moved to the wrong flag, or lost, and the
 * only symptom is a section quietly missing for some roles.
 *
 * Each case names the CONSEQUENCE rather than the flag, because that is what a
 * wrong answer costs: a section that vanishes for someone who holds the grant,
 * or appears for someone who does not.
 *
 * @module hooks/__tests__/capability-slugs.test
 */
import { describe, expect, it } from "vitest";

import { buildCapabilities } from "../useCurrentUserPermissions";

/** The real deriver, never a hand-built literal. */
const from = (...permissions: string[]) =>
  buildCapabilities(permissions, false);

describe("a grant reveals the section it belongs to", () => {
  it.each([
    ["read-users", "canViewUsers"],
    ["read-roles", "canViewRoles"],
    ["read-media", "canViewMedia"],
    ["manage-settings", "canViewSettings"],
    ["read-webhooks", "canViewWebhooks"],
    ["read-content-releases", "canViewReleases"],
  ] as const)("%s reveals %s", (slug, flag) => {
    expect(from(slug)[flag]).toBe(true);
  });
});

describe("an UMBRELLA grant reveals what it covers", () => {
  // The half with no coverage before, and the half a table makes easy to get
  // wrong: these slugs reveal a section without being its `read-` slug.
  it("manage-media reveals the media section", () => {
    expect(from("manage-media").canViewMedia).toBe(true);
  });

  it("any api-key or email grant reveals settings", () => {
    for (const slug of [
      "read-api-keys",
      "create-api-keys",
      "update-api-keys",
      "delete-api-keys",
      "manage-email-providers",
      "manage-email-templates",
    ]) {
      expect(from(slug).canViewSettings, slug).toBe(true);
    }
  });

  it("update or create webhooks reveals webhooks", () => {
    expect(from("update-webhooks").canViewWebhooks).toBe(true);
    expect(from("create-webhooks").canViewWebhooks).toBe(true);
  });

  it("create or update reveals the management flags", () => {
    expect(from("create-users").canManageUsers).toBe(true);
    expect(from("update-users").canManageUsers).toBe(true);
    expect(from("create-roles").canManageRoles).toBe(true);
    expect(from("update-roles").canManageRoles).toBe(true);
  });
});

describe("a grant reveals ONLY its own section", () => {
  // The control. Without it every case above is satisfied by a deriver that
  // returns true for everything — which is precisely what a super-admin does,
  // and what a table built with the wrong default would do for everyone.
  it("holding one grant does not reveal the others", () => {
    const media = from("read-media");
    expect(media.canViewMedia).toBe(true);
    expect(media.canViewUsers).toBe(false);
    expect(media.canViewRoles).toBe(false);
    expect(media.canViewSettings).toBe(false);
    expect(media.canViewWebhooks).toBe(false);
    expect(media.canViewReleases).toBe(false);
  });

  it("holding nothing reveals nothing", () => {
    const nobody = from();
    expect(Object.values(nobody).some(value => value === true)).toBe(false);
  });

  it("assembling releases does not by itself reveal the section", () => {
    // Deliberate: the page is a LIST, so a caller who may create a release but
    // not read one would land somewhere that shows nothing.
    expect(from("create-content-releases").canViewReleases).toBe(false);
  });
});

describe("collections, which are the other half of the derivation", () => {
  it("builds per-collection capabilities from action-resource slugs", () => {
    const caps = from("read-posts", "update-posts");
    expect(caps.collections.posts).toEqual({
      canRead: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
    });
    expect(caps.canViewCollections).toBe(true);
  });

  it("keeps SYSTEM resources out of the collection map", () => {
    // Otherwise `content-releases` would look like a collection called
    // "content-releases", and the section would be gated by a lookup that
    // happens to work rather than by the flag that is meant to answer.
    const caps = from("read-content-releases", "read-media");
    expect(caps.collections["content-releases"]).toBeUndefined();
    expect(caps.collections.media).toBeUndefined();
    expect(caps.canViewCollections).toBe(false);
  });
});
