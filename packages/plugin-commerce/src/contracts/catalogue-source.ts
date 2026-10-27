import { z } from "zod";

import { commerceError } from "../errors";
import { moneySchema, type Money } from "../money/money";

import { operationIdSchema, type OperationId } from "./operation";

/**
 * An item's price: listed, or given only on request (the buyer asks for a
 * quote instead of adding it to a cart).
 *
 * @experimental
 */
export type CataloguePrice =
  | { readonly kind: "listed"; readonly unitPrice: Money }
  | { readonly kind: "on-request" };

/**
 * How much of an item the source says is available.
 *
 * - `one-off`: a single unit (a used machine); `available` is 0 or 1.
 * - `counted`: a number of units on hand.
 * - `untracked`: the source does not count it; commerce's own stock applies.
 * - `to-order`: made to order or on backorder. Nothing is held for it, and a
 *   line may ask for at most `maxPerLine`, the source's own limit.
 *
 * Commerce adds its own holds on top of what a source reports, so this is the
 * source's figure, not the buyable one.
 *
 * @experimental
 */
export type CatalogueStock =
  | { readonly kind: "one-off" | "counted"; readonly available: number }
  | { readonly kind: "untracked" }
  | { readonly kind: "to-order"; readonly maxPerLine: number };

/** @experimental */
export interface CatalogueItem {
  /** The source's stable key for the item; commerce stores it on lines and orders. */
  readonly reference: string;
  readonly name: string;
  readonly sku?: string;
  readonly price: CataloguePrice;
  readonly stock: CatalogueStock;
}

/**
 * One line priced for checkout: the authoritative price and availability at
 * the moment of asking, never a cached listing.
 *
 * @experimental
 */
export type PricedLine =
  | {
      readonly reference: string;
      readonly quantity: number;
      readonly found: true;
      readonly price: CataloguePrice;
      readonly stock: CatalogueStock;
    }
  | {
      readonly reference: string;
      readonly quantity: number;
      readonly found: false;
    };

/**
 * A stock change commerce reports to a source that wants to hear it: a hold
 * while a buyer pays, its release if they do not, the sale if they do.
 *
 * @experimental
 */
export interface StockReport {
  /** Commerce's identifier for this report; reporting it twice is one report. */
  readonly operationId: OperationId;
  readonly kind: "hold" | "release" | "sale";
  readonly reference: string;
  readonly quantity: number;
  /** Commerce's order the change belongs to. */
  readonly orderReference: string;
}

/**
 * The optional half of the contract for a source that keeps its own stock
 * (an outside inventory system). Both methods together, or neither.
 *
 * @experimental
 */
export interface CatalogueStockListener {
  /**
   * Record the change. A report repeated with the same `operationId` is
   * recorded once; the same `operationId` with a different report is refused.
   */
  report(input: StockReport): Promise<void>;
  /** Whether the report with this `operationId` was recorded. */
  confirm(input: {
    readonly operationId: OperationId;
  }): Promise<{ readonly recorded: boolean }>;
}

/**
 * The contract every catalogue source implements: commerce's built-in products
 * source, or a site's own (an outside product API).
 *
 * @experimental
 */
export interface CatalogueSource {
  /** A short, stable key for the source. */
  readonly id: string;
  /**
   * The items with these references. A reference the source does not know is
   * left out, never answered with a placeholder.
   */
  find(input: {
    readonly references: readonly string[];
  }): Promise<readonly CatalogueItem[]>;
  /**
   * Price lines for checkout in the store's currency: one answer per line, in
   * the order asked, `found: false` for a reference it does not know.
   */
  price(input: {
    readonly currency: string;
    readonly lines: readonly {
      readonly reference: string;
      readonly quantity: number;
    }[];
  }): Promise<readonly PricedLine[]>;
  /**
   * Browse the catalogue a page at a time, optionally narrowed by a search.
   * Each item is listed once; every page but the last holds at least one
   * item, and a cursor is handed out once, so a listing always moves forward.
   */
  list?(input: {
    readonly limit: number;
    readonly cursor?: string | null;
    readonly search?: string;
  }): Promise<{
    readonly items: readonly CatalogueItem[];
    readonly nextCursor: string | null;
  }>;
  /** Hear about holds, releases and sales. */
  readonly stock?: CatalogueStockListener;
}

/** A listed price: what one unit costs. */
type ListedPriceShape = {
  kind: z.ZodLiteral<"listed">;
  unitPrice: typeof moneySchema;
};
/** A price given only on request. */
type OnRequestPriceShape = { kind: z.ZodLiteral<"on-request"> };
/** The kinds of price {@link priceSchema} accepts, in the order it lists them. */
type PriceVariants = [
  z.ZodObject<ListedPriceShape, z.core.$strict>,
  z.ZodObject<OnRequestPriceShape, z.core.$strict>,
];

const priceSchema: z.ZodDiscriminatedUnion<PriceVariants, "kind"> =
  z.discriminatedUnion<PriceVariants, "kind">("kind", [
    z.strictObject<ListedPriceShape>({
      kind: z.literal("listed"),
      // Money may be negative in arithmetic, but a price commerce charges from
      // is not: a negative one would take money off an order's total.
      unitPrice: moneySchema.refine(m => m.amount >= 0, {
        message: "a listed price is not negative",
      }),
    }),
    z.strictObject<OnRequestPriceShape>({ kind: z.literal("on-request") }),
  ]);

/** One item, either available or not. */
type OneOffStockShape = {
  kind: z.ZodLiteral<"one-off">;
  available: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
};
/** A counted quantity. */
type CountedStockShape = {
  kind: z.ZodLiteral<"counted">;
  available: z.ZodNumber;
};
/** Stock nobody counts. */
type UntrackedStockShape = { kind: z.ZodLiteral<"untracked"> };
/** Made to order, up to a quantity per line. */
type ToOrderStockShape = {
  kind: z.ZodLiteral<"to-order">;
  maxPerLine: z.ZodNumber;
};
/** The kinds of stock {@link stockSchema} accepts, in the order it lists them. */
type StockVariants = [
  z.ZodObject<OneOffStockShape, z.core.$strict>,
  z.ZodObject<CountedStockShape, z.core.$strict>,
  z.ZodObject<UntrackedStockShape, z.core.$strict>,
  z.ZodObject<ToOrderStockShape, z.core.$strict>,
];

const stockSchema: z.ZodDiscriminatedUnion<StockVariants, "kind"> =
  z.discriminatedUnion<StockVariants, "kind">("kind", [
    z.strictObject<OneOffStockShape>({
      kind: z.literal("one-off"),
      available: z.union([z.literal(0), z.literal(1)]),
    }),
    z.strictObject<CountedStockShape>({
      kind: z.literal("counted"),
      available: z.number().int().nonnegative(),
    }),
    z.strictObject<UntrackedStockShape>({ kind: z.literal("untracked") }),
    z.strictObject<ToOrderStockShape>({
      kind: z.literal("to-order"),
      maxPerLine: z.number().int().positive(),
    }),
  ]);

/** The fields of {@link catalogueItemSchema}. */
type CatalogueItemShape = {
  reference: z.ZodString;
  name: z.ZodString;
  sku: z.ZodOptional<z.ZodString>;
  price: typeof priceSchema;
  stock: typeof stockSchema;
};

/** @experimental */
export const catalogueItemSchema: z.ZodObject<
  CatalogueItemShape,
  z.core.$strict
> = z.strictObject<CatalogueItemShape>({
  reference: z.string().min(1).max(255),
  // Bounded so every dialect stores an order's snapshot of them whole: past
  // 255 characters is a broken answer everywhere, not a failed order on one
  // database alone.
  name: z.string().min(1).max(255),
  sku: z.string().min(1).max(255).optional(),
  price: priceSchema,
  stock: stockSchema,
});

/** A line whose item was found, with its price and stock. */
type FoundLineShape = {
  reference: z.ZodString;
  quantity: z.ZodNumber;
  found: z.ZodLiteral<true>;
  price: typeof priceSchema;
  stock: typeof stockSchema;
};
/** A line whose item was not found. */
type MissingLineShape = {
  reference: z.ZodString;
  quantity: z.ZodNumber;
  found: z.ZodLiteral<false>;
};
/** The kinds of line {@link pricedLineSchema} accepts, in the order it lists them. */
type PricedLineVariants = [
  z.ZodObject<FoundLineShape, z.core.$strict>,
  z.ZodObject<MissingLineShape, z.core.$strict>,
];

/** @experimental */
export const pricedLineSchema: z.ZodDiscriminatedUnion<
  PricedLineVariants,
  "found"
> = z.discriminatedUnion<PricedLineVariants, "found">("found", [
  z.strictObject<FoundLineShape>({
    reference: z.string().min(1),
    quantity: z.number().int().positive(),
    found: z.literal(true),
    price: priceSchema,
    stock: stockSchema,
  }),
  z.strictObject<MissingLineShape>({
    reference: z.string().min(1),
    quantity: z.number().int().positive(),
    found: z.literal(false),
  }),
]);

/** The kinds of stock movement {@link stockReportSchema} reports. */
type StockReportKinds = readonly ["hold", "release", "sale"];
/** The fields of {@link stockReportSchema}. */
type StockReportShape = {
  operationId: typeof operationIdSchema;
  kind: z.ZodEnum<{ [K in StockReportKinds[number]]: K }>;
  reference: z.ZodString;
  quantity: z.ZodNumber;
  orderReference: z.ZodString;
};

/** @experimental */
export const stockReportSchema: z.ZodObject<StockReportShape, z.core.$strict> =
  z.strictObject<StockReportShape>({
    operationId: operationIdSchema,
    kind: z.enum<StockReportKinds>(["hold", "release", "sale"]),
    reference: z.string().min(1),
    quantity: z.number().int().positive(),
    orderReference: z.string().min(1),
  });

/**
 * Refuse a source whose declaration is malformed: no id, a missing required
 * method, or one stock method without the other.
 *
 * @experimental
 * @throws `COMMERCE_PROVIDER_CONTRACT`
 */
export function assertCatalogueSource(
  source: unknown
): asserts source is CatalogueSource {
  if (typeof source !== "object" || source === null) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      reason: "not an object",
    });
  }
  const candidate = source as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,62}$/.test(candidate.id)
  ) {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      reason: "id is not a lower-case slug",
    });
  }
  for (const method of ["find", "price"] as const) {
    if (typeof candidate[method] !== "function") {
      throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
        source: candidate.id,
        reason: `${method} is not implemented`,
      });
    }
  }
  if (candidate.list !== undefined && typeof candidate.list !== "function") {
    throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
      source: candidate.id,
      reason: "list is not a function",
    });
  }
  if (candidate.stock !== undefined) {
    const stock = candidate.stock as Record<string, unknown> | null;
    if (
      typeof stock !== "object" ||
      stock === null ||
      typeof stock.report !== "function" ||
      typeof stock.confirm !== "function"
    ) {
      throw commerceError("COMMERCE_PROVIDER_CONTRACT", {
        source: candidate.id,
        reason: "stock needs both report and confirm",
      });
    }
  }
}
