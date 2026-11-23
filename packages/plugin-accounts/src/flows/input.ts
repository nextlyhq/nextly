import { z } from "zod";

/** A name as the plugin keeps it: trimmed, and neither empty nor past its column. */
const NAME: z.ZodString = z.string().trim().min(1).max(255);

/** An address as a visitor typed it, trimmed, and a valid one no longer than its column. */
export const ADDRESS: z.ZodPipe<z.ZodString, z.ZodEmail> = z
  .string()
  .trim()
  .pipe(z.email().max(320));

/**
 * A new account's name and address as someone gave them, read once for
 * every flow that makes one: a sign-up and an invitation alike.
 */
export function nameAndAddress(input: {
  name: string;
  address: string;
}):
  | { status: "read"; name: string; address: string }
  | { status: "refused"; reason: "invalid-name" | "invalid-address" } {
  const name = NAME.safeParse(input.name);
  if (!name.success) return { status: "refused", reason: "invalid-name" };
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) return { status: "refused", reason: "invalid-address" };

  return { status: "read", name: name.data, address: address.data };
}
