"use client";

/**
 * Custom HTML attributes editor (spec §4.6). A key/value repeater emitting a
 * `Record<string,string>`; a trailing empty row lets the author add another.
 * Names are sanitized again at render (allowlist, no on* / style).
 */
import type { ControlProps } from "../types";

export function AttributesControl({ value, onChange }: ControlProps) {
  const attrs =
    value && typeof value === "object" ? (value as Record<string, string>) : {};
  const rows = Object.entries(attrs);
  const commit = (next: [string, string][]) =>
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  const setRow = (i: number, k: string, v: string) => {
    const next = rows.slice();
    next[i] = [k, v];
    commit(next);
  };
  const display: [string, string][] = [...rows, ["", ""]];
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {display.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 4 }}>
          <input
            aria-label={`Attribute name ${i}`}
            placeholder="data-x"
            value={k}
            onChange={e => setRow(i, e.target.value, v)}
          />
          <input
            aria-label={`Attribute value ${i}`}
            placeholder="value"
            value={v}
            onChange={e => setRow(i, k, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
