/**
 * Query Loop layout: turn the `columns`/`gap` props into a grid style so the loop reads as
 * a grid (Elementor's Loop Grid). `columns <= 1` returns undefined (plain stacked list, no
 * grid box). Shared by the production view, the design-time preview, and the canvas preview.
 */
import type { CSSProperties } from "react";

export function loopGridStyle(
  props: Record<string, unknown>
): CSSProperties | undefined {
  const raw = typeof props.columns === "number" ? props.columns : 1;
  const columns = raw > 1 ? Math.min(Math.floor(raw), 12) : 0;
  if (!columns) return undefined;
  const gap = typeof props.gap === "string" ? props.gap : "16px";
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap,
  };
}
