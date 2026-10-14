import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  catalogueItemSchema,
  pricedLineSchema,
  type CatalogueItem,
  type CatalogueSource,
  type PricedLine,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";

/**
 * Reading a catalogue source, for the cart, checkout and the catalogue routes
 * alike.
 *
 * A source is code commerce does not control, so its answer is checked
 * against the contract before anything uses it: an item that is malformed,
 * that was not asked for, or whose listed price is in another currency is
 * refused as a broken answer rather than shown. A source that fails to answer
 * at all is an outage, said as one; an error it raised on purpose passes
 * through as it was raised.
 */

/**
 * The longest cursor a storefront may pass back for the next page, and so the
 * longest a source may hand out: one longer could never be followed.
 */
export const MAX_CURSOR_LENGTH = 1024;

/** A page of the catalogue, and the cursor to the next, `null` after the last. */
export interface CataloguePage {
  readonly items: readonly CatalogueItem[];
  readonly nextCursor: string | null;
}

/**
 * The source's items for `references`, keyed by reference, read with one call.
 *
 * @throws `COMMERCE_PROVIDER_CONTRACT`, `COMMERCE_CATALOGUE_UNAVAILABLE`
 */
export async function findItems(
  source: CatalogueSource,
  currency: string,
  references: readonly string[]
): Promise<Map<string, CatalogueItem>> {
  const found = new Map<string, CatalogueItem>();
  if (references.length === 0) return found;
  const asked = new Set(references);

  const answer = await ask(source, "find", () =>
    source.find({ references: [...asked] })
  );
  if (!Array.isArray(answer)) {
    throw broken(source, "find did not answer a list");
  }
  for (const raw of answer) {
    const item = checkedItem(source, currency, "find", raw);
    if (!asked.has(item.reference) || found.has(item.reference)) {
      throw broken(
        source,
        "find answered an item it was not asked for, or one twice",
        { reference: item.reference }
      );
    }
    found.set(item.reference, item);
  }
  return found;
}

/**
 * One page of the source's listing.
 *
 * @throws `COMMERCE_CATALOGUE_NOT_LISTABLE` for a source that only looks
 *   items up, `COMMERCE_PROVIDER_CONTRACT`, `COMMERCE_CATALOGUE_UNAVAILABLE`
 */
export async function listItems(
  source: CatalogueSource,
  currency: string,
  input: {
    readonly limit: number;
    readonly cursor: string | null;
    readonly search?: string;
  }
): Promise<CataloguePage> {
  // Bound, so a source written as a class keeps its `this`.
  const list = source.list?.bind(source);
  if (!list) {
    throw commerceError("COMMERCE_CATALOGUE_NOT_LISTABLE", {
      source: source.id,
    });
  }
  const answer: unknown = await ask(source, "list", () =>
    list({
      limit: input.limit,
      cursor: input.cursor,
      ...(input.search === undefined ? {} : { search: input.search }),
    })
  );
  if (typeof answer !== "object" || answer === null) {
    throw broken(source, "list did not answer a page");
  }
  const { items, nextCursor } = answer as Record<string, unknown>;
  if (!Array.isArray(items) || items.length > input.limit) {
    throw broken(source, "list answered no items, or more than asked for");
  }
  if (nextCursor !== null && typeof nextCursor !== "string") {
    throw broken(source, "list answered a cursor that is not a string");
  }
  // Every page but the last holds an item, so a listing always moves
  // forward; an empty page that names a next one would have a storefront
  // following cursors for ever.
  if (items.length === 0 && nextCursor !== null) {
    throw broken(source, "list answered an empty page with a next cursor");
  }
  // A cursor comes back as the next call's input, so it must be one that
  // input accepts; and one naming the page just read as the next would have
  // a storefront reading that page for ever.
  if (
    nextCursor !== null &&
    (nextCursor.length === 0 || nextCursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw broken(source, "list answered a cursor that cannot be passed back", {
      length: nextCursor.length,
    });
  }
  if (nextCursor !== null && nextCursor === input.cursor) {
    throw broken(source, "list answered the cursor it was given as the next");
  }
  const seen = new Set<string>();
  const checked = items.map(raw => {
    const item = checkedItem(source, currency, "list", raw);
    if (seen.has(item.reference)) {
      throw broken(source, "list answered an item twice", {
        reference: item.reference,
      });
    }
    seen.add(item.reference);
    return item;
  });
  return { items: checked, nextCursor };
}

/**
 * The source's priced lines for `asked`, one per line asked, in its order,
 * read with one call. A line the source does not know is answered as not
 * found, for the caller to refuse; a listed price in another currency is a
 * broken answer.
 *
 * @throws `COMMERCE_PROVIDER_CONTRACT`, `COMMERCE_CATALOGUE_UNAVAILABLE`
 */
export async function priceItems(
  source: CatalogueSource,
  currency: string,
  asked: readonly { readonly reference: string; readonly quantity: number }[]
): Promise<PricedLine[]> {
  if (asked.length === 0) return [];
  const answer: unknown = await ask(source, "price", () =>
    source.price({ currency, lines: asked })
  );
  if (!Array.isArray(answer) || answer.length !== asked.length) {
    throw broken(source, "price did not answer one line per line asked");
  }
  return asked.map((line, index) => {
    const parsed = pricedLineSchema.safeParse(answer[index]);
    if (
      !parsed.success ||
      parsed.data.reference !== line.reference ||
      parsed.data.quantity !== line.quantity
    ) {
      throw broken(
        source,
        "price answered a line outside the contract, or out of order"
      );
    }
    const priced = parsed.data;
    if (
      priced.found &&
      priced.price.kind === "listed" &&
      priced.price.unitPrice.currency !== currency
    ) {
      throw broken(source, "price answered another currency");
    }
    return priced;
  });
}

async function ask<T>(
  source: CatalogueSource,
  method: string,
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NextlyError) throw error;
    // The error's kind only, never its message: a source's HTTP client can
    // put a request URL, and the key in it, into the message, and this
    // context is written to the logs.
    throw commerceError("COMMERCE_CATALOGUE_UNAVAILABLE", {
      source: source.id,
      method,
      errorKind: error instanceof Error ? error.name : typeof error,
    });
  }
}

function checkedItem(
  source: CatalogueSource,
  currency: string,
  method: string,
  raw: unknown
): CatalogueItem {
  const parsed = catalogueItemSchema.safeParse(raw);
  if (!parsed.success) {
    throw broken(source, `${method} answered an item outside the contract`, {
      issues: parsed.error.issues.map(issue => issue.message),
    });
  }
  const item = parsed.data;
  if (
    item.price.kind === "listed" &&
    item.price.unitPrice.currency !== currency
  ) {
    throw broken(source, `${method} answered a price in another currency`, {
      reference: item.reference,
    });
  }
  return item;
}

function broken(
  source: CatalogueSource,
  reason: string,
  detail: Record<string, unknown> = {}
): NextlyError {
  return commerceError("COMMERCE_PROVIDER_CONTRACT", {
    source: source.id,
    reason,
    ...detail,
  });
}
