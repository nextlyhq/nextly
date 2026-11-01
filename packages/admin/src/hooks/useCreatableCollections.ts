/**
 * The collections the signed-in reader may create entries in, in navigation
 * order: what the dashboard's New button and the command palette offer.
 *
 * A collection kept off the dashboard (internal, or hidden from the
 * navigation) is never offered, nor one whose documents only a machine creates
 * (`admin.disableCreate`, as form submissions declare): its own list offers no
 * "New" either. The rest are judged by the server's answer about collections,
 * not the `create-<slug>` permission, since a collection's code rule can refuse
 * a create the reader's role holds the permission for.
 *
 * 🔴 Not a security boundary: the create endpoint judges every create whatever
 * is offered here, so an offer made in error costs a click and a refusal.
 *
 * @module hooks/useCreatableCollections
 */
import { useMemo } from "react";

import { keptOffDashboard } from "@admin/components/features/dashboard/kept-off-dashboard";
import { useEveryNavCollection } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import type { ApiCollection } from "@admin/types/entities";

export interface CreatableCollections {
  collections: readonly ApiCollection[];
  /**
   * Whether both answers have arrived. Until they have, `collections` is empty
   * and says nothing: the permission check answers no before the server's
   * answer about collections lands.
   */
  isReady: boolean;
  /** Whether either answer failed. */
  failed: boolean;
}

export function useCreatableCollections(): CreatableCollections {
  // Every page of collections, not the first alone: a type past it would be
  // missing from the menu and the palette, and its recent slug dropped.
  const { data, isLoading, error } = useEveryNavCollection();
  const { canAccessCollection, content } = useCurrentUserPermissions();
  const collections = useMemo(
    () =>
      (data ?? []).filter(
        collection =>
          !keptOffDashboard(collection) &&
          !collection.admin?.disableCreate &&
          canAccessCollection(collection.name, "create")
      ),
    [data, canAccessCollection]
  );
  const isReady = !isLoading && !content.isLoading && content.hasAnswer;
  return {
    collections: isReady ? collections : [],
    isReady,
    failed: Boolean(error) || (!content.isLoading && !content.hasAnswer),
  };
}
