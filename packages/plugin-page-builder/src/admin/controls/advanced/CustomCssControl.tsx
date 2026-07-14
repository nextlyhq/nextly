"use client";

/**
 * Per-block custom CSS editor (spec §4.4). Authors target the block with the
 * `selector` keyword; the value is sanitized + scoped at save/render time.
 */
import type { ControlProps } from "../types";

export function CustomCssControl({ value, onChange }: ControlProps) {
  const v = typeof value === "string" ? value : "";
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <p className="nx-pb-empty" style={{ margin: 0 }}>
        Use <code>selector</code> to target this block. Sanitized on save.
      </p>
      <textarea
        rows={6}
        spellCheck={false}
        style={{ fontFamily: "monospace" }}
        value={v}
        aria-label="Custom CSS"
        placeholder={"selector {\n  \n}"}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
