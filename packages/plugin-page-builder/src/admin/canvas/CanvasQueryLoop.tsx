"use client";

/**
 * Design-time Query Loop sample preview (spec §5). Appended AFTER the loop's editable
 * template on the canvas (never replacing it, so selection/drag/dropzones keep working): it
 * fetches a few real sample rows for the loop's collection and renders them read-only via the
 * production `RenderNode` (bindings resolved), so the author sees how the template maps to real
 * data. It spans the full column width and ignores pointer events. Production rendering is
 * unchanged; this is editor-only and bounded to a few rows.
 */
import { useEffect, useState } from "react";

import { defaultBlockRegistry } from "../../core/registry";
import { DEFAULT_SLOT, type BlockNode } from "../../core/types";
import { loopGridStyle } from "../../render/query/grid";
import { RenderNode } from "../../render/RenderNode";
import { getSampleEntries } from "../api/collectionsApi";

const PREVIEW_ROWS = 4;

export function QueryLoopSamplePreview({ node }: { node: BlockNode }) {
  const collection =
    typeof node.props.collection === "string" ? node.props.collection : "";
  const sort =
    typeof node.props.sort === "string" ? node.props.sort : undefined;
  const where = node.props.where;
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!collection) {
      setRows(null);
      return;
    }
    setError(false);
    getSampleEntries(collection, { limit: PREVIEW_ROWS, sort, where })
      .then(r => alive && setRows(r))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [collection, sort, where]);

  // Nothing to preview when unconfigured (the template alone communicates the block).
  if (!collection) return null;

  const template = node.slots?.[DEFAULT_SLOT] ?? [];

  return (
    <div style={{ gridColumn: "1 / -1", pointerEvents: "none" }} aria-hidden>
      <div style={labelStyle}>
        {error
          ? "Preview unavailable"
          : rows == null
            ? "Loading sample preview…"
            : rows.length === 0
              ? "No entries found"
              : `Live preview — ${collection}`}
      </div>
      {rows && rows.length > 0 ? (
        <div style={loopGridStyle(node.props) ?? { display: "grid", gap: 12 }}>
          {rows.map((item, i) => (
            <div key={i} data-nx-loop-item={i}>
              {template.map(child => (
                <RenderNode
                  key={child.id}
                  node={child}
                  registry={defaultBlockRegistry}
                  item={item}
                />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase" as const,
  color: "var(--nx-pb-ed-muted-foreground)",
  margin: "10px 0 6px",
  borderTop: "1px dashed var(--nx-pb-ed-border-strong)",
  paddingTop: 8,
};
