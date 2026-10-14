import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import {
  assertCatalogueSource,
  catalogueItemSchema,
  stockReportSchema,
  type CatalogueItem,
  type CatalogueSource,
  type CatalogueStock,
  type PricedLine,
  type StockReport,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { assertCurrency } from "../money/currency";

import { later } from "./later";

/** @experimental */
export interface InMemoryCatalogueSourceOptions {
  /** The source's id. Defaults to "memory". */
  readonly id?: string;
  /** The store's currency; every listed price must be in it. */
  readonly currency: string;
  readonly items: readonly CatalogueItem[];
}

/** @experimental */
export interface InMemoryCatalogueSourceControl {
  /** The source's own figure for an item's stock, after the sales reported to it. */
  stock(reference: string): CatalogueStock | undefined;
  /** Every stock report it recorded, once each, oldest first. */
  reports(): readonly StockReport[];
}

// What a caller may ask, held to the contract before the source answers: a
// page of at least one item, and lines each naming a reference and a whole
// quantity of at least one.
const listInputSchema = z.object({
  limit: z.number().int().positive(),
  cursor: z.string().nullish(),
  search: z.string().optional(),
});
const priceLinesSchema = z.array(
  z.object({
    reference: z.string().min(1),
    quantity: z.number().int().positive(),
  })
);

function parsed<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw NextlyError.validation({
      errors: result.error.issues.map(issue => ({
        path: issue.path.join("."),
        code: "INVALID",
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/**
 * A catalogue source that keeps its items in memory, for tests and examples.
 * It passes the catalogue contract suite, and acts as an inventory system
 * would: a reported sale lowers its own count once, however often the report
 * is repeated.
 *
 * @experimental
 */
export function createInMemoryCatalogueSource(
  options: InMemoryCatalogueSourceOptions
): { source: CatalogueSource; control: InMemoryCatalogueSourceControl } {
  assertCurrency(options.currency);
  const items = new Map<string, CatalogueItem>();
  for (const item of options.items) {
    const parsed = catalogueItemSchema.parse(item);
    if (
      parsed.price.kind === "listed" &&
      parsed.price.unitPrice.currency !== options.currency
    ) {
      throw commerceError("COMMERCE_CURRENCY_MISMATCH", {
        reference: parsed.reference,
      });
    }
    items.set(parsed.reference, parsed);
  }
  const order = [...items.keys()];
  const recorded = new Map<
    string,
    { fingerprint: string; report: StockReport }
  >();

  function adjustForSale(report: StockReport): void {
    const item = items.get(report.reference);
    // Neither is counted: an untracked item is commerce's to count, and an
    // item sold to order has no stock to lower.
    if (
      !item ||
      item.stock.kind === "untracked" ||
      item.stock.kind === "to-order"
    ) {
      return;
    }
    // A sale already happened by the time it is reported, so the count stops
    // at zero rather than refusing a report commerce cannot take back.
    const available = Math.max(0, item.stock.available - report.quantity);
    const stock: CatalogueStock =
      item.stock.kind === "one-off"
        ? { kind: "one-off", available: available === 0 ? 0 : 1 }
        : { kind: "counted", available };
    items.set(report.reference, { ...item, stock });
  }

  const source: CatalogueSource = {
    id: options.id ?? "memory",
    find: input =>
      later(() => {
        const seen = new Set<string>();
        const found: CatalogueItem[] = [];
        for (const reference of input.references) {
          const item = items.get(reference);
          if (item && !seen.has(reference)) {
            seen.add(reference);
            found.push(item);
          }
        }
        return found;
      }),
    price: input =>
      later(() => {
        parsed(priceLinesSchema, input.lines);
        if (input.currency !== options.currency) {
          throw commerceError("COMMERCE_CURRENCY_MISMATCH", {
            asked: input.currency,
            store: options.currency,
          });
        }
        return input.lines.map((line): PricedLine => {
          const item = items.get(line.reference);
          return item
            ? {
                reference: line.reference,
                quantity: line.quantity,
                found: true,
                price: item.price,
                stock: item.stock,
              }
            : {
                reference: line.reference,
                quantity: line.quantity,
                found: false,
              };
        });
      }),
    list: input =>
      later(() => {
        parsed(listInputSchema, input);
        const search = input.search?.toLowerCase();
        const matching = order
          .map(reference => items.get(reference))
          .filter((item): item is CatalogueItem => item !== undefined)
          .filter(
            item =>
              !search ||
              item.name.toLowerCase().includes(search) ||
              (item.sku?.toLowerCase().includes(search) ?? false)
          );
        // A cursor is the position this source handed out; anything else is
        // refused rather than read as the first page.
        if (input.cursor && !/^\d+$/.test(input.cursor)) {
          throw NextlyError.validation({
            errors: [
              {
                path: "cursor",
                code: "INVALID",
                message: "Not a cursor this source issued.",
              },
            ],
          });
        }
        const startAt = input.cursor ? Number(input.cursor) : 0;
        const page = matching.slice(startAt, startAt + input.limit);
        const next = startAt + page.length;
        return {
          items: page,
          nextCursor: next < matching.length ? String(next) : null,
        };
      }),
    stock: {
      report: input =>
        later(() => {
          const report = stockReportSchema.parse(input);
          const fingerprint = JSON.stringify([
            report.kind,
            report.reference,
            report.quantity,
            report.orderReference,
          ]);
          const seen = recorded.get(report.operationId);
          if (seen) {
            if (seen.fingerprint !== fingerprint) {
              throw commerceError("COMMERCE_OPERATION_KEY_REUSED", {
                source: options.id ?? "memory",
              });
            }
            return;
          }
          recorded.set(report.operationId, { fingerprint, report });
          if (report.kind === "sale") adjustForSale(report);
        }),
      confirm: input =>
        later(() => ({ recorded: recorded.has(input.operationId) })),
    },
  };

  const control: InMemoryCatalogueSourceControl = {
    stock: reference => items.get(reference)?.stock,
    reports: () => [...recorded.values()].map(r => r.report),
  };

  // The same declaration rules commerce applies (a lower-case slug for an
  // id among them), so a source made here is never one commerce refuses.
  assertCatalogueSource(source);
  return { source, control };
}
