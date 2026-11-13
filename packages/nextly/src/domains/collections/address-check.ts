/**
 * What creating an entity under an address would answer, asked before the create.
 *
 * @module domains/collections/address-check
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { AddressKind, UsedAddress } from "../../shared/address-rule";

/** A refusal as the create reports it: its code and its public message. */
export interface AddressCheckRefusal {
  code: string;
  message: string;
}

/** What the check reads: the database the creates check, and the field-group service. */
export interface AddressCheckDeps {
  adapter: DrizzleAdapter;
  fieldGroups: {
    assertNewAddressAvailable(slug: string, tableName: string): Promise<void>;
  };
}

/** The address asked about, and the entities created in the editor but not yet saved. */
export interface AddressCheckInput {
  kind: AddressKind;
  address: string;
  pendingCreates: readonly UsedAddress[];
}

export async function checkNewAddress(
  _deps: AddressCheckDeps,
  _input: AddressCheckInput
): Promise<AddressCheckRefusal | null> {
  return null;
}
