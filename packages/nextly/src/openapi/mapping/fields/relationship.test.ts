import { describe, expect, it } from "vitest";

import type { RelationshipFieldConfig } from "../../../collections/fields/types/relationship";

import { mapRelationshipField } from "./relationship";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "posts",
  fieldPath: "fields[0]",
};

describe("mapRelationshipField", () => {
  describe("single non-polymorphic", () => {
    it("input is a string ID, output is oneOf [string, $ref(Target)]", () => {
      const field: RelationshipFieldConfig = {
        name: "author",
        type: "relationship",
        relationTo: "users",
      };
      const { input, output } = mapRelationshipField(field, baseCtx);
      expect(input).toMatchObject({ type: "string" });
      expect(output).toEqual(
        expect.objectContaining({
          oneOf: [{ type: "string" }, { $ref: "#/components/schemas/User" }],
        })
      );
    });

    it("emits the description on both input and output", () => {
      const field: RelationshipFieldConfig = {
        name: "author",
        type: "relationship",
        relationTo: "users",
        label: "Author",
      };
      const { input, output } = mapRelationshipField(field, baseCtx);
      expect((input as { description?: string }).description).toBe("Author");
      expect((output as { description?: string }).description).toBe("Author");
    });
  });

  describe("hasMany non-polymorphic", () => {
    it("input is array<string>, output is oneOf [array<string>, array<$ref>]", () => {
      const field: RelationshipFieldConfig = {
        name: "categories",
        type: "relationship",
        relationTo: "categories",
        hasMany: true,
      };
      const { input, output } = mapRelationshipField(field, baseCtx);
      expect(input).toMatchObject({
        type: "array",
        items: { type: "string" },
      });
      expect(output).toEqual(
        expect.objectContaining({
          oneOf: [
            { type: "array", items: { type: "string" } },
            {
              type: "array",
              items: { $ref: "#/components/schemas/Category" },
            },
          ],
        })
      );
    });

    it("emits minItems / maxItems from minRows / maxRows on the input array", () => {
      const field: RelationshipFieldConfig = {
        name: "categories",
        type: "relationship",
        relationTo: "categories",
        hasMany: true,
        minRows: 1,
        maxRows: 5,
      };
      const { input } = mapRelationshipField(field, baseCtx);
      expect(input).toMatchObject({ minItems: 1, maxItems: 5 });
    });
  });

  describe("single polymorphic", () => {
    it("input is the polymorphic { relationTo, value } object, output is oneOf with each target ref", () => {
      const field: RelationshipFieldConfig = {
        name: "owner",
        type: "relationship",
        relationTo: ["users", "admins"],
      };
      const { input, output } = mapRelationshipField(field, baseCtx);
      expect(input).toEqual(
        expect.objectContaining({
          type: "object",
          required: ["relationTo", "value"],
          properties: {
            relationTo: { type: "string", enum: ["users", "admins"] },
            value: { type: "string", description: "Document ID" },
          },
          "x-nextly-relation-to": ["users", "admins"],
        })
      );
      const outOneOf = (output as { oneOf?: unknown[] }).oneOf;
      expect(outOneOf).toHaveLength(3);
      expect(outOneOf).toEqual(
        expect.arrayContaining([
          { $ref: "#/components/schemas/User" },
          { $ref: "#/components/schemas/Admin" },
        ])
      );
    });
  });

  describe("hasMany polymorphic", () => {
    it("input is array of polymorphic objects with x-nextly-relation-to", () => {
      const field: RelationshipFieldConfig = {
        name: "related",
        type: "relationship",
        relationTo: ["posts", "pages"],
        hasMany: true,
      };
      const { input } = mapRelationshipField(field, baseCtx);
      expect(input).toMatchObject({
        type: "array",
        items: expect.objectContaining({
          type: "object",
          required: ["relationTo", "value"],
        }) as unknown,
        "x-nextly-relation-to": ["posts", "pages"],
      });
    });
  });

  describe("schema-name inflection", () => {
    it("maps 'users' -> 'User'", () => {
      const field: RelationshipFieldConfig = {
        name: "author",
        type: "relationship",
        relationTo: "users",
      };
      const { output } = mapRelationshipField(field, baseCtx);
      const refs = (output as { oneOf?: { $ref?: string }[] }).oneOf;
      expect(refs?.[1]?.$ref).toBe("#/components/schemas/User");
    });

    it("maps 'categories' -> 'Category'", () => {
      const field: RelationshipFieldConfig = {
        name: "cat",
        type: "relationship",
        relationTo: "categories",
      };
      const { output } = mapRelationshipField(field, baseCtx);
      const refs = (output as { oneOf?: { $ref?: string }[] }).oneOf;
      expect(refs?.[1]?.$ref).toBe("#/components/schemas/Category");
    });

    it("maps 'media' (already singular) -> 'Media'", () => {
      const field: RelationshipFieldConfig = {
        name: "cover",
        type: "relationship",
        relationTo: "media",
      };
      const { output } = mapRelationshipField(field, baseCtx);
      const refs = (output as { oneOf?: { $ref?: string }[] }).oneOf;
      expect(refs?.[1]?.$ref).toBe("#/components/schemas/Media");
    });

    it("maps kebab-case 'email-providers' -> 'EmailProvider'", () => {
      const field: RelationshipFieldConfig = {
        name: "provider",
        type: "relationship",
        relationTo: "email-providers",
      };
      const { output } = mapRelationshipField(field, baseCtx);
      const refs = (output as { oneOf?: { $ref?: string }[] }).oneOf;
      expect(refs?.[1]?.$ref).toBe("#/components/schemas/EmailProvider");
    });
  });
});
