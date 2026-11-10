import { describe, expect, it } from "vitest";

import {
  withEditorRelationshipFields,
  withEditorRelationshipShape,
} from "../editor-relationship-fields";

const stored = (relationType?: string, target: unknown = "people") => ({
  name: "person",
  type: "relationship",
  options: { target, ...(relationType ? { relationType } : {}) },
});

describe("withEditorRelationshipFields", () => {
  it("gives a stored one-to-one its target and Unique, keeping what it stores", () => {
    expect(withEditorRelationshipFields([stored("oneToOne")])).toEqual([
      { ...stored("oneToOne"), relationTo: "people", unique: true },
    ]);
  });

  it("gives a relationship to one entry its target and nothing else", () => {
    for (const relationType of [undefined, "manyToOne", "oneToMany"]) {
      expect(withEditorRelationshipFields([stored(relationType)])).toEqual([
        { ...stored(relationType), relationTo: "people" },
      ]);
    }
  });

  it("never overwrites what a field states", () => {
    const turnedOff = { ...stored("oneToOne"), unique: false };
    const pointed = { ...stored("oneToOne"), relationTo: "authors" };

    expect(withEditorRelationshipFields([turnedOff])).toEqual([
      { ...turnedOff, relationTo: "people" },
    ]);
    expect(withEditorRelationshipFields([pointed])).toEqual([pointed]);
  });

  it("leaves a many-to-many, and a relationship to several collections, as they are stored", () => {
    const manyToMany = stored("manyToMany");
    const several = stored("manyToOne", ["people", "teams"]);

    expect(withEditorRelationshipFields([manyToMany, several])).toEqual([
      manyToMany,
      several,
    ]);
  });

  it("reaches a relationship inside groups and repeaters", () => {
    const fields = [
      {
        name: "blocks",
        type: "repeater",
        fields: [{ name: "meta", type: "group", fields: [stored("oneToOne")] }],
      },
    ];

    expect(withEditorRelationshipFields(fields)).toEqual([
      {
        name: "blocks",
        type: "repeater",
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [
              { ...stored("oneToOne"), relationTo: "people", unique: true },
            ],
          },
        ],
      },
    ]);
  });
});

describe("withEditorRelationshipShape", () => {
  it("shapes a record's fields and its schema definition's copy, and nothing else", () => {
    const record = {
      slug: "profiles",
      fields: [stored("oneToOne")],
      schemaDefinition: { fields: [stored("oneToOne")], other: 1 },
    };

    expect(withEditorRelationshipShape(record)).toEqual({
      slug: "profiles",
      fields: [{ ...stored("oneToOne"), relationTo: "people", unique: true }],
      schemaDefinition: {
        fields: [{ ...stored("oneToOne"), relationTo: "people", unique: true }],
        other: 1,
      },
    });
  });
});
