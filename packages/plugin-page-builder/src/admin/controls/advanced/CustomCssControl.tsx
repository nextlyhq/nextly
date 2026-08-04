"use client";

/**
 * Per-block custom CSS editor (spec §4.4). Authors target the block with the
 * `selector` keyword; the value is sanitized + scoped at save/render time.
 */
import { useDeferredValue, useMemo } from "react";

import { sanitizeBlockCss } from "../../../core/css-sanitize";
import type { ControlProps } from "../types";

import { CssWarnings } from "./CssWarnings";

export function CustomCssControl({ value, onChange }: ControlProps) {
  const v = typeof value === "string" ? value : "";
  // Sanitized here purely to read back what it removed. The scope class does
  // not matter for that — nothing is rendered from this result — so a fixed one
  // keeps the memo from recomputing as the selection moves between blocks.
  //
  // Deferred for the same reason the page-level editor is: the memo's key is
  // the text itself, so it recomputes on every keystroke, and sanitizing parses
  // the whole stylesheet and walks it several times. Letting the character land
  // first is also the better behaviour — a warning about a declaration the
  // author has not finished typing is noise.
  const deferred = useDeferredValue(v);
  const warnings = useMemo(
    () => sanitizeBlockCss(deferred, "nx-pb-preview").warnings,
    [deferred]
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
