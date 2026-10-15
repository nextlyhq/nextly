/**
 * The products collection commerce contributes: the catalogue its built-in
 * products source reads.
 *
 * A store that keeps its products elsewhere plugs in its own catalogue source
 * and does not need this collection. A store that keeps them in Nextly edits
 * them here, and the products source turns each entry into a catalogue item.
 *
 * @module catalogue/products-collection
 */
import {
  checkbox,
  text,
  type FieldConfig,
  type PluginContributions,
} from "@nextlyhq/plugin-sdk";

/** A collection as `contributes.collections` takes it. */
export type ContributedCollection = NonNullable<
  PluginContributions["collections"]
>[number];

/**
 * The kinds of stock a product declares, in the order the admin offers them.
 * The products source reads the same list, so the field's choices and what
 * the source accepts cannot drift apart.
 */
export const STOCK_KINDS = [
  "counted",
  "one-off",
  "untracked",
  "to-order",
] as const;

/** @experimental */
export type StockKind = (typeof STOCK_KINDS)[number];

/**
 * The stock kind of a product that names none: commerce counts its stock
 * itself. The field's default and the source's reading of an empty value are
 * both this constant.
 */
export const DEFAULT_STOCK_KIND: StockKind = "untracked";

const STOCK_KIND_LABELS: Record<StockKind, string> = {
  counted: "Counted",
  "one-off": "One of a kind",
  untracked: "Not tracked here",
  "to-order": "Made to order",
};

/**
 * The largest value the number fields below accept. A number field is stored
 * in a 32-bit integer column on PostgreSQL and MySQL, so a larger value would
 * be refused by the database with an error the admin cannot place on the
 * field; refusing it as a field rule names the field instead. For a price
 * that is 21,474,836.47 in a currency with two decimal places.
 */
const LARGEST_STORED_WHOLE_NUMBER = 2_147_483_647;

/**
 * Refuse a fraction. A number field's column is an integer, which rounds or
 * truncates a fraction without saying so, and a price of 19.99 typed as major
 * units would be stored as 19 or 20 minor units. Only a number is judged here:
 * the field's own type rule already reports anything else, and an empty value
 * never reaches a custom rule.
 */
function wholeNumber(value: unknown): string | true {
  return typeof value !== "number" || Number.isInteger(value)
    ? true
    : "Must be a whole number";
}

/**
 * The products collection, under `slug` (`products` unless the host renames
 * it).
 *
 * No `access` rules are declared, so the host's roles and the collection's
 * generated permissions decide who may edit products in the admin, as for any
 * collection the host defines. Commerce itself reads products as the system,
 * so a storefront never depends on those permissions to price a cart.
 *
 * @experimental
 */
export function productsCollection(slug = "products"): ContributedCollection {
  const fields: FieldConfig[] = [
    // The catalogue contract's bound, so a name or SKU too long to sell is
    // refused as it is saved rather than whenever the catalogue is read. A
    // validation rule only: it leaves the column as it is.
    text({ name: "name", label: "Name", required: true, maxLength: 255 }),
    text({
      name: "sku",
      label: "SKU",
      maxLength: 255,
      admin: { description: "The store's own code for the product." },
    }),
    {
      type: "number",
      name: "price",
      label: "Price",
      min: 0,
      max: LARGEST_STORED_WHOLE_NUMBER,
      validate: wholeNumber,
      admin: {
        step: 1,
        description:
          "In the store currency's smallest unit, such as cents: 1999 is 19.99. Leave it empty to give the price on request.",
      },
    },
    {
      type: "select",
      name: "stockKind",
      label: "Stock",
      options: STOCK_KINDS.map(value => ({
        value,
        label: STOCK_KIND_LABELS[value],
      })),
      defaultValue: DEFAULT_STOCK_KIND,
      admin: {
        description:
          "Counted and one-of-a-kind products use the number in stock; made-to-order products use the most per order line.",
      },
    },
    {
      type: "number",
      name: "stockCount",
      label: "In stock",
      min: 0,
      max: LARGEST_STORED_WHOLE_NUMBER,
      validate: wholeNumber,
      admin: {
        step: 1,
        description:
          "Units on hand, for a counted or one-of-a-kind product. Any number above zero means a one-of-a-kind product is available.",
      },
    },
    {
      type: "number",
      name: "maxPerLine",
      label: "Most per order line",
      min: 1,
      max: LARGEST_STORED_WHOLE_NUMBER,
      validate: wholeNumber,
      admin: {
        step: 1,
        description:
          "For a made-to-order product: the most one order line may ask for.",
      },
    },
    checkbox({
      name: "sellable",
      label: "For sale",
      defaultValue: true,
      admin: {
        description: "Untick to keep the product out of the catalogue.",
      },
    }),
  ];

  return {
    slug,
    labels: { singular: "Product", plural: "Products" },
    fields,
    timestamps: true,
    admin: {
      isPlugin: true,
      group: "Commerce",
      icon: "Package",
      useAsTitle: "name",
      defaultColumns: ["name", "sku", "price", "stockKind", "sellable"],
      description: "The products the store sells.",
    },
  };
}
