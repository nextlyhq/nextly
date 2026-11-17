/**
 * The fields a picked template adds, as the Builder stores them: every setting
 * a field declares is kept, nothing left out is added, and no stored array is
 * the declaration's own.
 */
import { describe, expect, it } from "vitest";

import type { SchemaTemplate, SchemaTemplateField } from "../schema-templates";
import { templateFieldsToAdd } from "../template-fields";

function template(fields: SchemaTemplateField[]): SchemaTemplate {
  return {
    id: "t",
    kind: "collection",
    category: "Test",
    name: "Test",
    description: "",
    fields,
  };
}

const declared: SchemaTemplateField[] = [
  {
    name: "status",
    label: "Status",
    type: "select",
    required: true,
    options: [
      { label: "Open", value: "open" },
      { label: "Closed", value: "closed" },
    ],
    admin: { description: "Where it stands." },
  },
  { name: "sku", label: "SKU", type: "text", unique: true },
  {
    name: "related",
    label: "Related",
    type: "relationship",
    relationTo: ["posts", "pages"],
    hasMany: true,
  },
  {
    name: "rating",
    label: "Rating",
    type: "acme-rating",
    pluginOptions: { stars: 5 },
  },
  {
    name: "sections",
    label: "Sections",
    type: "repeater",
    fields: [
      { name: "heading", label: "Heading", type: "text" },
      { name: "aside", label: "Aside", type: "text" },
    ],
  },
];

describe("templateFieldsToAdd", () => {
  it("keeps every setting each field declares, its own fields too", () => {
    expect(templateFieldsToAdd(template(declared), new Set())).toEqual([
      {
        name: "status",
        label: "Status",
        type: "select",
        required: true,
        options: [
          { label: "Open", value: "open" },
          { label: "Closed", value: "closed" },
        ],
        admin: { description: "Where it stands." },
      },
      { name: "sku", label: "SKU", type: "text", unique: true },
      {
        name: "related",
        label: "Related",
        type: "relationship",
        relationTo: ["posts", "pages"],
        hasMany: true,
      },
      {
        name: "rating",
        label: "Rating",
        type: "acme-rating",
        pluginOptions: { stars: 5 },
      },
      {
        name: "sections",
        label: "Sections",
        type: "repeater",
        fields: [
          { name: "heading", label: "Heading", type: "text" },
          { name: "aside", label: "Aside", type: "text" },
        ],
      },
    ]);
  });

  it("adds nothing left out, nor anything inside it, by key", () => {
    const names = (leftOut: string[]) =>
      templateFieldsToAdd(template(declared), new Set(leftOut)).map(field => [
        field.name,
        ...(field.fields ?? []).map(inner => inner.name),
      ]);
    expect(names(["1", "4.1"])).toEqual([
      ["status"],
      ["related"],
      ["rating"],
      ["sections", "heading"],
    ]);
    expect(names(["4"])).toEqual([
      ["status"],
      ["sku"],
      ["related"],
      ["rating"],
    ]);
  });

  it("copies the declaration's arrays and settings, so editing the entity never reaches the template", () => {
    const [status, , related] = templateFieldsToAdd(
      template(declared),
      new Set()
    );
    expect(status.options).not.toBe(declared[0].options);
    expect(status.options?.[0]).not.toBe(declared[0].options?.[0]);
    expect(status.admin).not.toBe(declared[0].admin);
    expect(related.relationTo).not.toBe(declared[2].relationTo);
  });
});
