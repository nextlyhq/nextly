/**
 * The address check's answer, shared by the three routes that ask it, one per kind.
 *
 * Each kind's route lives under that kind's own service, so the permission the kind's create asks
 * gates it before this runs. Here the body is parsed, and the check runs the create's own checks;
 * see `domains/collections/address-check.ts`.
 *
 * @module dispatcher/handlers/address-check-route
 */
import { z } from "zod";

import { respondData } from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { checkNewAddress } from "../../domains/collections/address-check";
import { NextlyError } from "../../errors/nextly-error";
import type { AddressKind } from "../../shared/address-rule";
import {
  getAdapterFromDI,
  getFieldGroupMetadataServiceFromDI,
  getSingleRegistryFromDI,
} from "../helpers/di";

/** The longest address of an unsaved entity taken for comparison; it keeps the request small. */
const MAX_ADDRESS_INPUT = 1000;

/** How many unsaved entities one editor may hold for the check to compare with. */
const MAX_PENDING_CREATES = 500;

const addressCheckBody = z.object({
  // Any value: the address rule judges it, missing, not a string or too long alike, so the answer
  // is the create's for every address the check is given.
  address: z.unknown().optional(),
  // The entities created in the editor and not saved yet, which hold their addresses until the
  // save or a discard.
  pendingCreates: z
    .array(
      z.object({
        kind: z.enum(["collection", "single", "fieldGroup"]),
        address: z.string().max(MAX_ADDRESS_INPUT),
      })
    )
    .max(MAX_PENDING_CREATES)
    .default([]),
});

/**
 * Answers what creating `kind` under the body's address would: `{ kind, address, refusal }`, the
 * refusal `null` when the create would accept it, or its code and public message.
 */
export async function respondAddressCheck(
  kind: AddressKind,
  body: unknown
): Promise<Response> {
  const parsed = addressCheckBody.safeParse(body ?? {});
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const adapter = getAdapterFromDI();
  const fieldGroups = getFieldGroupMetadataServiceFromDI();
  const singleRegistry = getSingleRegistryFromDI();
  if (!adapter || !fieldGroups || !singleRegistry) {
    throw NextlyError.internal({
      logContext: { reason: "address-check-services-unavailable", kind },
    });
  }
  const { address, pendingCreates } = parsed.data;
  const refusal = await checkNewAddress(
    { adapter, fieldGroups, singleRegistry },
    { kind, address, pendingCreates }
  );
  return respondData({ kind, address, refusal });
}
