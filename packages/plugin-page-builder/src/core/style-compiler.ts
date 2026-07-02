/**
 * Typed style → scoped CSS compiler (spec §8). React-free.
 *
 * - Values are validated through a real CSS parser (css-tree) so nothing can break
 *   out of its declaration block; URLs get explicit scheme checks (css-tree accepts
 *   `url("javascript:…")` syntactically, so a parser alone is not enough).
 * - Design-token refs compile to CSS custom properties.
 * - Breakpoints are project-configurable DATA; default cascade is DESKTOP-FIRST.
 */
import * as csstree from "css-tree";

import { walk } from "./tree";
import type {
  BlockDocument,
  BlockNode,
  ResponsiveStyle,
  StyleScalar,
  StyleValues,
} from "./types";

export interface BreakpointDef {
  id: string;
  maxWidth: number;
}

/** Desktop-first defaults (base = desktop; these override downward). */
export const DEFAULT_BREAKPOINTS: BreakpointDef[] = [
  { id: "tablet", maxWidth: 1024 },
  { id: "mobile", maxWidth: 640 },
];

export interface CompileOptions {
  breakpoints?: BreakpointDef[];
}

/** Deterministic, short, stable scoped class for a node id (FNV-1a → base36). */
export function nodeClass(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `nx-pb-${(h >>> 0).toString(36)}`;
}

function resolveScalar(v: StyleScalar): string {
  if (typeof v === "object" && v !== null && "token" in v) {
    return `var(--nx-${String(v.token).replace(/\./g, "-")})`;
  }
  return String(v);
}

/** Validate a CSS *value*. Returns the value if safe, else null (dropped). */
function safeValue(v: string): string | null {
  if (v == null || v === "") return null;
  if (/[{};<>]/.test(v)) return null; // fast reject declaration/tag breakout
  try {
    csstree.parse(v, {
      context: "value",
      onParseError: e => {
        throw e;
      },
    });
    return v;
  } catch {
    return null;
  }
}

/** Validate a URL for url(). css-tree accepts quoted `javascript:` urls, so check the scheme. */
function safeUrl(url: string): string | null {
  const u = url.trim();
  if (/^(javascript|data|vbscript):/i.test(u)) return null;
  if (/["')\\]/.test(u) || /[\n\r]/.test(u)) return null; // avoid url() breakout
  return u;
}

const SIMPLE: [keyof StyleValues, string][] = [
  ["backgroundColor", "background-color"],
  ["color", "color"],
  ["fontSize", "font-size"],
  ["lineHeight", "line-height"],
  ["textAlign", "text-align"],
  ["width", "width"],
  ["maxWidth", "max-width"],
  ["height", "height"],
  ["borderRadius", "border-radius"],
  ["display", "display"],
  ["gridTemplateColumns", "grid-template-columns"],
  ["gap", "gap"],
  ["justifyContent", "justify-content"],
  ["alignItems", "align-items"],
];

function compileStyleValues(sv: StyleValues): string[] {
  const out: string[] = [];

  const box = (prop: "margin" | "padding") => {
    const sides = sv[prop];
    if (!sides) return;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const raw = sides[side];
      if (raw == null) continue;
      const v = safeValue(raw);
      if (v) out.push(`${prop}-${side}: ${v}`);
    }
  };
  box("margin");
  box("padding");

  for (const [key, cssName] of SIMPLE) {
    const raw = sv[key] as StyleScalar | undefined;
    if (raw == null) continue;
    const v = safeValue(resolveScalar(raw));
    if (v) out.push(`${cssName}: ${v}`);
  }

  if (sv.backgroundImage != null) {
    const url = safeUrl(resolveScalar(sv.backgroundImage));
    if (url) out.push(`background-image: url("${url}")`);
  }

  return out;
}

export function compileNodeCss(
  node: BlockNode,
  opts: CompileOptions = {}
): string {
  const style: ResponsiveStyle | undefined = node.style;
  if (!style) return "";
  const bps = opts.breakpoints ?? DEFAULT_BREAKPOINTS;
  const cls = nodeClass(node.id);
  const blocks: string[] = [];

  const base = style.base ? compileStyleValues(style.base) : [];
  if (base.length) blocks.push(`.${cls} { ${base.join("; ")}; }`);

  for (const bp of bps) {
    const sv = style[bp.id];
    const decls = sv ? compileStyleValues(sv) : [];
    if (decls.length) {
      blocks.push(
        `@media (max-width: ${bp.maxWidth}px) { .${cls} { ${decls.join("; ")}; } }`
      );
    }
  }

  return blocks.join("\n");
}

/** One <style> block worth of CSS for the whole document. */
export function compileDocumentCss(
  doc: BlockDocument,
  opts: CompileOptions = {}
): string {
  const parts: string[] = [];
  walk(doc.root, n => {
    const css = compileNodeCss(n, opts);
    if (css) parts.push(css);
  });
  return parts.join("\n");
}
