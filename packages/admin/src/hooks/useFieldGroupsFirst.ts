"use client";

/**
 * useFieldGroupsFirst: what an editor's save needs of the entities not saved
 * yet: the field groups its fields use and the collections they link to.
 *
 * The ones its fields need are listed in the save's review and created after
 * it is confirmed, before the entity (`useSchemaSave`'s `fieldGroupsFirst`),
 * each one's definition written where its own first save writes it. The ones
 * it made (from its field picker, or with "Create it too" in the new-entity
 * dialog) are let go: those no field needs once the save has landed, and all
 * of them when its changes are discarded. However the editor is left, it
 * releases them instead, each kept as an unsaved entity of its own. Every
 * editor asks this one hook, so the three kinds cannot differ about which
 * entities a save creates.
 */
import { useCallback, useEffect, useMemo } from "react";

import type { FieldGroupCreate } from "@admin/components/features/schema-builder/FieldGroupCreatesList";
import {
  createFieldGroupsFirst,
  fieldGroupsFirst as fieldGroupsFirstOf,
  type FieldGroupsFirstSteps,
  type FieldGroupHost,
  type FieldNamingGroups,
} from "@admin/lib/builder/field-groups-first";
import {
  collectionEntityFromSettings,
  fieldGroupEntityFromSettings,
} from "@admin/lib/builder/settings-to-manifest";
import {
  releaseUnsavedFieldGroupsOf,
  removeUnsavedEntity,
  type UnsavedEntity,
  useUnsavedEntitiesOf,
} from "@admin/lib/builder/unsaved-entities";
import { schemaFileApi } from "@admin/services/schemaFileApi";

import { useCreateCollection, useCreateFieldGroup } from "./queries";
import type { BuilderPendingChanges } from "./useBuilderEntityState";
import { mirrorSchemaFile, type UseSchemaSaveOptions } from "./useSchemaSave";

export interface UseFieldGroupsFirstReturn {
  /** The ones the fields use, as the review lists them, in the order created. */
  creates: readonly FieldGroupCreate[];
  /** For `useSchemaSave`; absent when the fields use none. */
  fieldGroupsFirst: UseSchemaSaveOptions["fieldGroupsFirst"];
  /** After a save has landed: the host's own ones no field uses go. */
  letGoUnused: () => void;
  /** When the host's changes are discarded: every one it made goes. */
  letGoOwned: () => void;
  /**
   * When the host is left with its changes discarded: every one its picker
   * made stays as an unsaved field group of its own, which its own editor may
   * open and save.
   */
  release: () => void;
}

const NONE: readonly FieldNamingGroups[] = [];

/** The unsaved entities of the kinds a field names: field groups it uses, collections it links to. */
function useHeldNamedEntities(): readonly UnsavedEntity[] {
  const heldGroups = useUnsavedEntitiesOf("field-group");
  const heldCollections = useUnsavedEntitiesOf("collection");
  return useMemo(
    () => [...heldGroups, ...heldCollections],
    [heldGroups, heldCollections]
  );
}

/**
 * How each kind a save creates first is created, and its definition then
 * written to the schema file as that kind's own first save writes it.
 */
function useCreateFirstSteps(): FieldGroupsFirstSteps {
  const { mutateAsync: createFieldGroup } = useCreateFieldGroup();
  const { mutateAsync: createCollection } = useCreateCollection();
  // As a field group's own first save writes its definition to the schema file.
  const writeFieldGroup = useCallback(
    (group: UnsavedEntity) =>
      mirrorSchemaFile(
        () =>
          schemaFileApi.writeFieldGroup(
            fieldGroupEntityFromSettings(
              group.address,
              group.settings,
              group.fields
            )
          ),
        "Field group created"
      ),
    []
  );
  // As a collection's own first save writes its definition to the schema file.
  const writeCollection = useCallback(
    (made: UnsavedEntity) =>
      mirrorSchemaFile(
        () =>
          schemaFileApi.writeCollection(
            collectionEntityFromSettings(
              made.address,
              made.settings,
              made.fields
            )
          ),
        "Collection created"
      ),
    []
  );
  return useMemo(
    () => ({
      "field-group": { create: createFieldGroup, mirror: writeFieldGroup },
      collection: { create: createCollection, mirror: writeCollection },
    }),
    [createFieldGroup, writeFieldGroup, createCollection, writeCollection]
  );
}

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
  const held = useHeldNamedEntities();
  const steps = useCreateFirstSteps();

  const { used, unused } = useMemo(
    () =>
      host
        ? fieldGroupsFirstOf(held, fields, host)
        : fieldGroupsFirstOf([], NONE, { kind: "collection", address: "" }),
    [held, fields, host]
  );

  const creates = useMemo(
    () =>
      used.map(entity => ({
        kind: entity.kind,
        address: entity.address,
        label: entity.settings.singularName,
      })),
    [used]
  );

  const letGoUnused = useCallback(() => {
    for (const entity of unused)
      removeUnsavedEntity(entity.kind, entity.address);
  }, [unused]);

  const letGoOwned = useCallback(() => {
    if (!host) return;
    for (const entity of held) {
      if (
        entity.ownedBy?.kind === host.kind &&
        entity.ownedBy.address === host.address
      ) {
        removeUnsavedEntity(entity.kind, entity.address);
      }
    }
  }, [held, host]);

  // Leaving the host lets go of the collections it made, which no list or
  // picker offers on their own, so kept they would only hold their addresses;
  // its field groups stay, each one of its own, which any host's picker offers.
  const release = useCallback(() => {
    if (!host) return;
    for (const entity of held) {
      if (
        entity.kind === "collection" &&
        entity.ownedBy?.kind === host.kind &&
        entity.ownedBy.address === host.address
      ) {
        removeUnsavedEntity(entity.kind, entity.address);
      }
    }
    releaseUnsavedFieldGroupsOf(host);
  }, [held, host]);

  // However the editor is left, with a pending change or none (a picker cancelled after a
  // group was made leaves none), the groups its picker made stay as unsaved field groups of
  // their own, which no other host's picker would otherwise offer.
  useEffect(() => release, [release]);

  // Absent when the save has nothing to create and nothing to let go.
  const fieldGroupsFirst = useMemo(
    () =>
      used.length === 0 && unused.length === 0
        ? undefined
        : {
            creates,
            create: () => createFieldGroupsFirst(used, steps),
            letGoUnused,
          },
    [used, unused, creates, steps, letGoUnused]
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
