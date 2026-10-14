import { z } from "zod";

import {
  findItems,
  listItems,
  MAX_CURSOR_LENGTH,
} from "../cart/catalogue-read";
import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import type { Money } from "../money/money";
import { parseRequest } from "../request-input";

/** The most references one lookup takes. */
export const MAX_FIND_REFERENCES = 100;

/** The page size when a caller names none, and the largest it may ask for. */
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/**
 * An item as a shopper sees it. Built field by field from the source's item,
 * so nothing a source adds reaches a response.
 *
 * @experimental
 */
export interface CatalogueItemView {
  readonly reference: string;
  readonly name: string;
  readonly sku: string | null;
  readonly price:
    | { readonly kind: "listed"; readonly unitPrice: Money }
    | { readonly kind: "on-request" };
  readonly stock: CatalogueItem["stock"];
}

/** @experimental */
export interface CataloguePageView {
  readonly items: readonly CatalogueItemView[];
  /** Pass back as `cursor` for the next page; `null` after the last. */
  readonly nextCursor: string | null;
}

/**
 * The catalogue as a storefront reads it, through whichever source the site
 * configured. Every answer is checked against the catalogue contract first.
 *
 * @experimental
 */
export interface CatalogueService {
  /** The items with these references, in the order asked; one it does not know is left out. */
  find(input: {
    readonly references: readonly string[];
  }): Promise<readonly CatalogueItemView[]>;
  /** One page of the catalogue, optionally narrowed by a search. */
  list(input: {
    readonly limit?: number;
    readonly cursor?: string | null;
    readonly search?: string;
  }): Promise<CataloguePageView>;
}

const findSchema = z.strictObject({
  references: z
    .array(z.string().min(1).max(255))
    .min(1)
    .max(MAX_FIND_REFERENCES),
});

const listSchema = z.strictObject({
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).nullable().optional(),
  search: z.string().min(1).max(200).optional(),
});

/** @experimental */
export function createCatalogueService(options: {
  readonly source: CatalogueSource;
  readonly currency: string;
}): CatalogueService {
  const { source, currency } = options;
  return {
    // Each method parses the input exactly as it was passed: server code
    // calls these directly, so a missing or malformed argument, or a key the
    // schema does not know, is a validation error rather than a crash or a
    // key silently dropped.
    async find(input) {
      const { references } = parseRequest(findSchema, input);
      const found = await findItems(source, currency, references);
      const answered = new Set<string>();
      const items: CatalogueItemView[] = [];
      for (const reference of references) {
        const item = found.get(reference);
        if (!item || answered.has(reference)) continue;
        answered.add(reference);
        items.push(itemView(item));
      }
      return items;
    },

    async list(input) {
      const { limit, cursor, search } = parseRequest(listSchema, input);
      const page = await listItems(source, currency, {
        limit: limit ?? DEFAULT_PAGE_SIZE,
        cursor: cursor ?? null,
        ...(search === undefined ? {} : { search }),
      });
      return { items: page.items.map(itemView), nextCursor: page.nextCursor };
    },
  };
}

function itemView(item: CatalogueItem): CatalogueItemView {
  return {
    reference: item.reference,
    name: item.name,
    sku: item.sku ?? null,
    price:
      item.price.kind === "listed"
        ? { kind: "listed", unitPrice: item.price.unitPrice }
        : { kind: "on-request" },
    stock: stockView(item.stock),
  };
}

function stockView(stock: CatalogueItem["stock"]): CatalogueItem["stock"] {
  switch (stock.kind) {
    case "counted":
    case "one-off":
      return { kind: stock.kind, available: stock.available };
    case "to-order":
      return { kind: "to-order", maxPerLine: stock.maxPerLine };
    case "untracked":
      return { kind: "untracked" };
  }
}
