/**
 * The variant-use route's path and answer, shared by the route and the admin
 * client. Neither end loads the other's module: the route reads the database,
 * and the client runs in a browser.
 *
 * @module variant-use-contract
 */

/** Where the count of a variant's placements is asked. */
export const VARIANT_USE_ROUTE_PATH = "/component-variant-use";

/** What the variant-use route is asked. */
export interface VariantUseRequest {
  readonly componentId: string;
  /** The variant's key, which placements store. */
  readonly variantId: string;
}

/** What the variant-use route answers. */
export interface VariantUseResponse {
  /** Placements that chose the variant. */
  readonly placements: number;
  /** The documents holding them. */
  readonly documents: number;
  /** False when the count is a floor, said as "at least". */
  readonly complete: boolean;
}
