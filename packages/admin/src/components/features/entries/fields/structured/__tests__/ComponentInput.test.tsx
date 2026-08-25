import type { FieldConfig } from "nextly/config";
import { useForm, FormProvider } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { render, screen, fireEvent } from "@admin/__tests__/utils";

import {
  ComponentInput,
  type EnrichedComponentFieldConfig,
} from "../ComponentInput";

function SingleHarness({
  field,
  defaultValues = {},
}: {
  field: EnrichedComponentFieldConfig;
  defaultValues?: Record<string, unknown>;
}) {
  const methods = useForm({ defaultValues });
  return (
    <FormProvider {...methods}>
      <ComponentInput
        name={field.name}
        field={field}
        control={methods.control}
      />
      <pre data-testid="form-values">{JSON.stringify(methods.watch())}</pre>
    </FormProvider>
  );
}

describe("ComponentInput", () => {
  describe("Single component mode (non-repeatable)", () => {
    const singleField: EnrichedComponentFieldConfig = {
      type: "component",
      name: "seo",
      label: "SEO Metadata",
      component: "seo",
      repeatable: false,
      componentFields: [
        { type: "text", name: "metaTitle", label: "Meta Title" } as never,
        {
          type: "textarea",
          name: "metaDescription",
          label: "Meta Description",
        } as never,
      ],
      admin: {
        description: "Configure search engine optimization tags.",
      },
    };

    it("renders card header and description in main content mode", () => {
      render(<SingleHarness field={singleField} />);
      expect(screen.getByText("SEO Metadata")).toBeInTheDocument();
      expect(
        screen.getByText("Configure search engine optimization tags.")
      ).toBeInTheDocument();
    });

    it("renders accordion header in sidebar position mode", () => {
      const sidebarField: EnrichedComponentFieldConfig = {
        ...singleField,
        admin: {
          ...singleField.admin,
          position: "sidebar",
        },
      };
      render(<SingleHarness field={sidebarField} />);
      expect(screen.getByText("SEO Metadata")).toBeInTheDocument();
    });

    it("renders empty message when component has no fields", () => {
      const emptyField: EnrichedComponentFieldConfig = {
        ...singleField,
        componentFields: [],
      };
      render(<SingleHarness field={emptyField} />);
      expect(
        screen.getByText("No fields configured for this field group.")
      ).toBeInTheDocument();
    });
  });

  describe("Repeatable component mode (single component type)", () => {
    const repeatableField: EnrichedComponentFieldConfig = {
      type: "component",
      name: "slides",
      label: "Slide",
      component: "slide",
      repeatable: true,
      componentFields: [
        {
          type: "text",
          name: "caption",
          label: "Caption",
          defaultValue: "Default Slide",
        } as never,
        { type: "checkbox", name: "visible" } as never,
      ],
    };

    it("renders empty state when there are no items", () => {
      render(
        <SingleHarness field={repeatableField} defaultValues={{ slides: [] }} />
      );
      expect(screen.getByText("No slides yet.")).toBeInTheDocument();
      expect(screen.getByText("Add Slide")).toBeInTheDocument();
    });

    it("appends a new row with computed defaults when Add button is clicked", () => {
      render(
        <SingleHarness field={repeatableField} defaultValues={{ slides: [] }} />
      );
      const addButton = screen.getByRole("button", { name: /Add Slide/i });
      fireEvent.click(addButton);

      // Empty state disappears
      expect(screen.queryByText("No slides yet.")).not.toBeInTheDocument();
      // The new row is seeded with the declared default values
      const values = JSON.parse(
        screen.getByTestId("form-values").textContent || "{}"
      );
      expect(values.slides[0]).toMatchObject({
        caption: "Default Slide",
        visible: false,
      });
    });

    it("displays min-rows warning and max-rows information", () => {
      const constrainedField: EnrichedComponentFieldConfig = {
        ...repeatableField,
        minRows: 2,
        maxRows: 3,
      };

      render(
        <SingleHarness
          field={constrainedField}
          defaultValues={{
            slides: [{ caption: "Slide 1", visible: true }],
          }}
        />
      );

      expect(
        screen.getByText("Minimum 2 slides required. Currently have 1.")
      ).toBeInTheDocument();
    });
  });

  describe("Multi-component mode (non-repeatable)", () => {
    const multiField: EnrichedComponentFieldConfig = {
      type: "component",
      name: "featured",
      label: "Featured Block",
      components: ["hero", "promo"],
      repeatable: false,
      componentSchemas: {
        hero: {
          label: "Hero Banner",
          fields: [
            { type: "text", name: "heading", defaultValue: "Welcome" } as never,
          ],
        },
        promo: {
          label: "Promo Card",
          fields: [{ type: "text", name: "discountCode" } as never],
        },
      },
    };

    it("renders selector placeholder when no component is selected", () => {
      render(
        <SingleHarness field={multiField} defaultValues={{ featured: null }} />
      );
      expect(
        screen.getByText("Select a field group to add fields.")
      ).toBeInTheDocument();
    });
  });
});
