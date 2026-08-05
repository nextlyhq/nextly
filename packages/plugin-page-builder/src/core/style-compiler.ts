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

import { sanitizeBlockCss } from "./css-sanitize";
import { compileMotionCss, MOTION_KEYFRAMES } from "./motion";
import { walk } from "./tree";
import type {
  BlockDocument,
  BlockNode,
  ResponsiveStyle,
  StyleScalar,
  StyleValues,
} from "./types";
import {
  fetchableValues,
  isFetchableUrl,
  type RemotePatternInput,
} from "./url-policy";

export interface BreakpointDef {
  id: string;
  maxWidth: number;
}

/** Desktop-first defaults (base = desktop; these override downward). */
export const DEFAULT_BREAKPOINTS: BreakpointDef[] = [
  { id: "tablet", maxWidth: 1024 },
  { id: "mobile", maxWidth: 640 },
];

export type { RemotePatternInput } from "./url-policy";
export { isAllowedRemoteUrl } from "./url-policy";

export interface CompileOptions {
  breakpoints?: BreakpointDef[];
  /**
   * Hosts a block's images may be loaded from. Empty or absent means
   * same-origin only, which is the default because an undeclared host is a
   * request a custom-CSS selector can gate on a secret.
   */
  remotePatterns?: readonly RemotePatternInput[];
}

/**
 * Default design-token palette (spec §8). Token refs (`{ token: "color.primary" }`)
 * compile to `var(--nx-color-primary)`; these values back those vars out of the box so
 * tokens work without extra config. A host can override via `PageRenderer`'s `tokens`
 * prop (a fuller project-config surface is a future door).
 */
export const DEFAULT_TOKENS: Record<string, string> = {
  "color.primary": "#4f46e5",
  "color.secondary": "#0ea5e9",
  "color.accent": "#f59e0b",
  "color.text": "#111827",
  "color.heading": "#0f172a",
  "color.muted": "#6b7280",
  "color.surface": "#f8fafc",
  "color.background": "#ffffff",
  "color.border": "#e5e7eb",
};

/** Emit the token palette as CSS custom properties on the page root. */
export function compileTokensCss(
  rootClass: string,
  tokens: Record<string, string> = DEFAULT_TOKENS
): string {
  const decls: string[] = [];
  for (const [key, value] of Object.entries(tokens)) {
    const v = safeValue(value);
    if (v) decls.push(`--nx-${key.replace(/\./g, "-")}: ${v}`);
  }
  return decls.length ? `.${rootClass} { ${decls.join("; ")}; }` : "";
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

/**
 * Validate a CSS *value*. Returns the value if safe, else null (dropped).
 *
 * The origin check runs over EVERY value rather than the properties someone
 * remembered can fetch. `filter: url("https://…#f")` is a request, and it
 * reached the page because `filter` went through the plain-value path while
 * only `backgroundImage` was checked — a hand-kept list of fetch-capable
 * properties is the same losing shape as a hand-kept list of dangerous
 * schemes. Asking the parser which values contain a `url()` cannot miss one.
 */
export function safeValue(
  v: string,
  remotePatterns: readonly RemotePatternInput[] = []
): string | null {
  if (v == null || v === "") return null;
  if (/[{};<>]/.test(v)) return null; // fast reject declaration/tag breakout
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(v, {
      context: "value",
      onParseError: e => {
        throw e;
      },
    });
  } catch {
    return null;
  }
  const { values, unreadable } = fetchableValues(ast);
  // Unreadable is not safe. A fragment this could not resolve may hold a URL,
  // so the value goes rather than being emitted unchecked.
  if (unreadable !== undefined) return null;
  const refused = values.some(url => !isFetchableUrl(url, remotePatterns));
  return refused ? null : v;
}

/**
 * Validate a URL for url().
 *
 * The syntactic half is unchanged: css-tree accepts a quoted `javascript:` url,
 * and a quote or paren in the value would break out of the `url()` this is
 * interpolated into. The origin half is the shared policy, so a structured
 * style value and custom CSS answer "where may this fetch from" the same way.
 */
function safeUrl(
  url: string,
  remotePatterns: readonly RemotePatternInput[]
): string | null {
  const u = url.trim();
  if (/^(javascript|data|vbscript):/i.test(u)) return null;
  if (/["')\\]/.test(u) || /[\n\r]/.test(u)) return null; // avoid url() breakout
  return isFetchableUrl(u, remotePatterns) ? u : null;
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
  ["fontFamily", "font-family"],
  ["fontWeight", "font-weight"],
  ["letterSpacing", "letter-spacing"],
  ["wordSpacing", "word-spacing"],
  ["textTransform", "text-transform"],
  ["fontStyle", "font-style"],
  ["textDecoration", "text-decoration"],
  ["textShadow", "text-shadow"],
  ["minHeight", "min-height"],
  ["objectFit", "object-fit"],
  ["overflow", "overflow"],
  ["aspectRatio", "aspect-ratio"],
  ["boxShadow", "box-shadow"],
  ["opacity", "opacity"],
  ["filters", "filter"],
  ["mixBlendMode", "mix-blend-mode"],
  ["transform", "transform"],
  ["transition", "transition"],
];

function compileStyleValues(
  sv: StyleValues,
  remotePatterns: readonly RemotePatternInput[]
): string[] {
  const out: string[] = [];

  const box = (prop: "margin" | "padding") => {
    const sides = sv[prop];
    if (!sides) return;
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const raw = sides[side];
      if (raw == null) continue;
      const v = safeValue(raw, remotePatterns);
      if (v) out.push(`${prop}-${side}: ${v}`);
    }
  };
  box("margin");
  box("padding");

  for (const [key, cssName] of SIMPLE) {
    const raw = sv[key] as StyleScalar | undefined;
    if (raw == null) continue;
    const v = safeValue(resolveScalar(raw), remotePatterns);
    if (v) out.push(`${cssName}: ${v}`);
  }

  if (sv.backgroundImage != null) {
    const url = safeUrl(resolveScalar(sv.backgroundImage), remotePatterns);
    if (url) out.push(`background-image: url("${url}")`);
  }

  // Structured border (per-side width + style + color).
  if (sv.border) {
    const b = sv.border;
    if (b.width) {
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const raw = b.width[side];
        if (raw == null) continue;
        const v = safeValue(raw, remotePatterns);
        if (v) out.push(`border-${side}-width: ${v}`);
      }
    }
    if (b.style) {
      const v = safeValue(b.style, remotePatterns);
      if (v) out.push(`border-style: ${v}`);
    }
    if (b.color != null) {
      const v = safeValue(resolveScalar(b.color), remotePatterns);
      if (v) out.push(`border-color: ${v}`);
    }
  }

  // Position + offsets + z-index.
  if (sv.position) {
    const p = sv.position;
    if (p.type) {
      const v = safeValue(p.type, remotePatterns);
      if (v) out.push(`position: ${v}`);
    }
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const raw = p[side];
      if (raw == null) continue;
      const v = safeValue(raw, remotePatterns);
      if (v) out.push(`${side}: ${v}`);
    }
    if (p.zIndex != null) {
      const v = safeValue(String(p.zIndex), remotePatterns);
      if (v) out.push(`z-index: ${v}`);
    }
  }

  // Structured background image.
  if (sv.backgroundImageObj) {
    const bg = sv.backgroundImageObj;
    if (bg.url != null) {
      const url = safeUrl(resolveScalar(bg.url), remotePatterns);
      if (url) out.push(`background-image: url("${url}")`);
    }
    for (const [k, cssName] of [
      ["position", "background-position"],
      ["size", "background-size"],
      ["repeat", "background-repeat"],
      ["attachment", "background-attachment"],
    ] as const) {
      const raw = bg[k];
      if (raw == null) continue;
      const v = safeValue(raw, remotePatterns);
      if (v) out.push(`${cssName}: ${v}`);
    }
  }

  // Gradient (emitted as background-image; safeValue validates the function).
  if (sv.backgroundGradient) {
    const v = safeValue(sv.backgroundGradient, remotePatterns);
    if (v) out.push(`background-image: ${v}`);
  }

  // Width alignment (Gutenberg none / wide / full).
  if (sv.widthAlign === "wide") {
    out.push("max-width: 1100px", "margin-left: auto", "margin-right: auto");
  } else if (sv.widthAlign === "full") {
    out.push("max-width: none", "width: 100%");
  }

  return out;
}

export function compileNodeCss(
  node: BlockNode,
  opts: CompileOptions = {}
): string {
  const bps = opts.breakpoints ?? DEFAULT_BREAKPOINTS;
  const remotePatterns = opts.remotePatterns ?? [];
  const cls = nodeClass(node.id);
  const blocks: string[] = [];

  const hasHover = !!node.styleHover && Object.keys(node.styleHover).length > 0;
  // Smooth the normal → hover change (Elementor-style).
  if (hasHover) blocks.push(`.${cls} { transition: all 0.2s ease; }`);

  const emit = (style: ResponsiveStyle | undefined, suffix: string): void => {
    if (!style) return;
    const base = style.base
      ? compileStyleValues(style.base, remotePatterns)
      : [];
    if (base.length) blocks.push(`.${cls}${suffix} { ${base.join("; ")}; }`);
    for (const bp of bps) {
      const sv = style[bp.id];
      const decls = sv ? compileStyleValues(sv, remotePatterns) : [];
      if (decls.length) {
        blocks.push(
          `@media (max-width: ${bp.maxWidth}px) { .${cls}${suffix} { ${decls.join("; ")}; } }`
        );
      }
    }
  };

  emit(node.style, "");
  emit(node.styleHover, ":hover");

  // Descendant link colors (Default / Hover) → `.cls a` / `.cls a:hover`.
  const base = node.style?.base;
  if (base?.linkColor != null) {
    const v = safeValue(resolveScalar(base.linkColor), remotePatterns);
    if (v) blocks.push(`.${cls} a { color: ${v}; }`);
  }
  if (base?.linkColorHover != null) {
    const v = safeValue(resolveScalar(base.linkColorHover), remotePatterns);
    if (v) blocks.push(`.${cls} a:hover { color: ${v}; }`);
  }

  // Entrance motion.
  const motionCss = compileMotionCss(node, cls);
  if (motionCss) blocks.push(motionCss);

  // Per-breakpoint visibility → display:none media queries.
  if (node.visibility) {
    if (node.visibility.base === false) {
      blocks.push(`.${cls} { display: none; }`);
    }
    for (const bp of bps) {
      if (node.visibility[bp.id] === false) {
        blocks.push(
          `@media (max-width: ${bp.maxWidth}px) { .${cls} { display: none; } }`
        );
      }
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

/** Emit the shared motion keyframes once, if any node in the document animates. */
export function compileDocumentMotionCss(doc: BlockDocument): string {
  let any = false;
  walk(doc.root, n => {
    if (n.motion?.entrance && n.motion.entrance !== "none") any = true;
  });
  return any ? MOTION_KEYFRAMES : "";
}

/** Collect every node's sanitized per-block custom CSS for the page <style> (spec §4.4). */
export function compileDocumentBlockCss(doc: BlockDocument): string {
  const parts: string[] = [];
  walk(doc.root, n => {
    if (n.customCss) {
      const scoped = sanitizeBlockCss(n.customCss, nodeClass(n.id));
      // `.css`, not the result: the object is always truthy, so testing it
      // would push an empty string for every block that has none.
      if (scoped.css) parts.push(scoped.css);
    }
  });
  return parts.join("\n");
}
