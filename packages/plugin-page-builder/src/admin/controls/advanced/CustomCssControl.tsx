"use client";

/**
 * Per-block custom CSS editor (spec §4.4). Authors target the block with the
 * `selector` keyword; the value is sanitized + scoped at save/render time.
 */
import { useMemo } from "react";

import { sanitizeBlockCss } from "../../../core/css-sanitize";
import type { ControlProps } from "../types";

import { CssWarnings } from "./CssWarnings";

export function CustomCssControl({ value, onChange }: ControlProps) {
  const v = typeof value === "string" ? value : "";
  // Sanitized here purely to read back what it removed. The scope class does
  // not matter for that — nothing is rendered from this result — so a fixed one
  // keeps the memo from recomputing as the selection moves between blocks.
  const warnings = useMemo(
    () => sanitizeBlockCss(v, "nx-pb-preview").warnings,
    [v]
  );
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <p className="nx-pb-empty" style={{ margin: 0 }}>
        Use <code>selector</code> to target this block. Imports, off-site URLs
        and script-like values are removed on render.
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
      <CssWarnings warnings={warnings} />
    </div>
  );
}
