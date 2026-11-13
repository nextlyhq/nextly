import { describe, expect, it } from "vitest";

import {
  withEditorRelationshipFields,
  withEditorRelationshipShape,
  withStoredRelationshipOptions,
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

  it("never overwrites a target a field states", () => {
    const pointed = { ...stored("oneToOne"), relationTo: "authors" };

    expect(withEditorRelationshipFields([pointed])).toEqual([pointed]);
  });

  it("opens a one-to-one with Unique on even where it also stores Unique off, as its column is unique", () => {
    const both = { ...stored("oneToOne"), unique: false };

    expect(withEditorRelationshipFields([both])).toEqual([
      { ...both, relationTo: "people", unique: true },
    ]);
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

describe("withStoredRelationshipOptions", () => {
  const legacy = (
    relationType?: string,
    extra: Record<string, unknown> = {}
  ) => ({
    name: "person",
    type: "relationship",
    options: {
      target: "people",
      onDelete: "cascade",
      ...(relationType ? { relationType } : {}),
    },
    ...extra,
  });
  /** What the editor sends back for a stored field: what it read, without the options. */
  const sentFrom = (field: Record<string, unknown>, changes = {}) => {
    const [read] = withEditorRelationshipFields([field]);
    const { options: _options, ...sent } = read as Record<string, unknown>;
    return { ...sent, ...changes };
  };

  it("writes an unchanged relationship back exactly as it was stored", () => {
    for (const relationType of [
      undefined,
      "oneToOne",
      "manyToOne",
      "oneToMany",
    ]) {
      const field = legacy(relationType);
      expect(withStoredRelationshipOptions([sentFrom(field)], [field])).toEqual(
        [field]
      );
    }
  });

  it("changes only the cardinality when Unique is turned off or on", () => {
    expect(
      withStoredRelationshipOptions(
        [sentFrom(legacy("oneToOne"), { unique: false })],
        [legacy("oneToOne")]
      )
    ).toEqual([legacy("manyToOne")]);
    expect(
      withStoredRelationshipOptions(
        [sentFrom(legacy("manyToOne"), { unique: true })],
        [legacy("manyToOne")]
      )
    ).toEqual([legacy("oneToOne")]);
    expect(
      withStoredRelationshipOptions(
        [sentFrom(legacy(), { unique: true })],
        [legacy()]
      )
    ).toEqual([legacy("oneToOne")]);
  });

  it("keeps a stored field's own Unique mark as the save sent it", () => {
    const field = legacy("manyToOne", { unique: true });
    expect(
      withStoredRelationshipOptions(
        [sentFrom(field, { unique: false })],
        [field]
      )
    ).toEqual([legacy("manyToOne", { unique: false })]);
  });

  it("writes a one-to-one that also stores Unique off back as stored, and makes it many-to-one when Unique is turned off", () => {
    const both = legacy("oneToOne", { unique: false });

    expect(withStoredRelationshipOptions([sentFrom(both)], [both])).toEqual([
      both,
    ]);
    expect(
      withStoredRelationshipOptions([sentFrom(both, { unique: false })], [both])
    ).toEqual([legacy("manyToOne", { unique: false })]);
  });

  it("takes the save's other changes", () => {
    expect(
      withStoredRelationshipOptions(
        [sentFrom(legacy("oneToOne"), { label: "Owner", required: true })],
        [legacy("oneToOne")]
      )
    ).toEqual([legacy("oneToOne", { label: "Owner", required: true })]);
  });

  it("saves as sent a relationship pointed at another target or made to hold many", () => {
    const retargeted = sentFrom(legacy("oneToOne"), { relationTo: "teams" });
    const many = sentFrom(legacy("oneToOne"), { hasMany: true });
    expect(
      withStoredRelationshipOptions([retargeted, many], [legacy("oneToOne")])
    ).toEqual([retargeted, many]);
  });

  it("leaves a relationship stored in the editor's shape as the save sent it", () => {
    const current = {
      name: "person",
      type: "relationship",
      relationTo: "people",
    };
    const sent = { ...current, unique: true };
    expect(withStoredRelationshipOptions([sent], [current])).toEqual([sent]);
  });

  it("writes back a relationship inside a group or repeater at its own place", () => {
    for (const type of ["group", "repeater"]) {
      const stored = { name: "about", type, fields: [legacy("oneToOne")] };
      const sent = {
        name: "about",
        type,
        fields: [sentFrom(legacy("oneToOne"))],
      };
      expect(withStoredRelationshipOptions([sent], [stored])).toEqual([stored]);
    }
  });

  it("writes back a relationship the save renames, matched to the field it was", () => {
    const renamed = { ...sentFrom(legacy("oneToOne")), name: "owner" };
    const renames = [{ from: { name: "person" }, to: { name: "owner" } }];
    expect(
      withStoredRelationshipOptions([renamed], [legacy("oneToOne")], renames)
    ).toEqual([{ ...legacy("oneToOne"), name: "owner" }]);
    expect(
      withStoredRelationshipOptions([renamed], [legacy("oneToOne")])
    ).toEqual([renamed]);
  });

  it("writes back a relationship that held many as stored, and takes options the save sends", () => {
    const many = legacy(undefined, { hasMany: true });
    expect(withStoredRelationshipOptions([sentFrom(many)], [many])).toEqual([
      many,
    ]);
    expect(
      withStoredRelationshipOptions(
        [sentFrom(legacy("oneToOne"), { options: { onDelete: "set null" } })],
        [legacy("oneToOne")]
      )
    ).toEqual([
      {
        ...legacy("oneToOne"),
        options: {
          target: "people",
          onDelete: "set null",
          relationType: "oneToOne",
        },
      },
    ]);
  });

  it("matches by name, not by position", () => {
    const other = {
      name: "person",
      type: "relationship",
      relationTo: "people",
    };
    expect(
      withStoredRelationshipOptions(
        [{ name: "title", type: "text" }, sentFrom(legacy("oneToOne"))],
        [legacy("oneToOne"), { name: "title", type: "text" }]
      )
    ).toEqual([{ name: "title", type: "text" }, legacy("oneToOne")]);
    expect(withStoredRelationshipOptions([other], [])).toEqual([other]);
  });
});
