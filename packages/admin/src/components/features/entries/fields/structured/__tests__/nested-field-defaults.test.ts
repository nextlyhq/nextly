import type { FieldConfig } from "nextly/config";
import { readFieldGroupType } from "nextly/field-group-type";
import { describe, expect, it } from "vitest";

import { createDefaultFieldValues } from "../nested-field-defaults";

describe("createDefaultFieldValues", () => {
  describe("Type-based default fallbacks (no explicit defaultValue)", () => {
    it("assigns false to checkbox fields", () => {
      const fields: FieldConfig[] = [
        { type: "checkbox", name: "isActive" } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ isActive: false });
    });

    it("assigns null to number fields", () => {
      const fields: FieldConfig[] = [{ type: "number", name: "age" } as never];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ age: null });
    });

    it("assigns empty array to repeater fields", () => {
      const fields: FieldConfig[] = [
        { type: "repeater", name: "tags", fields: [] } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ tags: [] });
    });

    it("assigns null to single (non-repeatable) component fields", () => {
      const fields: FieldConfig[] = [
        {
          type: "component",
          name: "meta",
          component: "seo",
          repeatable: false,
        } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ meta: null });
    });

    it("assigns empty array to repeatable component fields", () => {
      const fields: FieldConfig[] = [
        {
          type: "component",
          name: "sections",
          components: ["hero"],
          repeatable: true,
        } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ sections: [] });
    });

    it("recursively computes defaults for group fields with subfields", () => {
      const fields: FieldConfig[] = [
        {
          type: "group",
          name: "settings",
          fields: [
            { type: "checkbox", name: "notifications" } as never,
            { type: "number", name: "limit" } as never,
            { type: "text", name: "theme" } as never,
          ],
        } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({
        settings: {
          notifications: false,
          limit: null,
          theme: null,
        },
      });
    });

    it("assigns empty object for group fields with no subfields", () => {
      const fields: FieldConfig[] = [
        { type: "group", name: "emptyGroup" } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ emptyGroup: {} });
    });

    it("assigns null to standard scalar and custom plugin fields", () => {
      const fields: FieldConfig[] = [
        { type: "text", name: "title" } as never,
        { type: "textarea", name: "bio" } as never,
        { type: "select", name: "role" } as never,
        { type: "custom-plugin-field", name: "colorPicker" } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({
        title: null,
        bio: null,
        role: null,
        colorPicker: null,
      });
    });
  });

  describe("Explicit defaultValue handling", () => {
    it("uses literal defaultValue when defined", () => {
      const fields: FieldConfig[] = [
        {
          type: "text",
          name: "greeting",
          defaultValue: "Hello World",
        } as never,
        { type: "number", name: "count", defaultValue: 42 } as never,
        { type: "checkbox", name: "optIn", defaultValue: true } as never,
        { type: "select", name: "status", defaultValue: "draft" } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({
        greeting: "Hello World",
        count: 42,
        optIn: true,
        status: "draft",
      });
    });

    it("calls function defaultValue with empty object", () => {
      const dynamicFn = () => "computed-value";
      const countFn = () => 100;
      const fields: FieldConfig[] = [
        { type: "text", name: "slug", defaultValue: dynamicFn } as never,
        {
          type: "number",
          name: "initialScore",
          defaultValue: countFn,
        } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({
        slug: "computed-value",
        initialScore: 100,
      });
    });

    it("preserves declared defaultValue on custom plugin fields", () => {
      const fields: FieldConfig[] = [
        {
          type: "geo-point",
          name: "location",
          defaultValue: { lat: 0, lng: 0 },
        } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({
        location: { lat: 0, lng: 0 },
      });
    });
  });

  describe("Edge cases and discriminators", () => {
    it("returns empty object when fields is undefined or empty", () => {
      expect(createDefaultFieldValues(undefined)).toEqual({});
      expect(createDefaultFieldValues([])).toEqual({});
    });

    it("skips layout-only or nameless fields", () => {
      const fields: FieldConfig[] = [
        { type: "divider" } as never,
        { type: "heading", label: "Section Header" } as never,
        { type: "text", name: "validField" } as never,
      ];
      const result = createDefaultFieldValues(fields);
      expect(result).toEqual({ validField: null });
    });

    it("writes field group discriminator when componentType option is provided", () => {
      const fields: FieldConfig[] = [
        { type: "text", name: "headline", defaultValue: "Banner" } as never,
      ];
      const result = createDefaultFieldValues(fields, {
        componentType: "hero-block",
      });
      expect(readFieldGroupType(result)).toBe("hero-block");
      expect(result.headline).toBe("Banner");
    });
  });

  describe("Cross-component Equivalence Assertions", () => {
    it("produces identical defaults regardless of caller component context", () => {
      const sharedSubFields: FieldConfig[] = [
        { type: "text", name: "label" } as never,
        { type: "checkbox", name: "enabled" } as never,
        { type: "number", name: "order", defaultValue: 1 } as never,
        { type: "repeater", name: "subItems", fields: [] } as never,
        {
          type: "group",
          name: "nestedGroup",
          fields: [
            { type: "text", name: "subName" } as never,
            {
              type: "component",
              name: "repeatableChild",
              repeatable: true,
            } as never,
          ],
        } as never,
      ];

      // Reached through ComponentInput context (no componentType)
      const componentInputDefaults = createDefaultFieldValues(sharedSubFields);

      // Reached through RepeaterInput context
      const repeaterInputDefaults = createDefaultFieldValues(sharedSubFields);

      // Equivalence contract
      expect(componentInputDefaults).toEqual(repeaterInputDefaults);
      expect(repeaterInputDefaults).toEqual({
        label: null,
        enabled: false,
        order: 1,
        subItems: [],
        nestedGroup: {
          subName: null,
          repeatableChild: [],
        },
      });
    });

    it("corrects prior drift where nested repeatable component in repeater produced null instead of empty array", () => {
      const repeaterFieldsWithNestedComponent: FieldConfig[] = [
        { type: "component", name: "slides", repeatable: true } as never,
        { type: "component", name: "header", repeatable: false } as never,
      ];

      const result = createDefaultFieldValues(
        repeaterFieldsWithNestedComponent
      );
      expect(result.slides).toEqual([]);
      expect(result.header).toBeNull();
    });
  });
});
