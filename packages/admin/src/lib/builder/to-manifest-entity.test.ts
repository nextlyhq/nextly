/**
 * @module lib/builder/to-manifest-entity.test
 * @since v0.0.3-alpha (Plan D4)
 */
import { describe, expect, it } from "vitest";

import {
  collectionToManifestEntity,
  mapBuilderFieldToManifest,
} from "./to-manifest-entity";

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

  it("preserves a polymorphic relationTo array (no truncation)", () => {
    const entity = collectionToManifestEntity({
      slug: "x",
      settings: {},
      fields: [
        { name: "rel", type: "relationship", relationTo: ["users", "media"] },
      ],
    });
    expect(entity.fields[0].relationTo).toEqual(["users", "media"]);
  });
});

describe("mapBuilderFieldToManifest", () => {
  it("preserves a polymorphic relationTo array", () => {
    const out = mapBuilderFieldToManifest({
      name: "cover",
      type: "relationship",
      relationTo: ["media", "documents"],
    });
    expect(out.relationTo).toEqual(["media", "documents"]);
  });

  it("forwards admin, unique, index, label, and full validation", () => {
    const out = mapBuilderFieldToManifest({
      name: "title",
      type: "text",
      label: "Title",
      unique: true,
      index: true,
      validation: { minLength: 2, maxLength: 80, pattern: "^.+$" },
      admin: { width: "50%", description: "the title", placeholder: "..." },
    });
    expect(out).toMatchObject({
      label: "Title",
      unique: true,
      index: true,
      validation: { minLength: 2, maxLength: 80, pattern: "^.+$" },
      admin: { width: "50%", description: "the title", placeholder: "..." },
    });
  });

  it("records a plugin/unsupported field type as its json storage primitive", () => {
    // e.g. the page builder's "page-builder" type — recorded as json so the manifest stays
    // valid; the DB keeps the real type so the plugin editor still renders.
    const entity = collectionToManifestEntity({
      slug: "x",
      settings: {},
      fields: [{ name: "content", type: "page-builder" }],
    });
    expect(entity.fields[0]).toMatchObject({ name: "content", type: "json" });
  });

  it("maps an empty field list to a field-less entity with labels + status (create case)", () => {
    const entity = collectionToManifestEntity({
      slug: "widgets",
      settings: { singularName: "Widget", pluralName: "Widgets", status: true },
      fields: [],
    });
    expect(entity).toEqual({
      slug: "widgets",
      fields: [],
      labels: { singular: "Widget", plural: "Widgets" },
      status: true,
    });
  });
});
