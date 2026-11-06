/**
 * A Layout's areas as a block document of component placements.
 *
 * A Layout names a component per area in a repeater, not in a blocks field,
 * so the render's discovery cannot read it directly. Shaped as placements, the
 * areas are judged exactly as a page's components are: what a visitor would
 * miss, nested components included.
 *
 * @module layout-areas-document
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import { relationId } from "./default-layout/store";

/** The component ids a stored `areas` value names, in order; junk skipped. */
export function areaComponentIds(areas: unknown): string[] {
  const rows = typeof areas === "string" ? parsed(areas) : areas;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(area =>
      relationId((area as { component?: unknown } | null)?.component)
    )
    .filter((id): id is string => id !== null);
}

/** Those components as placements in one document. */
export function layoutAreasDocument(
  components: readonly string[]
): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: components.map((componentId, index) => ({
      id: `layout-area-${String(index)}`,
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId },
    })),
  };
}

/** Stored JSON text, or `null` when it does not parse. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
