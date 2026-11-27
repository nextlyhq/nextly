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

export function usePaletteResults(): PaletteResults {
  const { hasPermission, capabilities } = useCurrentUserPermissions();
  const branding = useBranding();
  // The Content panel's own lists: every collection it lists, past its first
  // page, and every Single.
  const collections = useEveryListedCollection();
  const singles = useSidebarSingleList();
  const creatable = useCreatableCollections();
  const addressOf = useDocumentAddress();
  return paletteResults({
    collections: collections.items,
    singles: singles.items,
    // Opened by the one rule the Content panel's link follows.
    singleHref: (single: ApiSingle) =>
      addressOf({ kind: "single", slug: single.slug }, { collection: single }),
    creatable: creatable.collections,
    hasPermission,
    canManageSettings: capabilities?.canManageSettings ?? false,
    plugins: branding.plugins,
    // The Builders pages open only on the site's explicit yes (the builder
    // guard's rule): while the answer is in flight or failed, a pick would
    // land on a page that cannot open.
    showBuilder: branding.showBuilder === true,
  });
}
