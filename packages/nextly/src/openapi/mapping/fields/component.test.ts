import { describe, expect, it } from "vitest";

import type { ComponentFieldConfig } from "../../../collections/fields/types/component";

import { mapComponentField } from "./component";
import type { MappingContext } from "./types";

const baseCtx: MappingContext = {
  schemaRef: n => ({ $ref: `#/components/schemas/${n}` }),
  ownerSlug: "Post",
  fieldPath: "fields[0]",
};

describe("mapComponentField", () => {
  describe("single mode (component: 'hero')", () => {
    it("not repeatable: emits a bare $ref to the component schema", () => {
      const field: ComponentFieldConfig = {
        name: "hero",
        type: "component",
        component: "hero",
      };
      const { input, output } = mapComponentField(field, baseCtx);
      expect(input).toEqual({ $ref: "#/components/schemas/Hero" });
      expect(output).toEqual({ $ref: "#/components/schemas/Hero" });
    });

    it("repeatable: emits array of $ref to that one component", () => {
      const field: ComponentFieldConfig = {
        name: "features",
        type: "component",
        component: "feature-card",
        repeatable: true,
      };
      const { input } = mapComponentField(field, baseCtx);
      expect(input).toEqual({
        type: "array",
        items: { $ref: "#/components/schemas/FeatureCard" },
      });
    });

    it("repeatable with min/maxRows: emits minItems/maxItems", () => {
      const field: ComponentFieldConfig = {
        name: "features",
        type: "component",
        component: "feature-card",
        repeatable: true,
        minRows: 1,
        maxRows: 12,
      };
      const { input } = mapComponentField(field, baseCtx);
      expect(input).toMatchObject({ minItems: 1, maxItems: 12 });
    });
  });

  describe("multi mode / dynamic zone (components: [...])", () => {
    it("not repeatable: emits oneOf with discriminator on __component", () => {
      const field: ComponentFieldConfig = {
        name: "section",
        type: "component",
        components: ["hero", "cta", "image-gallery"],
      };
      const { input, output } = mapComponentField(field, baseCtx);
      const expected = {
        oneOf: [
          { $ref: "#/components/schemas/Hero" },
          { $ref: "#/components/schemas/Cta" },
          { $ref: "#/components/schemas/ImageGallery" },
        ],
        discriminator: { propertyName: "__component" },
      };
      expect(input).toMatchObject(expected);
      expect(output).toMatchObject(expected);
    });

    it("repeatable: emits array of oneOf items (discriminator on items)", () => {
      const field: ComponentFieldConfig = {
        name: "blocks",
        type: "component",
        components: ["hero", "cta"],
        repeatable: true,
        minRows: 0,
        maxRows: 50,
      };
      const { input } = mapComponentField(field, baseCtx);
      expect(input).toMatchObject({
        type: "array",
        minItems: 0,
        maxItems: 50,
        items: {
          oneOf: [
            { $ref: "#/components/schemas/Hero" },
            { $ref: "#/components/schemas/Cta" },
          ],
          discriminator: { propertyName: "__component" },
        },
      });
    });
  });

  describe("schema-name mapping (PascalCase, no singularization)", () => {
    it("kebab-case slug 'image-gallery' -> 'ImageGallery'", () => {
      const field: ComponentFieldConfig = {
        name: "g",
        type: "component",
        component: "image-gallery",
      };
      const { input } = mapComponentField(field, baseCtx);
      expect((input as { $ref?: string }).$ref).toBe(
        "#/components/schemas/ImageGallery"
      );
    });

    it("snake_case slug 'feature_card' -> 'FeatureCard'", () => {
      const field: ComponentFieldConfig = {
        name: "g",
        type: "component",
        component: "feature_card",
      };
      const { input } = mapComponentField(field, baseCtx);
      expect((input as { $ref?: string }).$ref).toBe(
        "#/components/schemas/FeatureCard"
      );
    });

    it("does NOT singularize: 'features' stays 'Features'", () => {
      // Components are named singularly by convention; we don't strip
      // trailing 's' for component slugs (unlike collection slugs).
      const field: ComponentFieldConfig = {
        name: "g",
        type: "component",
        component: "features",
      };
      const { input } = mapComponentField(field, baseCtx);
      expect((input as { $ref?: string }).$ref).toBe(
        "#/components/schemas/Features"
      );
    });
  });

  describe("description handling", () => {
    it("emits description on single-mode schema", () => {
      const field: ComponentFieldConfig = {
        name: "hero",
        type: "component",
        component: "hero",
        label: "Hero section",
      };
      const { input } = mapComponentField(field, baseCtx);
      // $ref-only schemas can't carry sibling description in strict JSON
      // Schema; we sidestep by wrapping with allOf when a description
      // is present. Confirm the description is reachable.
      expect(
        (input as { description?: string; allOf?: unknown[] }).description
      ).toBe("Hero section");
    });

    it("emits description on repeatable array (not on items)", () => {
      const field: ComponentFieldConfig = {
        name: "features",
        type: "component",
        component: "feature-card",
        repeatable: true,
        admin: { description: "List of feature cards." },
      };
      const { input } = mapComponentField(field, baseCtx);
      expect((input as { description?: string }).description).toBe(
        "List of feature cards."
      );
      const items = (input as { items?: { description?: string } }).items;
      expect(items?.description).toBeUndefined();
    });
  });

  describe("misconfiguration: neither component nor components", () => {
    it("returns a permissive object schema and does not crash", () => {
      const field: ComponentFieldConfig = {
        name: "section",
        type: "component",
      };
      const { input, output } = mapComponentField(field, baseCtx);
      expect(input).toEqual({ type: "object" });
      expect(output).toEqual({ type: "object" });
    });
  });
});
