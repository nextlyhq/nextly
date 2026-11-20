/**
 * A chip's name on screen comes from the declared labels along its path, and
 * inside a list `item` is the list's current item, not a variable of its own.
 */
import { describe, expect, it } from "vitest";

import type { TemplateFormVariable } from "../../schema";
import {
  addressPaths,
  chipNamer,
  itemPaths,
  listPaths,
  variablePaths,
} from "../chip-names";

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

  it("matches a declaration whose own name holds a dot before its fields", () => {
    const dotted: TemplateFormVariable[] = [
      {
        name: "order.lines",
        description: "",
        required: true,
        presentation: {
          type: "list",
          label: "Order lines",
          fields: [
            {
              name: "product",
              label: "Product",
              type: "object",
              fields: [{ name: "title", label: "Title" }],
            },
            {
              name: "options",
              type: "list",
              fields: [{ name: "name" }],
            },
            { name: "qty", label: "Quantity" },
          ],
        },
      },
    ];
    expect(chipNamer(dotted)("order.lines")).toBe("Order lines");
    const inList = chipNamer(dotted, "order.lines");
    expect(inList("item.product.title")).toBe("Item › Product › Title");
    // Through a nested object to its fields; a nested list cannot repeat
    // inside the item, so its fields are not offered.
    expect(itemPaths(dotted, "order.lines")).toEqual([
      "item.product.title",
      "item.qty",
    ]);
  });

  it("offers a list's item fields as item paths", () => {
    expect(itemPaths(variables, "order.lines")).toEqual([
      "item.title",
      "item.qty",
    ]);
    // A list of plain values has no fields: its item is the value itself.
    expect(itemPaths(variables, "resetUrl")).toEqual(["item"]);
    expect(chipNamer(variables, "resetUrl")("item")).toBe("Item");
  });

  it("shows a part's own name when its label is empty", () => {
    const blank: TemplateFormVariable[] = [
      {
        name: "customer",
        description: "",
        required: true,
        presentation: { label: "", fields: [{ name: "email", label: "" }] },
      },
    ];
    expect(chipNamer(blank)("customer.email")).toBe("customer › email");
  });

  it("offers declared lists and the lists inside objects to repeat over, then the rest", () => {
    expect(listPaths(variables)).toEqual([
      // `order` is an object holding the list `lines`.
      "order.lines",
      "customer",
      "order",
      "item",
      "resetUrl",
    ]);
  });

  it("offers every declared path for a link or a condition, the item's first inside a list", () => {
    const everywhere = [
      "customer",
      "customer.firstName",
      "customer.email",
      "order",
      // A list field is offered itself, not what its items hold.
      "order.lines",
      "item",
      "resetUrl",
    ];
    expect(variablePaths(variables)).toEqual(everywhere);
    expect(variablePaths(variables, "order.lines")).toEqual([
      // The item itself, which a condition can ask about, then its fields.
      "item",
      "item.title",
      "item.qty",
      // The variable declared as `item` is out of reach inside the list,
      // where `item` is the loop's: it is offered once, as the loop's.
      ...everywhere.filter(path => path !== "item"),
    ]);
  });

  it("offers a link only values, never the objects and lists a condition may ask about", () => {
    // `customer` and `order` are objects, `order.lines` a list: none is an
    // address. Their value fields are, and so are `item` (declared with no
    // fields, a plain value) and `resetUrl`.
    expect(addressPaths(variables)).toEqual([
      "customer.firstName",
      "customer.email",
      "item",
      "resetUrl",
    ]);
    // Inside a list its item's values come first; the declared `item` is the
    // loop's there, out of reach.
    expect(addressPaths(variables, "order.lines")).toEqual([
      "item.title",
      "item.qty",
      "customer.firstName",
      "customer.email",
      "resetUrl",
    ]);
  });

  it("offers only paths a written email can store", () => {
    const named: TemplateFormVariable[] = [
      {
        name: "customer",
        description: "",
        required: true,
        presentation: {
          fields: [{ name: "first-name" }, { name: "last_name" }],
        },
      },
      {
        name: "lines",
        description: "",
        required: true,
        presentation: {
          type: "list",
          fields: [{ name: "unit price" }, { name: "qty" }],
        },
      },
    ];
    expect(variablePaths(named)).toEqual([
      "customer",
      "customer.last_name",
      "lines",
    ]);
    expect(itemPaths(named, "lines")).toEqual(["item.qty"]);
  });

  it("offers an item's containers inside a list, its nested lists included", () => {
    const shop: TemplateFormVariable[] = [
      {
        name: "lines",
        description: "",
        required: true,
        presentation: {
          type: "list",
          fields: [
            {
              name: "product",
              type: "object",
              fields: [{ name: "title" }],
            },
            { name: "discounts", type: "list", fields: [{ name: "code" }] },
          ],
        },
      },
    ];
    expect(variablePaths(shop, "lines").slice(0, 5)).toEqual([
      "item",
      "item.product",
      "item.product.title",
      // A condition can ask whether the item's own list has entries.
      "item.discounts",
      "lines",
    ]);
  });
});
