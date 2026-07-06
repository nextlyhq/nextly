/**
 * Pick the inspector tab a freshly-selected block should open to, so no block ever opens
 * to an empty pane (spec §3.5). Content first, then Style, then Advanced.
 */
import type { BlockDefinition } from "../../core/types";

export type InspectorTab = "content" | "style" | "advanced";

export function firstPopulatedTab(
  def: BlockDefinition | undefined
): InspectorTab {
  if ((def?.contentFields?.length ?? 0) > 0) return "content";
  if ((def?.styleControls?.length ?? 0) > 0) return "style";
  return "advanced";
}
