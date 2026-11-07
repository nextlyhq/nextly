/**
 * A page's Layout as the report judges it: the components its regions place,
 * as a document placing each, so their bindings to the entry are judged
 * against the page's own entry, as the published page draws them.
 *
 * @module bindings-report/layout-regions
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";

import { effectiveLayoutFor } from "../default-layout/effective-layout";
import { relationId, type DefaultLayoutSlugs } from "../default-layout/store";
import type { HostAddress } from "../host-rewrite/contract";

/** What reading a page's Layout needs. */
export interface LayoutRegionsDeps {
  /** The pages collection, as renamed: only its entries are drawn in a Layout. */
  readonly pages: string;
  readonly slugs: DefaultLayoutSlugs;
}

/** A document placing each of a Layout's region components, by its areas. */
function regionsDocument(areas: readonly unknown[]): unknown {
  const nodes = areas.flatMap((entry, index) => {
    const area = entry as { area?: unknown; component?: unknown };
    const componentId = relationId(area.component);
    if (componentId === null) return [];
    const name = typeof area.area === "string" ? area.area : String(index);
    return [
      {
        id: `layout-${name}`,
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId },
      },
    ];
  });
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
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
  const areas = (layout as { areas?: unknown } | null)?.areas;
  return Array.isArray(areas)
    ? { id: chosen.id, value: regionsDocument(areas) }
    : undefined;
}
