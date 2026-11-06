/**
 * What a list row calls a collection: the label its reader is shown for it, as every other
 * surface names it ("Posts"), rather than its slug ("posts").
 *
 * Read from the collections the workspace payload publishes to this reader
 * (`widgetSources`), so a row names a collection exactly as the card's title and the settings
 * sheet do. A slug the reader is shown no label for is named by the slug itself, so a row still
 * says where it lives.
 *
 * @module components/features/widgets/frame/collection-label
 */

import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";

/** The label the reader is shown for each collection, by its slug; the slug where there is none. */
export function useCollectionLabel(): (slug: string) => string {
  const sources = useBranding().widgetSources;
  return useMemo(() => {
    const labels = new Map(
      (sources ?? []).map(source => [source.collection, source.label])
    );
    return slug => labels.get(slug) ?? slug;
  }, [sources]);
}
