"use client";

/**
 * The pending changes a Builder editor shows, with Discard all made to fit an
 * entity not saved yet: discarding its changes discards the entity itself, so
 * it leaves this tab and the editor returns to the list. That leave answers the
 * leave guard's question, so the guard does not ask it again.
 *
 * @module hooks/useUnsavedDiscard
 */
import { useMemo } from "react";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import { removeUnsavedEntity } from "@admin/lib/builder/unsaved-entities";
import { navigateTo } from "@admin/lib/navigation";

import type { BuilderPendingChanges } from "./useBuilderEntityState";

export function useUnsavedDiscard(
  pending: BuilderPendingChanges,
  unsaved: boolean,
  kind: BuilderKind,
  address: string,
  listRoute: string
): BuilderPendingChanges {
  return useMemo(
    () =>
      unsaved
        ? {
            ...pending,
            discardLeaves: true,
            discardAll: () => {
              removeUnsavedEntity(kind, address);
              navigateTo(listRoute);
            },
          }
        : pending,
    [unsaved, pending, kind, address, listRoute]
  );
}
