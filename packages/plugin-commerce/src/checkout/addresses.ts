import { z } from "zod";

/**
 * A postal address as a buyer gives it at checkout. Stored with the order as
 * given, after this check, so the order keeps the address it was placed
 * with whatever later happens to the buyer's saved ones.
 */
const addressSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  // ISO 3166-1 alpha-2, as carriers and tax providers take it.
  country: z.string().regex(/^[A-Z]{2}$/, "a two-letter country code"),
  phone: z.string().trim().max(40).optional(),
});

/** @experimental */
export type CheckoutAddress = z.infer<typeof addressSchema>;

/** The addresses an order is placed with: where it goes, and who pays. */
export const checkoutAddressesSchema = z.strictObject({
  shipping: addressSchema,
  billing: addressSchema.optional(),
});

/** @experimental */
export type CheckoutAddresses = z.infer<typeof checkoutAddressesSchema>;
