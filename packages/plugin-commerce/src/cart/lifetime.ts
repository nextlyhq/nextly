import { gt, lte } from "@nextlyhq/plugin-sdk/db";

import type { Condition } from "./conditions";

/** How long a cart lives after its last change when the site sets nothing. */
export const DEFAULT_CART_LIFETIME_DAYS = 30;

/** The longest lifetime a site may set: a year. */
export const MAX_CART_LIFETIME_DAYS = 365;

const DAY_MS = 86_400_000;

/**
 * The deadline of a cart created or changed at `now`.
 *
 * Kept with the cart and copied into its cookie, rather than worked out from
 * the cart's last change and the lifetime setting whenever it is needed: a
 * site that changes the setting then moves no cart's deadline until that cart
 * next changes, so the server and the browser always hold the same one.
 * Whole seconds, because SQLite stores no finer, and every dialect then
 * stores the same deadline the code computed.
 */
export function cartDeadline(now: Date, lifetimeDays: number): Date {
  const ms = now.getTime() + lifetimeDays * DAY_MS;
  return new Date(Math.floor(ms / 1000) * 1000);
}

/**
 * Whether a cart is past its deadline. Every read refuses such a cart
 * whether or not the sweep has removed it yet; the database conditions below
 * ask the same of the same stored deadline.
 */
export function isCartExpired(
  cart: { readonly expiresAt: Date },
  now: Date
): boolean {
  return cart.expiresAt.getTime() <= now.getTime();
}

/**
 * How long after its deadline a cart is left before the sweep removes it.
 *
 * A change applies only to a cart still live at the moment it writes
 * (`liveCartCondition`), but that moment is the writing instance's clock,
 * read just before the write. Without a margin, a change that read the clock
 * just before a cart's deadline could commit just after the sweep chose that
 * cart, and the sweep would then remove the lines the change had just
 * written. An hour is far more than any request takes and any clock drifts,
 * and costs nothing: a cart past its deadline is already refused by every read.
 */
export const SWEEP_GRACE_MS = 3_600_000;

type Deadline = Parameters<typeof lte>[0];

/**
 * A cart still live at `now`, said to the database: the condition every write
 * to an existing cart carries, so a cart past its deadline is never changed
 * again, only replaced by a new one. The negation of `isCartExpired`.
 */
export function liveCartCondition(expiresAt: Deadline, now: Date): Condition {
  return gt(expiresAt, now);
}

/**
 * A cart the sweep may remove at `now`: past its deadline by more than
 * `SWEEP_GRACE_MS`. Every such cart is one `isCartExpired` already refuses.
 */
export function sweepableCartCondition(
  expiresAt: Deadline,
  now: Date
): Condition {
  return lte(expiresAt, new Date(now.getTime() - SWEEP_GRACE_MS));
}
