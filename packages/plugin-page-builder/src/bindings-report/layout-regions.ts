/**
 * A page's Layout as the report judges it: the components its regions place,
 * as a document placing each, so their bindings to the entry are judged
 * against the page's own entry, as the published page draws them.
 *
 * @module bindings-report/layout-regions
 */
import { effectiveLayoutFor } from "../default-layout/effective-layout";
import type { DefaultLayoutSlugs } from "../default-layout/store";
import type { HostAddress } from "../host-rewrite/contract";
import {
  areaComponentIds,
  layoutAreasDocument,
} from "../layout-areas-document";

/** What reading a page's Layout needs. */
export interface LayoutRegionsDeps {
  /** The pages collection, as renamed: only its entries are drawn in a Layout. */
  readonly pages: string;
  readonly slugs: DefaultLayoutSlugs;
}

/**
 * The Layout a page is drawn in and its regions, or `undefined` for a
 * document that is no page, or a page drawn in none.
 */
export async function layoutRegionsOf(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  deps: LayoutRegionsDeps
): Promise<{ readonly id: string; readonly value: unknown } | undefined> {
  if (
    at.kind !== "collection" ||
    at.slug !== deps.pages ||
    at.id === undefined
  ) {
    return undefined;
  }
  const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
  const nextly = await getCachedNextly();
  const page = await nextly.findByID({
    collection: at.slug,
    id: at.id,
    depth: 0,
    status: "all",
    // The working draft where there is one: the blocks judged are the
    // draft's, so the Layout must be the one that draft chooses.
    draft: true,
    overrideAccess: true,
  });
  const chosen = await effectiveLayoutFor(page ?? {}, {
    nextly,
    slugs: deps.slugs,
  });
  if (chosen.kind !== "layout") return undefined;
  const layout = await nextly.findByID({
    collection: deps.slugs.layouts,
    id: chosen.id,
    depth: 0,
    overrideAccess: true,
  });
  // The areas as placements, by the one builder every Layout reader uses, so
  // the report composes a Layout as the render and the publish check do.
  const components = areaComponentIds(
    (layout as { areas?: unknown } | null)?.areas
  );
  return components.length === 0
    ? undefined
    : { id: chosen.id, value: layoutAreasDocument(components) };
}
