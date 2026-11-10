import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { refuseNewJunctionsOnRenamedCollection } from "../junctions-on-renamed-collections";

const manyToMany = (name: string): FieldDefinition =>
  ({
    name,
    type: "relationship",
    options: { relationType: "manyToMany", target: "tags" },
  }) as FieldDefinition;

const manyToOne = (name: string): FieldDefinition =>
  ({
    name,
    type: "relationship",
    options: { relationType: "manyToOne", target: "tags" },
  }) as FieldDefinition;

describe("refuseNewJunctionsOnRenamedCollection", () => {
  it("refuses a many-to-many added to a collection whose table its slug no longer spells, naming it", () => {
    expect(() =>
      refuseNewJunctionsOnRenamedCollection({
        slug: "writers",
        tableName: "dc_authors",
        oldFields: [],
        newFields: [manyToMany("tags")],
      })
    ).toThrow(
      expect.objectContaining({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "fields.tags",
              code: "MANY_TO_MANY_ON_RENAMED_COLLECTION",
            }),
          ],
        },
      })
    );
  });

  it("lets the same field through on a collection its slug still spells", () => {
    expect(() =>
      refuseNewJunctionsOnRenamedCollection({
        slug: "authors",
        tableName: "dc_authors",
        oldFields: [],
        newFields: [manyToMany("tags")],
      })
    ).not.toThrow();
  });

  it("keeps a many-to-many the renamed collection already has, and lets other relationships be added", () => {
    expect(() =>
      refuseNewJunctionsOnRenamedCollection({
        slug: "writers",
        tableName: "dc_authors",
        oldFields: [manyToMany("tags")],
        newFields: [manyToMany("tags"), manyToOne("editor")],
      })
    ).not.toThrow();
  });

  it("refuses a field turned into a many-to-many, which gains a junction", () => {
    expect(() =>
      refuseNewJunctionsOnRenamedCollection({
        slug: "writers",
        tableName: "dc_authors",
        oldFields: [manyToOne("tags")],
        newFields: [manyToMany("tags")],
      })
    ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});
