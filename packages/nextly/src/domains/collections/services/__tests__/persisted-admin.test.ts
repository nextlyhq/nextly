import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../../../collections/config/define-collection";
import { toPersistedAdmin } from "../collection-sync-service";

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
