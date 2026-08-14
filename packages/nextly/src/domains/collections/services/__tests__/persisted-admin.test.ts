import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../../../collections/config/define-collection";
import {
  ADMIN_KEYS_NOT_PERSISTED,
  resolveDescription,
  toPersistedAdmin,
} from "../collection-sync-service";

/**
 * The projection from a collection's authored admin options to the shape stored
 * in the registry. Both sync paths use it, so a value dropped here reaches the
 * admin as "the setting does nothing" while the config still type-checks.
 */
describe("toPersistedAdmin", () => {
  it("carries defaultColumns through to the persisted shape", () => {
    const admin: CollectionConfig["admin"] = {
      useAsTitle: "title",
      defaultColumns: ["title", "status", "publishedAt"],
    };

    // Asserted on the VALUE rather than on the key being present: a key holding
    // undefined would satisfy a presence check while the entry list still
    // auto-selects its columns.
    expect(toPersistedAdmin(admin)?.defaultColumns).toEqual([
      "title",
      "status",
      "publishedAt",
    ]);
  });

  it("preserves the other admin options alongside it", () => {
    const admin: CollectionConfig["admin"] = {
      group: "Content",
      icon: "file-text",
      hidden: true,
      useAsTitle: "title",
      defaultColumns: ["title"],
      disableCreate: true,
      pagination: { defaultLimit: 25, limits: [10, 25, 50] },
    };

    const persisted = toPersistedAdmin(admin);

    expect(persisted).toMatchObject({
      group: "Content",
      icon: "file-text",
      hidden: true,
      useAsTitle: "title",
      defaultColumns: ["title"],
      disableCreate: true,
      pagination: { defaultLimit: 25, limits: [10, 25, 50] },
    });
  });

  it("returns undefined when a collection declares no admin options", () => {
    expect(toPersistedAdmin(undefined)).toBeUndefined();
  });
});

/**
 * Sidebar placement reaches the registry.
 *
 * `DynamicCollectionNav` takes its collections from the persisted registry, so a value dropped by
 * the projection means a code-first collection can set its position, type-check, and still sort
 * by the default — the same shape as the `defaultColumns` drop, found by auditing the rest of the
 * key list after fixing that one.
 */
describe("sidebar placement", () => {
  it("carries order and sidebarGroup", () => {
    const admin: CollectionConfig["admin"] = {
      order: 2,
      sidebarGroup: "editorial",
    };

    const persisted = toPersistedAdmin(admin);
    // On the VALUES: a present key holding undefined sorts by the default just as an absent one
    // does, so a presence check would pass on the broken projection.
    expect(persisted?.order).toBe(2);
    expect(persisted?.sidebarGroup).toBe("editorial");
  });

  it("leaves them undefined when the author set neither", () => {
    // The scaffold must not invent a position. `order` defaulting to 0 here would silently pin
    // every code-first collection above every other one.
    const persisted = toPersistedAdmin({ useAsTitle: "title" });
    expect(persisted?.order).toBeUndefined();
    expect(persisted?.sidebarGroup).toBeUndefined();
  });
});

/**
 * `admin.description` and the top-level `description` are two spellings of one thing, and only
 * the second has a column. Resolved in one place so the two sync paths cannot disagree.
 */
describe("resolveDescription", () => {
  it("uses admin.description when the collection sets no top-level one", () => {
    expect(
      resolveDescription({ admin: { description: "Blog posts and news" } })
    ).toBe("Blog posts and news");
  });

  it("prefers the top-level description when both are set", () => {
    // The documented home wins: an author setting both is most plausibly migrating off the
    // `admin` spelling and expects the explicit field to take effect.
    expect(
      resolveDescription({
        description: "explicit",
        admin: { description: "legacy" },
      })
    ).toBe("explicit");
  });

  it("is undefined when neither is set", () => {
    expect(resolveDescription({})).toBeUndefined();
  });
});

/**
 * The exclusion list is a claim, not a comment: every key on it is an admin option a caller can
 * set and this projection deliberately will not store, and the reason is what a later reader has
 * to weigh before moving it. A blank one would pass the compiler's completeness check while
 * telling that reader nothing.
 */
describe("ADMIN_KEYS_NOT_PERSISTED", () => {
  it("gives a reason for every excluded key", () => {
    const entries = Object.entries(ADMIN_KEYS_NOT_PERSISTED);
    // A control on the assertion below: it holds vacuously over an empty list, and an empty list
    // is also what a bad refactor would leave behind.
    expect(entries.length).toBeGreaterThan(0);

    for (const [key, reason] of entries) {
      expect(reason, `${key} is excluded without a reason`).toBeTruthy();
      expect(reason.trim().length, `${key}'s reason is blank`).toBeGreaterThan(
        0
      );
    }
  });
});
