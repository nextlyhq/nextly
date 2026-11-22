/**
 * The server's address check: what creating a collection, Single or field group
 * under an address would answer, asked before the create.
 *
 * One route per kind, each gated by the permission that kind's create asks. The
 * server runs the create's own checks and counts `pendingCreates`, the entities
 * created in the editor but not saved yet, as using their addresses.
 *
 * @module services/addressCheckApi
 */
import { protectedApi } from "@admin/lib/api/protectedApi";

/** An entity kind as the server's address rule names it. */
export type AddressCheckKind = "collection" | "single" | "fieldGroup";

/** An address an unsaved entity holds. */
export interface PendingAddress {
  kind: AddressCheckKind;
  address: string;
}

/** The server's answer: `refusal` is null when the create would accept the address. */
export interface AddressCheckAnswer {
  kind: AddressCheckKind;
  address: string;
  refusal: { code: string; message: string } | null;
}

const ROUTE: Record<AddressCheckKind, string> = {
  collection: "/collections/schema/address-check",
  single: "/singles/schema/address-check",
  fieldGroup: "/field-groups/schema/address-check",
};

export const addressCheckApi = {
  check: (
    kind: AddressCheckKind,
    address: string,
    pendingCreates: readonly PendingAddress[] = []
  ): Promise<AddressCheckAnswer> =>
    protectedApi.post<AddressCheckAnswer>(ROUTE[kind], {
      address,
      pendingCreates,
    }),
};
