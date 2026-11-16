/**
 * The regions a Layout fills around a page, read from a stored Layout row,
 * and the document each region is drawn from.
 *
 * Pure, and in the engine, because three readers ask the same question: the
 * published route that draws a page inside its Layout, the editor's canvas
 * that shows the same regions around the page being edited, and the plugin's
 * route that lists the Layouts an author can choose. One reading of a stored
 * `areas` value, so a region the site draws is the region the editor shows.
 *
 * @module layout-regions
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "./document";

/**
 * The areas drawn around a page, in the order they are drawn relative to it:
 * the header before the page, the footer after.
 *
 * Stated here rather than read from the plugin's area list, which the engine
 * cannot import. An area the plugin adds later is simply not drawn until a
 * reader knows where it goes, which is the honest answer: a sidebar has no
 * position in "before the page, after the page".
 */
export const REGION_AREAS = ["header", "footer"] as const;

/** One of the areas drawn around a page. */
export type RegionArea = (typeof REGION_AREAS)[number];

/** One region to draw: which area, filled by which component. */
export interface LayoutRegion {
  readonly area: RegionArea;
  readonly componentId: string;
}

/**
 * A relationship value as an id: stored as the id, or populated as the row.
 *
 * A read at depth 0 answers the id and a populated read answers the row, so
 * both are accepted rather than trusting one shape.
 */
export function layoutRelationId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "object" && value !== null) {
    return layoutRelationId((value as { id?: unknown }).id);
  }
  return null;
}

/**
 * The regions a Layout row fills, in the order they are drawn.
 *
 * `areas` is a repeater stored as JSON, so it is read as untrusted data: a row
 * with no area or no component is skipped, and the first row for an area wins
 * (the Layout's own write refuses a repeated area, so a second can only arrive
 * from a write that skipped that check).
 */
export function regionsOf(
  row: { readonly areas?: unknown } | undefined
): readonly LayoutRegion[] {
  const areas = row?.areas;
  if (!Array.isArray(areas)) return [];
  const regions: LayoutRegion[] = [];
  for (const area of REGION_AREAS) {
    const filled = areas.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as { area?: unknown }).area === area
    ) as { component?: unknown } | undefined;
    const componentId = layoutRelationId(filled?.component);
    if (componentId !== null) regions.push({ area, componentId });
  }
  return regions;
}

/**
 * A document holding one component instance per region.
 *
 * A region is drawn through the SAME composition path as a component on a
 * page, rather than through a renderer of its own: an instance node is what
 * that path already reads, tags, budgets and draws, nested components and
 * drafts included. The node id is fixed per area, so each region's compiled
 * classes are stable from one render to the next.
 */
export function regionDocument(
  regions: readonly LayoutRegion[]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: regions.map(region => ({
      id: `nextly-region-${region.area}`,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: region.componentId },
    })),
  };
}
