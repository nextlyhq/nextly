/**
 * @module lib/builder/to-manifest-entity.test
 * @since v0.0.3-alpha (Plan D4)
 */
import { describe, expect, it } from "vitest";

import { collectionToManifestEntity } from "./to-manifest-entity";

describe("collectionToManifestEntity", () => {
  it("maps slug, labels, admin, status, and supported fields", () => {
    const entity = collectionToManifestEntity({
      slug: "events",
      settings: {
        singularName: "Event",
        pluralName: "Events",
        status: true,
        useAsTitle: "title",
        defaultColumns: ["title", "venue"],
        group: "Content",
      },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "venue", type: "text" },
        {
          name: "category",
          type: "select",
          options: [{ label: "A", value: "a" }],
          required: true,
        },
        {
          name: "owner",
          type: "relationship",
          relationTo: "users",
          hasMany: true,
        },
      ],
    });
    expect(entity.slug).toBe("events");
    expect(entity.labels).toEqual({ singular: "Event", plural: "Events" });
    expect(entity.admin).toEqual({
      useAsTitle: "title",
      defaultColumns: ["title", "venue"],
      group: "Content",
    });
    expect(entity.status).toBe(true);
    expect(entity.fields.map(f => f.name)).toEqual([
      "title",
      "venue",
      "category",
      "owner",
    ]);
    expect(entity.fields[3]).toMatchObject({
      type: "relationship",
      relationTo: "users",
      hasMany: true,
    });
  });

  it("omits empty admin/labels when not provided", () => {
    const entity = collectionToManifestEntity({
      slug: "notes",
      settings: {},
      fields: [{ name: "body", type: "textarea" }],
    });
    expect(entity.slug).toBe("notes");
    expect(entity.admin).toBeUndefined();
    expect(entity.labels).toBeUndefined();
  });

  it("collapses a relationTo array to its first target", () => {
    const entity = collectionToManifestEntity({
      slug: "x",
      settings: {},
      fields: [
        { name: "rel", type: "relationship", relationTo: ["users", "media"] },
      ],
    });
    expect(entity.fields[0].relationTo).toBe("users");
  });

  it("throws on an unsupported field type (defensive — picker prevents it)", () => {
    expect(() =>
      collectionToManifestEntity({
        slug: "x",
        settings: {},
        fields: [{ name: "blocks", type: "repeater" }],
      })
    ).toThrowError(/unsupported field type/i);
  });
});
