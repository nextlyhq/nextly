/**
 * What creating an entity under an address would answer, asked before the create.
 *
 * The Schema Builder checks an address as it is typed, so a new collection, Single or field group
 * is never offered under an address its save then refuses, nor refused one the save accepts. To
 * hold that, this runs the create's OWN checks for the kind rather than restating them: the
 * address rule, and the lookups the create makes against what the database holds. A rule written
 * again here would be one more copy to drift from the create.
 *
 * The one thing the create cannot know is what the editor holds but has not saved: an entity
 * created in the editor counts as using its address until it is saved or discarded. Those are
 * compared by the rule's own functions.
 *
 * A refusal comes back as the create reports it, its code and its public message, and nothing
 * more: an address another entity holds is the create's generic answer, which names no entity.
 *
 * @module domains/collections/address-check
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  assertSingleTablesUnowned,
  type SingleTablesRegistry,
} from "../../dispatcher/handlers/single-table-family";
import { NextlyError } from "../../errors/nextly-error";
import { assertGlobalResourceSlugAvailable } from "../../services/lib/resource-slug-guard";
import {
  addressRefusalError,
  assertAddressAllowed,
  findSameSnakeCaseAddress,
  sharesNamespace,
  type AddressKind,
  type UsedAddress,
} from "../../shared/address-rule";
import { resolveComponentTableName } from "../schema/utils/resolve-table-name";
import { resolveSingleTableName } from "../singles/services/resolve-single-table-name";

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
  /** The Singles registry, whose tables a new Single's must not meet. */
  singleRegistry: SingleTablesRegistry;
}

/**
 * The address asked about, as the request gave it, and the entities created in the editor but not
 * yet saved. The address may be any value: the rule judges it as the create does.
 */
export interface AddressCheckInput {
  kind: AddressKind;
  address: unknown;
  pendingCreates: readonly UsedAddress[];
}

/**
 * The create's checks of a new address for `kind`, in the order the create runs them: the rule
 * first, then what the database holds.
 */
async function assertCreateAccepts(
  deps: AddressCheckDeps,
  kind: AddressKind,
  address: unknown
): Promise<string> {
  // The rule first, as every create asks it first; it refuses anything that is not a string.
  assertAddressAllowed(kind, address);
  if (typeof address !== "string") {
    // Unreachable while the rule refuses every other value; refused rather than answered free if
    // that ever changes.
    throw NextlyError.internal({
      logContext: { reason: "address-rule-accepted-a-non-string", kind },
    });
  }
  if (kind === "fieldGroup") {
    // The table the field-group create derives from the address, which its check is keyed on.
    await deps.fieldGroups.assertNewAddressAvailable(
      address,
      resolveComponentTableName(address)
    );
    return address;
  }
  await assertGlobalResourceSlugAvailable(deps.adapter, address, {
    addressKind: kind,
  });
  if (kind === "single") {
    // The table family the Single create derives from the address, checked as the create does.
    await assertSingleTablesUnowned(
      deps.singleRegistry,
      address,
      resolveSingleTableName({ slug: address })
    );
  }
  return address;
}

/**
 * Refuses an address an unsaved entity holds: exactly, where the two must differ, with the
 * create's own answer for an address already held; or by its snake_case form, as the rule refuses
 * a saved one.
 */
function assertNotHeldByPendingCreate(
  kind: AddressKind,
  address: string,
  pendingCreates: readonly UsedAddress[]
): void {
  if (
    pendingCreates.some(
      other => other.address === address && sharesNamespace(kind, other.kind)
    )
  ) {
    throw NextlyError.duplicate({
      logContext: { reason: "address-held-by-pending-create", kind, address },
    });
  }
  const twin = findSameSnakeCaseAddress(kind, address, pendingCreates);
  if (twin) throw addressRefusalError(twin, address);
}

/**
 * The refusal a create's check threw, as the create's response reports it: a validation error's
 * first entry, or another refusal's code and public message. Anything else is not a verdict on the
 * address (a lost connection, a fault) and is thrown on.
 */
function refusalOf(error: unknown): AddressCheckRefusal {
  if (!NextlyError.is(error)) throw error;
  if (error.code === "VALIDATION_ERROR") {
    const first = (
      error.publicData as { errors?: { code: string; message: string }[] }
    )?.errors?.[0];
    if (first) return { code: first.code, message: first.message };
  }
  if (error.code === "DUPLICATE" || error.code === "VALIDATION_ERROR") {
    return { code: error.code, message: error.publicMessage };
  }
  throw error;
}

/**
 * What creating `input.kind` under `input.address` would answer now: `null` when the create would
 * accept the address, or its refusal.
 */
export async function checkNewAddress(
  deps: AddressCheckDeps,
  input: AddressCheckInput
): Promise<AddressCheckRefusal | null> {
  try {
    const address = await assertCreateAccepts(deps, input.kind, input.address);
    assertNotHeldByPendingCreate(input.kind, address, input.pendingCreates);
    return null;
  } catch (error) {
    return refusalOf(error);
  }
}
