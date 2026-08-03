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
  /**
   * Hosts a block's images may be loaded from. Empty or absent means
   * same-origin only, which is the default because an undeclared host is a
   * request a custom-CSS selector can gate on a secret.
   */
  remotePatterns?: readonly RemotePattern[];
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

/**
 * One host a block image may be loaded from.
 *
 * Deliberately the shape of Next.js's `images.remotePatterns`, because a Nextly
 * app already declares the same thing there for `next/image` and copying the
 * entry across should just work. `**` at the start of a hostname matches any
 * depth of subdomain; `*` matches one label. A pathname ending `/**` matches
 * any path beneath it.
 */
export interface RemotePattern {
  protocol?: "http" | "https";
  hostname: string;
  port?: string;
  pathname?: string;
}

function hostnameMatches(pattern: string, hostname: string): boolean {
  if (pattern === hostname) return true;
  // `**.example.com` matches any depth of subdomain but not the bare apex,
  // which is what Next.js does and what people expect from the extra star.
  if (pattern.startsWith("**.")) return hostname.endsWith(pattern.slice(2));
  if (pattern.startsWith("*.")) {
    const rest = hostname.slice(0, -(pattern.length - 1));
    return (
      hostname.endsWith(pattern.slice(1)) && rest !== "" && !rest.includes(".")
    );
  }
  return false;
}

function pathnameMatches(
  pattern: string | undefined,
  pathname: string
): boolean {
  if (pattern === undefined) return true;
  if (pattern.endsWith("/**")) return pathname.startsWith(pattern.slice(0, -2));
  return pattern === pathname;
}

/**
 * Whether a remote image URL is one this site has declared it loads from.
 *
 * Closed by default: with no patterns configured, nothing off-origin is
 * allowed. That is the same posture as `next/image`, and it is the posture the
 * page builder needs, because a remote image URL is a request whose firing can
 * be made conditional by a custom-CSS selector — so an undeclared host is a
 * channel out, not merely an unexpected image.
 */
export function isAllowedRemoteUrl(
  url: string,
  patterns: readonly RemotePattern[]
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // A pattern that names no protocol means "either of the two this type
  // allows", not "any scheme at all". Skipping the check when `protocol` was
  // omitted admitted `ftp:`, `file:` and `ws:` against a host-only pattern —
  // schemes `RemotePattern` cannot even express, arriving through the one path
  // that does not look.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return patterns.some(pattern => {
    if (
      pattern.protocol !== undefined &&
      `${pattern.protocol}:` !== parsed.protocol
    ) {
      return false;
    }
    if (!hostnameMatches(pattern.hostname, parsed.hostname)) return false;
    if (pattern.port !== undefined && pattern.port !== parsed.port)
      return false;
    return pathnameMatches(pattern.pathname, parsed.pathname);
  });
}

/**
 * Validate a URL for url().
 *
 * Two separate jobs. The syntactic one is unchanged: css-tree accepts a quoted
 * `javascript:` url, and a quote or paren in the value would break out of the
 * `url()` this is interpolated into.
 *
 * The other is where the request may go. A same-origin path is always fine; a
 * URL that leaves this origin is allowed only from a declared host. Custom CSS
 * is emitted into the same stylesheet as this output and can suppress a
 * declaration conditionally, so an image on an arbitrary host is a request an
 * author can gate on a secret-dependent selector and read back by its absence.
 * Refusing here is what makes that gate point at nothing.
 */
function safeUrl(
  url: string,
  remotePatterns: readonly RemotePattern[]
): string | null {
  const u = url.trim();
  if (/^(javascript|data|vbscript):/i.test(u)) return null;
  if (/["')\\]/.test(u) || /[\n\r]/.test(u)) return null; // avoid url() breakout
  // A scheme or a leading `//` means another origin may be reached; anything
  // else resolves against this document and needs no allowlist.
  const leavesOrigin = /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//");
  if (!leavesOrigin) return u;
  const absolute = u.startsWith("//") ? `https:${u}` : u;
  return isAllowedRemoteUrl(absolute, remotePatterns) ? u : null;
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
  remotePatterns: readonly RemotePattern[]
): string[] {
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
        const v = safeValue(raw);
        if (v) out.push(`border-${side}-width: ${v}`);
      }
    }
    if (b.style) {
      const v = safeValue(b.style);
      if (v) out.push(`border-style: ${v}`);
    }
    if (b.color != null) {
      const v = safeValue(resolveScalar(b.color));
      if (v) out.push(`border-color: ${v}`);
    }
  }

  // Position + offsets + z-index.
  if (sv.position) {
    const p = sv.position;
    if (p.type) {
      const v = safeValue(p.type);
      if (v) out.push(`position: ${v}`);
    }
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const raw = p[side];
      if (raw == null) continue;
      const v = safeValue(raw);
      if (v) out.push(`${side}: ${v}`);
    }
    if (p.zIndex != null) {
      const v = safeValue(String(p.zIndex));
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
      const v = safeValue(raw);
      if (v) out.push(`${cssName}: ${v}`);
    }
  }

  // Gradient (emitted as background-image; safeValue validates the function).
  if (sv.backgroundGradient) {
    const v = safeValue(sv.backgroundGradient);
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
    const v = safeValue(resolveScalar(base.linkColor));
    if (v) blocks.push(`.${cls} a { color: ${v}; }`);
  }
  if (base?.linkColorHover != null) {
    const v = safeValue(resolveScalar(base.linkColorHover));
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
