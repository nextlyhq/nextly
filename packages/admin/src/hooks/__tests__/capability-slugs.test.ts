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

import type {
  CapabilitiesResponse,
  EntityCapabilitiesAnswer,
} from "../../types/permissions";
import { buildCapabilities } from "../useCurrentUserPermissions";

/** The real deriver, never a hand-built literal, before the server answers. */
const from = (...permissions: string[]) =>
  buildCapabilities(permissions, false, undefined);

/** An answer from the server naming one collection and one Single. */
const answer = (
  posts: Partial<EntityCapabilitiesAnswer>,
  home: Partial<EntityCapabilitiesAnswer> = {}
): CapabilitiesResponse => ({
  isSuperAdmin: false,
  validUntil: null,
  entities: {
    posts: {
      kind: "collection",
      read: false,
      create: false,
      update: false,
      delete: false,
      publish: false,
      unpublish: false,
      ...posts,
    },
    home: {
      kind: "single",
      read: false,
      update: false,
      publish: false,
      unpublish: false,
      ...home,
    },
  },
});

describe("a grant reveals the section it belongs to", () => {
  it.each([
    ["read-users", "canViewUsers"],
    ["read-roles", "canViewRoles"],
    ["read-media", "canViewMedia"],
    ["read-settings", "canViewSettings"],
    ["read-webhooks", "canViewWebhooks"],
    ["read-content-releases", "canViewReleases"],
  ] as const)("%s reveals %s", (slug, flag) => {
    expect(from(slug)[flag]).toBe(true);
  });
});

describe("an UMBRELLA grant reveals what it covers", () => {
  // The half with no coverage before, and the half a table makes easy to get
  // wrong: these slugs reveal a section without being its `read-` slug.
  it("a retired manage- grant reveals nothing, as the server counts it for nothing", () => {
    // A role not yet converted by `nextly upgrade` is refused every plain
    // action there, so no section it would open is offered.
    expect(from("manage-media").canViewMedia).toBe(false);
    expect(from("manage-settings").canViewSettings).toBe(false);
  });

  it("an api-key grant that opens a screen reveals settings", () => {
    for (const slug of ["read-api-keys", "update-api-keys"]) {
      expect(from(slug).canViewSettings, slug).toBe(true);
    }
  });

  // Email is its own area now, with its own rail entry, so an email grant
  // opens nothing in the Settings panel and must not reveal it.
  it("an email grant does not reveal settings", () => {
    for (const slug of ["read-email-providers", "read-email-templates"]) {
      expect(from(slug).canViewSettings, slug).toBe(false);
    }
  });

  /**
   * The other half, and the reason this list is not simply every slug naming
   * the resource. `canViewSettings` shows the rail entry AND opens
   * `/admin/settings`, whose page is General Settings — which answers to
   * `read-settings` and returns 403 without it. So a grant belongs here only
   * if it opens a destination IN the panel.
   *
   * `create-` and `delete-api-keys` do not: the panel's only api-key entry is
   * the list, and listing answers to read-or-update. Including them showed a
   * rail entry whose every destination turned the reader away — they landed on
   * General Settings and got a 403, which is not access they lose here, it is
   * a dead end they no longer see. The create form remains reachable by URL,
   * and its route still admits them.
   */
  it("an api-key grant that opens nothing in the panel does not", () => {
    for (const slug of ["create-api-keys", "delete-api-keys"]) {
      expect(from(slug).canViewSettings, slug).toBe(false);
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

  it("assembling or scheduling releases reveals the section too", () => {
    // The three grants are seeded INDEPENDENTLY, and the service applies the
    // same implication: a role holding only `create` can create a release
    // through the API, so it must be able to see the one it just made. Without
    // this the grant promises something no screen delivers, and an
    // administrator has nothing to tell them a second grant is needed.
    expect(from("create-content-releases").canViewReleases).toBe(true);
    expect(from("publish-content-releases").canViewReleases).toBe(true);
  });

  it("a release grant reveals ONLY the release section", () => {
    // The control: an implication that widened to other sections would pass the
    // case above just as well.
    const assembler = from("create-content-releases");
    expect(assembler.canViewMedia).toBe(false);
    expect(assembler.canViewSettings).toBe(false);
    expect(assembler.canViewCollections).toBe(false);
  });
});

describe("collections and Singles, which the server answers", () => {
  it("takes each one's capabilities from the server's answer", () => {
    const caps = buildCapabilities(
      [],
      false,
      answer({ read: true, update: true, publish: true }, { read: true })
    );
    expect(caps.collections.posts).toEqual({
      canRead: true,
      canCreate: false,
      canUpdate: true,
      canDelete: false,
      canPublish: true,
      canUnpublish: false,
      // An answer naming no request judged in other languages refuses each:
      // its action's own cell is judged in one language only.
      canReadTranslations: false,
      canReadHistory: false,
      canPublishEveryLanguage: false,
      canUpdateInDefaultLanguage: false,
      canDuplicate: false,
    });
    expect(caps.canViewCollections).toBe(true);
  });

  it("follows the server where a code rule refuses what a held slug names", () => {
    // `read-posts` is held, and the collection's rule refuses the read: the
    // server says no, and so must the admin, or it offers a section the
    // server will refuse.
    const caps = buildCapabilities(
      ["read-posts", "update-posts"],
      false,
      answer({ read: false, update: false })
    );
    expect(caps.collections.posts?.canRead).toBe(false);
    expect(caps.collections.posts?.canUpdate).toBe(false);
    expect(caps.canViewCollections).toBe(false);
  });

  it("offers nothing until the server has answered, whatever slugs are held", () => {
    const caps = from("read-posts", "update-posts");
    expect(caps.collections).toEqual({});
    expect(caps.canViewCollections).toBe(false);
  });

  it("gives a Single no create or delete, which it does not have", () => {
    const caps = buildCapabilities(
      [],
      false,
      answer({}, { read: true, update: true })
    );
    expect(caps.collections.home).toMatchObject({
      canRead: true,
      canUpdate: true,
      canCreate: false,
      canDelete: false,
    });
  });

  it("keeps SYSTEM resources out of the collection map", () => {
    // Otherwise `content-releases` would look like a collection called
    // "content-releases", and the section would be gated by a lookup that
    // happens to work rather than by the flag that is meant to answer.
    const caps = buildCapabilities(
      ["read-content-releases", "read-media"],
      false,
      answer({})
    );
    expect(caps.collections["content-releases"]).toBeUndefined();
    expect(caps.collections.media).toBeUndefined();
    expect(caps.canViewCollections).toBe(false);
  });
});
