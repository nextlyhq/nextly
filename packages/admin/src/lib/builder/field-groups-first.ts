/**
 * The field groups not saved yet that a host's save creates before the host.
 *
 * A field group made from a host's field picker waits in this tab's unsaved
 * entities until the host is saved. The host's fields may name it, at any
 * depth, so the save creates every unsaved field group its fields use before
 * the host's own change, which would otherwise name a group the server does
 * not have. One the host's picker made and no field uses any more is let go
 * once the save has landed.
 *
 * @module lib/builder/field-groups-first
 */
import { checkAddressAgain } from "@admin/components/features/schema-builder/new-entity/useAddressCheck";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { CreateComponentPayload } from "@admin/services/fieldGroupApi";
import type { FieldDefinition } from "@admin/types/collection";

import { fieldGroupCreatePayload } from "./create-request";
import { removeUnsavedEntity, type UnsavedEntity } from "./unsaved-entities";

/** The entity being saved, as an unsaved field group names its owner. */
type Host = NonNullable<UnsavedEntity["ownedBy"]>;

/** Every field group the fields name, at any depth, in field order, each once. */
function fieldGroupsNamedBy(fields: readonly FieldDefinition[]): string[] {
  const named: string[] = [];
  const visit = (level: readonly FieldDefinition[]) => {
    for (const field of level) {
      for (const address of [
        ...(field.component ? [field.component] : []),
        ...(field.components ?? []),
      ]) {
        if (!named.includes(address)) named.push(address);
      }
      if (field.fields) visit(field.fields);
    }
  };
  visit(fields);
  return named;
}

/**
 * Of the unsaved field groups `held`: the ones `fields` use, which the host's
 * save creates first, in the order the fields name them; and the ones the
 * host's picker made that no field uses, which its save lets go.
 */
export function fieldGroupsFirst(
  held: readonly UnsavedEntity[],
  fields: readonly FieldDefinition[],
  host: Host
): { used: UnsavedEntity[]; unused: UnsavedEntity[] } {
  const groups = held.filter(entity => entity.kind === "field-group");
  const named = fieldGroupsNamedBy(fields);
  const used = named.flatMap(address => {
    const group = groups.find(entity => entity.address === address);
    return group ? [group] : [];
  });
  const unused = groups.filter(
    entity =>
      entity.ownedBy?.kind === host.kind &&
      entity.ownedBy.address === host.address &&
      !named.includes(entity.address)
  );
  return { used, unused };
}

/**
 * Creates each of `groups` in turn: its address checked once more (another tab
 * may have saved one under it), then created with what the dialog set, and let
 * go from the unsaved ones. Stops at the first refusal, which it returns in
 * words naming the group, so the host is not saved and every group not yet
 * created stays unsaved; null when all were created.
 */
export async function createFieldGroupsFirst(
  groups: readonly UnsavedEntity[],
  create: (payload: CreateComponentPayload) => Promise<unknown>
): Promise<string | null> {
  for (const group of groups) {
    const refusedAs = (reason: string) =>
      `The field group “${group.settings.singularName}” was not created: ${reason}`;
    const refused = await checkAddressAgain("field-group", group.address);
    if (refused !== null) return refusedAs(refused);
    try {
      await create(
        fieldGroupCreatePayload(group.address, group.settings, group.fields)
      );
    } catch (err) {
      return refusedAs(apiErrorMessage(err, "The server refused it."));
    }
    removeUnsavedEntity("field-group", group.address);
  }
  return null;
}
