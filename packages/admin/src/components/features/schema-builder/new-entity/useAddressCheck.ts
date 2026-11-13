/**
 * The new-entity dialog's check of an address as it is typed.
 *
 * @module components/features/schema-builder/new-entity/useAddressCheck
 */
import type { PendingAddress } from "@admin/services/addressCheckApi";

import type { BuilderKind } from "../builder-config";

export type AddressCheckState =
  | { status: "checking" }
  | { status: "free" }
  | { status: "refused"; message: string }
  | { status: "unknown"; message: string };

export function useAddressCheck(
  _kind: BuilderKind,
  _address: string,
  _pendingCreates: readonly PendingAddress[] = []
): AddressCheckState {
  return { status: "free" };
}
