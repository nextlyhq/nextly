"use client";

/**
 * useFieldGroupsFirst: what an editor's save needs of the field groups not
 * saved yet.
 *
 * The ones its fields use are listed in the save's review and created after it
 * is confirmed, before the entity (`useSchemaSave`'s `fieldGroupsFirst`). The
 * ones its own field picker made are let go: those no field uses once the save
 * has landed, and all of them when its changes are discarded. A confirmed leave
 * releases them instead, each kept as an unsaved field group of its own. Every
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
  releaseUnsavedFieldGroupsOf,
  removeUnsavedEntity,
  useUnsavedEntitiesOf,
} from "@admin/lib/builder/unsaved-entities";

import { useCreateFieldGroup } from "./queries";
import type { BuilderPendingChanges } from "./useBuilderEntityState";
import type { UseSchemaSaveOptions } from "./useSchemaSave";

export interface UseFieldGroupsFirstReturn {
  /** The ones the fields use, as the review lists them, in the order created. */
  creates: readonly FieldGroupCreate[];
  /** For `useSchemaSave`; absent when the fields use none. */
  fieldGroupsFirst: UseSchemaSaveOptions["fieldGroupsFirst"];
  /** After a save has landed: the host's own ones no field uses go. */
  letGoUnused: () => void;
  /** When the host's changes are discarded: every one its picker made goes. */
  letGoOwned: () => void;
  /**
   * When the host is left with its changes discarded: every one its picker
   * made stays as an unsaved field group of its own, which its own editor may
   * open and save.
   */
  release: () => void;
}

const NONE: readonly FieldNamingGroups[] = [];

export function useFieldGroupsFirst(
  /** The kind of entity being edited. */
  kind: FieldGroupHost["kind"],
  /** Its address; undefined while it has none. */
  address: string | undefined,
  /** Its fields as they stand, in the editor's shape or the server's. */
  fields: readonly FieldNamingGroups[]
): UseFieldGroupsFirstReturn {
  // One value per entity, so the callbacks below keep theirs between renders.
  const host = useMemo<FieldGroupHost | undefined>(
    () => (address ? { kind, address } : undefined),
    [kind, address]
  );
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

  const release = useCallback(() => {
    if (host) releaseUnsavedFieldGroupsOf(host);
  }, [host]);

  // Absent when the save has nothing to create and nothing to let go.
  const fieldGroupsFirst = useMemo(
    () =>
      used.length === 0 && unused.length === 0
        ? undefined
        : {
            creates,
            create: () => createFieldGroupsFirst(used, createFieldGroup),
            letGoUnused,
          },
    [used, unused, creates, createFieldGroup, letGoUnused]
  );

  return { creates, fieldGroupsFirst, letGoUnused, letGoOwned, release };
}

/**
 * `pending`, with its Discard all letting go of every field group the host's
 * picker made, which only its discarded changes named.
 */
export function useDiscardLetsGoOwned(
  pending: BuilderPendingChanges,
  letGoOwned: () => void
): BuilderPendingChanges {
  return useMemo(
    () => ({
      ...pending,
      discardAll: () => {
        letGoOwned();
        pending.discardAll();
      },
    }),
    [pending, letGoOwned]
  );
}
