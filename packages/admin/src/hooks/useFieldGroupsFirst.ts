"use client";

/**
 * useFieldGroupsFirst: what an editor's save needs of the field groups not
 * saved yet.
 *
 * The ones its fields use are listed in the save's review and created after it
 * is confirmed, before the entity (`useSchemaSave`'s `fieldGroupsFirst`). The
 * ones its own field picker made are let go: those no field uses once the save
 * has landed, and all of them when its changes are discarded or left. Every
 * editor asks this one hook, so the three kinds cannot differ about which
 * groups a save creates.
 */
import { useCallback, useMemo } from "react";

import type { FieldGroupCreate } from "@admin/components/features/schema-builder/FieldGroupCreatesList";
import {
  createFieldGroupsFirst,
  fieldGroupsFirst as fieldGroupsFirstOf,
  type FieldGroupHost,
  type FieldNamingGroups,
} from "@admin/lib/builder/field-groups-first";
import {
  removeUnsavedEntity,
  useUnsavedEntitiesOf,
} from "@admin/lib/builder/unsaved-entities";

import { useCreateFieldGroup } from "./queries";
import type { UseSchemaSaveOptions } from "./useSchemaSave";

export interface UseFieldGroupsFirstReturn {
  /** The ones the fields use, as the review lists them, in the order created. */
  creates: readonly FieldGroupCreate[];
  /** For `useSchemaSave`; absent when the fields use none. */
  fieldGroupsFirst: UseSchemaSaveOptions["fieldGroupsFirst"];
  /** After a save has landed: the host's own ones no field uses go. */
  letGoUnused: () => void;
  /** When the host's changes are discarded or left: every one its picker made goes. */
  letGoOwned: () => void;
}

const NONE: readonly FieldNamingGroups[] = [];

export function useFieldGroupsFirst(
  /** The entity being edited; undefined while it has no address. */
  host: FieldGroupHost | undefined,
  /** Its fields as they stand, in the editor's shape or the server's. */
  fields: readonly FieldNamingGroups[]
): UseFieldGroupsFirstReturn {
  const held = useUnsavedEntitiesOf("field-group");
  const { mutateAsync: createFieldGroup } = useCreateFieldGroup();

  const { used, unused } = useMemo(
    () =>
      host
        ? fieldGroupsFirstOf(held, fields, host)
        : fieldGroupsFirstOf([], NONE, { kind: "collection", address: "" }),
    [held, fields, host]
  );

  const creates = useMemo(
    () =>
      used.map(group => ({
        address: group.address,
        label: group.settings.singularName,
      })),
    [used]
  );

  const fieldGroupsFirst = useMemo(
    () =>
      used.length === 0
        ? undefined
        : {
            creates,
            create: () => createFieldGroupsFirst(used, createFieldGroup),
          },
    [used, creates, createFieldGroup]
  );

  const letGoUnused = useCallback(() => {
    for (const group of unused)
      removeUnsavedEntity("field-group", group.address);
  }, [unused]);

  const letGoOwned = useCallback(() => {
    if (!host) return;
    for (const group of held) {
      if (
        group.ownedBy?.kind === host.kind &&
        group.ownedBy.address === host.address
      ) {
        removeUnsavedEntity("field-group", group.address);
      }
    }
  }, [held, host]);

  return { creates, fieldGroupsFirst, letGoUnused, letGoOwned };
}
