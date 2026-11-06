/**
 * The stored field shapes that name a relationship's target, found and rewritten by one walk:
 * `relationTo` as one slug or a polymorphic list, an upload's `relationTo`, and the Builder
 * shape's `options.target`, at the top level and inside groups and repeaters at any depth. Only a
 * target equal to the renamed slug changes; everything else is handed back as it was.
 */
import { describe, expect, it } from "vitest";

import { retargeted, targetingFields } from "../relationship-targets";

const posts = [
  { name: "title", type: "text" },
  { name: "writer", type: "relationship", relationTo: "authors" },
  {
    name: "reviewer",
    type: "relationship",
    options: { relationType: "manyToOne", target: "authors" },
  },
  { name: "portrait", type: "upload", relationTo: "authors" },
  { name: "cover", type: "upload", relationTo: "media" },
  {
    name: "credits",
    type: "repeater",
    fields: [
      {
        name: "box",
        type: "group",
        fields: [
          { name: "person", type: "relationship", relationTo: "authors" },
        ],
      },
    ],
  },
  {
    name: "either",
    type: "relationship",
    relationTo: ["authors", "media"],
  },
];

describe("targetingFields", () => {
  it("finds every field naming a target, nested ones by their dotted path, with its source", () => {
    expect(
      targetingFields([{ slug: "posts", source: "code", fields: posts }])
    ).toEqual([
      {
        name: "posts.writer",
        source: "code",
        targets: ["authors"],
        polymorphic: false,
      },
      {
        name: "posts.reviewer",
        source: "code",
        targets: ["authors"],
        polymorphic: false,
      },
      {
        name: "posts.portrait",
        source: "code",
        targets: ["authors"],
        polymorphic: false,
      },
      {
        name: "posts.cover",
        source: "code",
        targets: ["media"],
        polymorphic: false,
      },
      {
        name: "posts.credits.box.person",
        source: "code",
        targets: ["authors"],
        polymorphic: false,
      },
      {
        name: "posts.either",
        source: "code",
        targets: ["authors", "media"],
        polymorphic: true,
      },
    ]);
  });

  it("reads fields stored as JSON text, as some dialects return them", () => {
    expect(
      targetingFields([
        {
          slug: "notes",
          source: "ui",
          fields: JSON.stringify(posts.slice(1, 2)),
        },
      ]).map(field => field.name)
    ).toEqual(["notes.writer"]);
  });
});

describe("retargeted", () => {
  it("points every target equal to the old slug at the new one, at any depth, and touches nothing else", () => {
    const next = retargeted(posts, "authors", "writers");
    expect(next).toEqual([
      { name: "title", type: "text" },
      { name: "writer", type: "relationship", relationTo: "writers" },
      {
        name: "reviewer",
        type: "relationship",
        options: { relationType: "manyToOne", target: "writers" },
      },
      { name: "portrait", type: "upload", relationTo: "writers" },
      { name: "cover", type: "upload", relationTo: "media" },
      {
        name: "credits",
        type: "repeater",
        fields: [
          {
            name: "box",
            type: "group",
            fields: [
              { name: "person", type: "relationship", relationTo: "writers" },
            ],
          },
        ],
      },
      // A list is the rename's to refuse, not to rewrite.
      {
        name: "either",
        type: "relationship",
        relationTo: ["authors", "media"],
      },
    ]);
    // The input is left as it was.
    expect(posts[1]).toEqual({
      name: "writer",
      type: "relationship",
      relationTo: "authors",
    });
  });

  it("answers null when no field names the old slug", () => {
    expect(retargeted(posts, "tags", "labels")).toBeNull();
  });
});
