import { z } from "zod";

import { commerceError } from "../errors";

/**
 * Commerce's own identifier for one operation it asks an outside service to
 * perform: start a payment, refund it, report a sale to a catalogue source.
 *
 * Commerce saves it before the call and sends it with the call as the
 * service's idempotency key. If the answer is lost, commerce repeats the call
 * with the same identifier, which the service must treat as the same
 * operation, or looks the result up by it. That is how a retry never charges,
 * refunds or reports twice.
 *
 * At most 255 characters of letters, digits and `-_.:`, which every provider
 * key format seen so far accepts (Stripe allows 255).
 *
 * @experimental
 */
export type OperationId = string;

/** @experimental */
export const operationIdSchema: z.ZodString = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,255}$/, {
    message: "an operation id is 1 to 255 letters, digits or -_.:",
  });

/**
 * Refuse a value that cannot be an operation identifier.
 *
 * @experimental
 */
export function assertOperationId(
  value: unknown
): asserts value is OperationId {
  if (!operationIdSchema.safeParse(value).success) {
    throw commerceError("COMMERCE_INVALID_OPERATION_ID", {
      received:
        typeof value === "string" ? `${value.length} characters` : typeof value,
    });
  }
}
