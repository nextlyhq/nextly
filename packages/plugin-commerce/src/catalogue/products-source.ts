/**
 * The built-in products source: the catalogue source commerce ships, reading
 * the products collection it contributes (`productsCollection`).
 *
 * Each products entry is a catalogue item whose reference is the entry's id.
 * An entry that is not for sale is not in the catalogue at all. Stock is read
 * from the entry and never written back: commerce keeps its holds and sales
 * in its own tables, so this source hears no stock reports.
 *
 * Every entry read is parsed at this boundary. A stored value outside what the
 * catalogue can carry (a fractional price, a negative count, a counted product
 * with no count) makes the read fail with the entry named, rather than turn
 * into a zero a buyer would be charged or refused on.
 *
 * @module catalogue/products-source
 */
import { Buffer } from "node:buffer";

import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import {
  catalogueItemSchema,
  pricedLineSchema,
  type CatalogueItem,
  type CatalogueSource,
  type CatalogueStock,
  type PricedLine,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { assertCurrency } from "../money/currency";
import { money } from "../money/money";
import { issuePath, parseRequest } from "../request-input";

import {
  DEFAULT_STOCK_KIND,
  STOCK_KINDS,
  type StockKind,
} from "./products-collection";

/** @experimental */
export interface ProductsSourceOptions {
  /**
   * The plugin's collection service, `ctx.services.collections`. Typed as the
   * one method the source calls, so the real service is accepted as it is and
   * a test can hand in a stand-in that answers only that.
   */
  readonly collections: Pick<
    PluginContext["services"]["collections"],
    "listEntries"
  >;
  /** The products collection's slug, as `productsCollection` was given it. */
  readonly slug: string;
  /** The store's currency; every listed price is in it. */
  readonly currency: string;
}

const SOURCE_ID = "products";

/**
 * The most rows the managed collection service returns in one page. It drops
 * a larger `limit`, so the source never asks for more than this at once.
 */
const SERVICE_PAGE_CAP = 500;

/**
 * The longest reference the catalogue contract carries. A longer one cannot
 * be an entry id, so it is left out as unknown without being asked for.
 */
const LONGEST_REFERENCE = 255;

/** The fields the source maps into an item. The id always comes back. */
const MAPPED_FIELDS: Record<string, boolean> = {
  name: true,
  sku: true,
  price: true,
  stockKind: true,
  stockCount: true,
  maxPerLine: true,
};

const wholeNumber = z.number().int();

/**
 * One stored products entry, read into the item it stands for with its price
 * still a bare amount. `int()` refuses a fraction and any number beyond a
 * safe integer, so a value the database rounded or a driver widened is caught
 * here. An empty stock kind is the field's own default; an empty count for a
 * kind that needs one is refused, since reading it as zero would sell out a
 * product nobody counted.
 */
const storedProductSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sku: z.string().nullish(),
    price: wholeNumber.min(0).nullish(),
    stockKind: z.enum(STOCK_KINDS).nullish(),
    stockCount: wholeNumber.min(0).nullish(),
    maxPerLine: wholeNumber.min(1).nullish(),
  })
  .transform((row, ctx) => {
    const read = storedStock(row);
    if ("missing" in read) {
      ctx.addIssue({
        code: "custom",
        path: [read.missing],
        message: read.message,
      });
      return z.NEVER;
    }
    return {
      reference: row.id,
      name: row.name,
      // An emptied text field is stored as an empty string; it is no SKU.
      ...(row.sku ? { sku: row.sku } : {}),
      price: row.price ?? null,
      stock: read.stock,
    };
  });

type StoredStock =
  | { readonly stock: CatalogueStock }
  | { readonly missing: "stockCount" | "maxPerLine"; readonly message: string };

/**
 * The stock a stored product stands for, or the field a product of its kind
 * needs and does not have.
 */
function storedStock(row: {
  readonly stockKind?: StockKind | null;
  readonly stockCount?: number | null;
  readonly maxPerLine?: number | null;
}): StoredStock {
  const kind = row.stockKind ?? DEFAULT_STOCK_KIND;
  if (kind === "untracked") return { stock: { kind } };
  if (kind === "to-order") return madeToOrder(row.maxPerLine ?? null);
  return countedStock(kind, row.stockCount ?? null);
}

function madeToOrder(maxPerLine: number | null): StoredStock {
  return maxPerLine === null
    ? {
        missing: "maxPerLine",
        message: "a made-to-order product has no most per line",
      }
    : { stock: { kind: "to-order", maxPerLine } };
}

function countedStock(
  kind: "counted" | "one-off",
  count: number | null
): StoredStock {
  if (count === null) {
    return { missing: "stockCount", message: `a ${kind} product has no count` };
  }
  // A one-off product is a single unit, so any count above zero is that unit
  // still being available.
  const available = kind === "one-off" ? Math.min(count, 1) : count;
  return { stock: { kind, available } };
}

const findInputSchema = z.object({ references: z.array(z.string()) });

// A line is answered with its own reference and quantity, so a line the
// contract could not carry back (an empty reference, a quantity of zero) is
// refused rather than answered outside the contract.
const priceInputSchema = z.object({
  currency: z.string(),
  lines: z.array(
    z.object({
      reference: z.string().min(1),
      quantity: wholeNumber.min(1),
    })
  ),
});

// A page size below one could never move a listing forward.
const listInputSchema = z.object({
  limit: wholeNumber.min(1),
  cursor: z.string().nullish(),
  search: z.string().optional(),
});

// The whole options object is parsed before any field is read: server code
// can call this without types, and a missing object, a missing service or a
// key the schema does not know is then a validation error, not a crash. The
// currency is held to a sales currency after, under its own error.
const optionsSchema = z.strictObject({
  collections: z.custom<ProductsSourceOptions["collections"]>(
    value =>
      typeof value === "object" &&
      value !== null &&
      "listEntries" in value &&
      typeof value.listEntries === "function",
    "Expected the collection service."
  ),
  slug: z.string().min(1),
  currency: z.string(),
});

/** Parse what a caller handed the source, refusing it as a validation error. */
function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  method: string
): T {
  return parseRequest(schema, input, { source: SOURCE_ID, method });
}

/**
 * The cursor for the page after `id`. It names the last id handed out, so the
 * next page starts strictly after it: each cursor is new, and a product added
 * or removed between pages neither repeats nor shifts the listing. Encoded so
 * a caller treats it as opaque rather than as an id it may edit.
 */
const CURSOR_PREFIX = "after:";

function cursorAfter(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, "utf8").toString("base64url");
}

/** The id a cursor this source issued names, or a refusal for any other. */
function idAfter(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const id = decoded.startsWith(CURSOR_PREFIX)
    ? decoded.slice(CURSOR_PREFIX.length)
    : "";
  // Re-encoded and compared, because base64 decoding skips characters it
  // does not know: only the exact spelling this source handed out is taken.
  if (id === "" || cursorAfter(id) !== cursor) {
    throw NextlyError.validation({
      errors: [
        {
          path: "cursor",
          code: "INVALID",
          message: "Not a cursor this source issued.",
        },
      ],
      logContext: { source: SOURCE_ID, method: "list" },
    });
  }
  return id;
}

/** The id of an entry as it arrived, for naming it in an error. */
function entryId(entry: unknown): unknown {
  return typeof entry === "object" && entry !== null && "id" in entry
    ? entry.id
    : undefined;
}

/**
 * Build the products source over the products collection.
 *
 * @experimental
 * @throws `VALIDATION_ERROR` for options it cannot parse, an empty slug
 *   among them, and `COMMERCE_UNKNOWN_CURRENCY` for a store currency that is
 *   not a sales currency.
 */
export function createProductsSource(
  options: ProductsSourceOptions
): CatalogueSource {
  const { collections, slug, currency } = parseInput(
    optionsSchema,
    options,
    "create"
  );
  assertCurrency(currency);

  /**
   * Refuse a stored entry the catalogue cannot carry. The store's own data is
   * at fault rather than an upstream answer, so this is its own error, with
   * the entry's id and what was wrong with it for the operator; nothing stored
   * is echoed to the caller.
   */
  function entryRefused(entry: unknown, error: z.ZodError): NextlyError {
    return commerceError("COMMERCE_CATALOGUE_ENTRY_INVALID", {
      source: SOURCE_ID,
      collection: slug,
      entry,
      issues: error.issues.map(issue => ({
        path: issuePath(issue.path),
        message: issue.message,
      })),
    });
  }

  /**
   * One entry as the item it stands for. The finished item is parsed by the
   * contract's own schema too, so the source can only ever answer inside it.
   */
  function toItem(entry: unknown): CatalogueItem {
    const stored = storedProductSchema.safeParse(entry);
    if (!stored.success) throw entryRefused(entryId(entry), stored.error);
    const { price, ...item } = stored.data;
    const checked = catalogueItemSchema.safeParse({
      ...item,
      price:
        price === null
          ? { kind: "on-request" }
          : { kind: "listed", unitPrice: money(price, currency) },
    });
    if (!checked.success) throw entryRefused(entryId(entry), checked.error);
    return checked.data;
  }

  /**
   * One page of sellable entries matching `where`, in id order. Read as the
   * system: the catalogue is the store's, not the asking visitor's, and the
   * admin's permissions on the collection are about editing it.
   */
  async function readPage(
    where: Record<string, unknown>,
    limit: number
  ): Promise<{ items: CatalogueItem[]; hasMore: boolean }> {
    const result = await collections.listEntries(
      slug,
      {
        where: { ...where, sellable: { equals: true } },
        depth: 0,
        select: { ...MAPPED_FIELDS },
        // Ordered explicitly: the service orders a query only when asked, and
        // a listing's cursor relies on the order being the ids'.
        sort: { field: "id", direction: "asc" },
        pagination: { limit, page: 1 },
      },
      { as: "system" }
    );
    return {
      items: result.data.map(toItem),
      hasMore: result.pagination.hasMore,
    };
  }

  /**
   * The sellable items among `references`, by reference. Each id is asked
   * for once, in as few reads as the service's page allows.
   */
  async function readByIds(
    references: readonly string[]
  ): Promise<Map<string, CatalogueItem>> {
    const ids = [...new Set(references)].filter(
      id => id.length > 0 && id.length <= LONGEST_REFERENCE
    );
    const found = new Map<string, CatalogueItem>();
    for (let start = 0; start < ids.length; start += SERVICE_PAGE_CAP) {
      const chunk = ids.slice(start, start + SERVICE_PAGE_CAP);
      // One read at a time, so a long list never holds several of the
      // database's connections at once.
      const page = await readPage({ id: { in: chunk } }, chunk.length);
      for (const item of page.items) found.set(item.reference, item);
    }
    return found;
  }

  return {
    id: SOURCE_ID,

    async find(input) {
      const { references } = parseInput(findInputSchema, input, "find");
      const found = await readByIds(references);
      // In the order first asked, each once.
      return [...new Set(references)].flatMap(reference => {
        const item = found.get(reference);
        return item ? [item] : [];
      });
    },

    async price(input) {
      const { currency: asked, lines } = parseInput(
        priceInputSchema,
        input,
        "price"
      );
      // Before any read: a price in another currency is never one this
      // source can give, whatever the entries hold.
      if (asked !== currency) {
        throw commerceError("COMMERCE_CURRENCY_MISMATCH", {
          source: SOURCE_ID,
          asked,
          store: currency,
        });
      }
      const found = await readByIds(lines.map(line => line.reference));
      return lines.map((line): PricedLine => {
        const item = found.get(line.reference);
        const answer: PricedLine = item
          ? { ...line, found: true, price: item.price, stock: item.stock }
          : { ...line, found: false };
        const checked = pricedLineSchema.safeParse(answer);
        if (!checked.success) {
          throw entryRefused(line.reference, checked.error);
        }
        return checked.data;
      });
    },

    async list(input) {
      const { limit, cursor, search } = parseInput(
        listInputSchema,
        input,
        "list"
      );
      const after =
        cursor === null || cursor === undefined ? undefined : idAfter(cursor);
      const term = search?.trim();
      const page = await readPage(
        {
          ...(after === undefined ? {} : { id: { greater_than: after } }),
          ...(term
            ? {
                or: [{ name: { contains: term } }, { sku: { contains: term } }],
              }
            : {}),
        },
        Math.min(limit, SERVICE_PAGE_CAP)
      );
      const last = page.items.at(-1);
      // More entries behind an empty page cannot be reached by a cursor, so
      // the listing would end early without saying so.
      if (page.hasMore && last === undefined) {
        throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
          source: SOURCE_ID,
          collection: slug,
          reason: "more entries reported after an empty page",
        });
      }
      return {
        items: page.items,
        nextCursor: page.hasMore && last ? cursorAfter(last.reference) : null,
      };
    },
  };
}
