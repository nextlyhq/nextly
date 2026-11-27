/**
 * The command palette's results for the signed-in reader, read from the same
 * hooks the menus draw from, so the palette and the menus never disagree
 * about what a reader may open or where it opens.
 *
 * @module components/shared/command-palette/use-palette-results
 */

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useCreatableCollections } from "@admin/hooks/useCreatableCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import {
  useEveryListedCollection,
  useSidebarSingleList,
} from "@admin/hooks/useSidebarContentLists";
import { useDocumentAddress } from "@admin/lib/navigation/useDocumentAddress";
import type { ApiSingle } from "@admin/types/entities";

import { paletteResults, type PaletteResults } from "./palette-results";

/**
 * How far the Content panel's lists have got, so the palette never says
 * nothing matched while a collection or Single it would list is still on its
 * way, or on a page that failed to load.
 */
export interface PaletteListState {
  /** Every collection and every Single is in. */
  complete: boolean;
  /** A page of collections or Singles failed to load. */
  failed: boolean;
  /** Asks both lists again. */
  retry: () => void;
}

export function usePaletteResults(): PaletteResults & {
  lists: PaletteListState;
} {
  const { hasPermission } = useCurrentUserPermissions();
  const branding = useBranding();
  // The Content panel's own lists: every collection it lists, past its first
  // page, and every Single.
  const collections = useEveryListedCollection();
  const singles = useSidebarSingleList();
  const creatable = useCreatableCollections();
  const addressOf = useDocumentAddress();
  const failed = Boolean(collections.error || singles.error);
  const lists: PaletteListState = {
    complete: !collections.isLoading && singles.isComplete && !failed,
    failed,
    retry: () => {
      collections.retry();
      singles.retry();
    },
  };
  const results = paletteResults({
    collections: collections.items,
    singles: singles.items,
    // Opened by the one rule the Content panel's link follows.
    singleHref: (single: ApiSingle) =>
      addressOf({ kind: "single", slug: single.slug }, { collection: single }),
    creatable: creatable.collections,
    hasPermission,
    plugins: branding.plugins,
    // The Builders pages open only on the site's explicit yes (the builder
    // guard's rule): while the answer is in flight or failed, a pick would
    // land on a page that cannot open.
    showBuilder: branding.showBuilder === true,
  });
  return { ...results, lists };
}
