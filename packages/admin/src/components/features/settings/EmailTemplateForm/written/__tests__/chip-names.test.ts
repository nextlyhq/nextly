/**
 * A chip's name on screen comes from the declared labels along its path, and
 * inside a list `item` is the list's current item, not a variable of its own.
 */
import { describe, expect, it } from "vitest";

import type { TemplateFormVariable } from "../../schema";
import { chipNamer, itemPaths } from "../chip-names";

const variables: TemplateFormVariable[] = [
  {
    name: "customer",
    description: "",
    required: true,
    presentation: {
      type: "object",
      label: "Customer",
      fields: [{ name: "firstName", label: "First name" }, { name: "email" }],
    },
  },
  {
    name: "order",
    description: "",
    required: true,
    presentation: {
      type: "object",
      label: "Order",
      fields: [
        {
          name: "lines",
          label: "Order lines",
          type: "list",
          fields: [
            { name: "title", label: "Product" },
            { name: "qty", label: "Quantity" },
          ],
        },
      ],
    },
  },
  // A top-level variable called `item`, which a list's own item shadows.
  {
    name: "item",
    description: "",
    required: false,
    presentation: { label: "Featured item", fields: [] },
  },
  { name: "resetUrl", description: "", required: true },
];

describe("a chip's friendly name", () => {
  it("reads each part's label along the path", () => {
    const name = chipNamer(variables);
    expect(name("customer.firstName")).toBe("Customer › First name");
    expect(name("order")).toBe("Order");
  });

  it("falls back to a part's own name when it has no label", () => {
    const name = chipNamer(variables);
    expect(name("customer.email")).toBe("Customer › email");
    expect(name("resetUrl")).toBe("resetUrl");
    expect(name("unknown.path")).toBe("unknown › path");
  });

  it("names a list's current item by the list's item fields", () => {
    const name = chipNamer(variables, "order.lines");
    expect(name("item.title")).toBe("Item › Product");
    expect(name("item.qty")).toBe("Item › Quantity");
    // Outside the item, names read as everywhere else.
    expect(name("customer.firstName")).toBe("Customer › First name");
  });

  it("reads `item` as a variable outside a list", () => {
    expect(chipNamer(variables)("item")).toBe("Featured item");
  });

  it("offers a list's item fields as item paths", () => {
    expect(itemPaths(variables, "order.lines")).toEqual([
      "item.title",
      "item.qty",
    ]);
    expect(itemPaths(variables, "resetUrl")).toEqual([]);
  });
});
