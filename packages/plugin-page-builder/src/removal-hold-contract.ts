/**
 * What the component editor and the removal-hold route say to each other.
 *
 * Isomorphic: the editor imports it, so it carries types and constants only.
 *
 * @module removal-hold-contract
 * @experimental Settles when the component editor ships.
 */

/** Where the editor asks for a removal's hold. */
export const REMOVAL_HOLD_ROUTE_PATH = "/component-removal-hold";

/** What the editor asks for when it publishes a removal. */
export interface RemovalHoldRequest {
  /** The component being published. */
  readonly id: string;
  /** The field and slot ids the publish removes. */
  readonly properties: readonly string[];
  readonly slots: readonly string[];
  /** How many documents placing the component the designer was shown. */
  readonly confirmed: number;
  /** Whether that count was the whole answer, rather than "at least". */
  readonly confirmedComplete: boolean;
}

/**
 * The answer: `held` when the count is no larger than the one confirmed, and
 * no less certain, and no write may set a removed field until the publish
 * lands; `recount` when more documents place the component now, or the count
 * is now only a floor where it was whole, with the count, and nothing held.
 */
export interface RemovalHoldResult {
  readonly kind: "held" | "recount";
  /** How many documents place it now; `complete` false makes it a floor. */
  readonly reach: { readonly count: number; readonly complete: boolean };
}
