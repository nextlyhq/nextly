/**
 * Typed style → scoped CSS compiler (spec §8). React-free.
 *
 * - Values are validated through a real CSS parser (css-tree) so nothing can break
 *   out of its declaration block; URLs get explicit scheme checks (css-tree accepts
 *   `url("javascript:…")` syntactically, so a parser alone is not enough).
 * - Design-token refs compile to CSS custom properties.
 * - Breakpoints are project-configurable DATA; default cascade is DESKTOP-FIRST.
 */
import {
  hashId,
  nodeClassName,
  nodeClassNames,
  PAGE_ROOT_CLASS,
} from "@nextlyhq/blocks-engine";
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
  /**
   * The document's own class, put in front of every node selector.
   *
   * Absent leaves the selectors bare, which is what a caller compiling one
   * document in isolation wants. A page rendering more than one passes
   * `documentScopeClass(doc)`, so two documents that share a node id — the
   * ordinary result of rendering one reusable block in both — do not restyle
   * each other from whichever stylesheet loaded last.
   */
  scope?: string;
  /**
   * The document's node classes, from {@link documentNodeClasses}.
   *
   * Supplied when the caller has the whole document, because a disambiguating
   * suffix can only be worked out from the whole id set. A node compiled
   * without one gets the plain class, which is what a caller holding a single
   * node can know.
   */
  classes?: ReadonlyMap<string, string>;
  /**
   * The reusable-block library this page can reference, keyed by ref id.
   *
   * Supplied so a reusable block's OWN styles reach the page. Without it the compiler never sees
   * those nodes — `walk` visits slots, and a library subtree is reached through `refs` rather than
   * through the tree — so every style stored on a reusable block was silently dropped while the
   * editor went on offering the controls that wrote it.
   */
  refs?: Record<string, BlockNode>;
  /**
   * The ref id whose library subtree is being compiled, when it is one.
   *
   * Absent for the document's own nodes. Present, a node is named from {@link refScopedKey}
   * instead of its bare id, which is what keeps a library node that shares an id with a document
   * node from wearing the document node's class — and its styles.
   */
  refScope?: string;
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

/**
 * Deterministic, short, stable scoped class for a node id.
 *
 * The engine's function under this package's name. It had its own 32-bit digest
 * here, emitting the same `nx-pb-` prefix from a different hash than the engine
 * put on the same node — so the two could name one node two ways, and the
 * narrower one carried roughly a 1-in-350 chance of a collision across 5,000
 * ids, which a large page reaches.
 *
 * A whole document goes through {@link documentNodeClasses}, which is the only
 * caller that can see a collision at all. This one is for a caller holding a
 * single node: the editor asking which selector to scrub, or a test naming an
 * expected class.
 */
/**
 * The class a node of the DOCUMENT is styled by.
 *
 * Still "the class for this node id" from a caller's side. The key composition below is an
 * internal detail of how the document and the reusable library are held apart, and a caller
 * holding a node id should not have to know it exists.
 *
 * A node inside a reusable block is named by {@link refNodeClass} instead, because its id alone
 * does not identify it — two library blocks, or a library block and the document, can each hold
 * the same id.
 */
export function nodeClass(nodeId: string): string {
  return nodeClassName(documentKey(nodeId));
}

/** The class a node INSIDE a reusable block is styled by. */
export function refNodeClass(refId: string, nodeId: string): string {
  return nodeClassName(refScopedKey(refId, nodeId));
}

/**
 * The key a node inside a reusable block is named by.
 *
 * A node reached through `core/ref` is not in the document's own id space. A block made reusable
 * from a node that stayed put is the ordinary way to make one, so a library subtree very often
 * holds an id the document also holds — and naming both from the id alone gives them the same
 * class, so the referenced node silently wears the document node's styles.
 *
 * Length-prefixed rather than joined by a separator, because a separator has to be a character
 * neither an id nor a ref id can contain, and nothing guarantees that: `("a", "b/c")` and
 * `("a/b", "c")` would both spell `a/b/c` and two different nodes would share a class. The prefix
 * makes the split unambiguous whatever the two strings contain.
 *
 * Scoped by the ref id rather than by the PLACEMENT, so a reusable block placed twice names its
 * nodes the same both times and one rule serves every placement. That is what makes editing the
 * block update everywhere it appears, which is the whole point of a reusable block. It also means
 * a nested ref is named by the block it lives in, not by the path taken to reach it, so a block
 * placed directly and through another block resolves to one set of names.
 */
export function refScopedKey(refId: string, nodeId: string): string {
  return `${refId.length}:${refId}${nodeId}`;
}

/**
 * The key a node of the document itself is named by.
 *
 * Prefixed too, and that is the whole point. Length-prefixing only the ref keys makes one
 * (ref, id) pair unambiguous against another, but NOT against a bare id — and a node id is any
 * non-empty string a document can carry. An imported or plugin-produced document could hold the
 * literal id `2:r1same`, which is exactly what `refScopedKey("r1", "same")` generates; both would
 * land in one key set, `nodeClassNames` would collapse them to a single class, and the library's
 * rule would style the document node too.
 *
 * With both sides prefixed the number states how many of the following characters are the scope,
 * so every key parses back to exactly one (scope, id) pair. A document is the EMPTY scope, which
 * no usable ref id can be.
 */
export function documentKey(nodeId: string): string {
  return `0:${nodeId}`;
}

/**
 * The ref ids a document actually reaches, following refs inside refs.
 *
 * Only these get RULES. The whole library stays in the key set, because a disambiguating suffix
 * that changed with which blocks a page happened to place would name the same library node
 * differently on two pages and no shared stylesheet could exist. But emitting the whole library's
 * CSS on every page is weight that grows with the library rather than with the page.
 *
 * Cycle-guarded by the visited set, which is what the renderer's `refStack` does for the same
 * reason: a block that references itself must not walk forever here either.
 */
export function placedRefIds(
  doc: BlockDocument,
  refs?: Record<string, BlockNode>
): string[] {
  const placed: string[] = [];
  const seen = new Set<string>();
  const visit = (node: BlockNode): void => {
    if (node.type !== "core/ref") return;
    const refId = typeof node.props?.refId === "string" ? node.props.refId : "";
    if (refId === "" || seen.has(refId)) return;
    const target = refs?.[refId];
    if (!target) return;
    seen.add(refId);
    placed.push(refId);
    walk(target, visit);
  };
  walk(doc.root, visit);
  return placed.sort();
}

/** Every node id in a document, in document order. */
export function documentNodeIds(doc: BlockDocument): string[] {
  const ids: string[] = [];
  walk(doc.root, node => ids.push(node.id));
  return ids;
}

/**
 * Every name a page can style: the document's own node ids, then one ref-scoped key per node of
 * every reusable block the library holds.
 *
 * Both sets go through ONE {@link nodeClassNames} call, because the disambiguating suffix depends
 * on the whole set. Naming the document from one call and the library from another would let a
 * document id and a library key hash alike and each be told it was unique.
 *
 * The library is read whole rather than only the blocks this document places. A page that places
 * a block conditionally would otherwise change every other node's disambiguation depending on
 * which blocks happened to be referenced, so the same library node would be named differently on
 * two pages and a shared stylesheet could not exist.
 */
export function pageStyleKeys(
  doc: BlockDocument,
  refs?: Record<string, BlockNode>
): string[] {
  const keys = documentNodeIds(doc).map(documentKey);
  for (const refId of Object.keys(refs ?? {}).sort()) {
    const target = refs?.[refId];
    // An empty ref id would generate the empty scope, which is the document's own namespace. The
    // renderer never resolves one either — it reads a missing ref id as a missing target — so
    // skipping it keeps both halves naming the same set.
    if (!target || refId === "") continue;
    walk(target, node => keys.push(refScopedKey(refId, node.id)));
  }
  return keys;
}

/**
 * The class for every node in a document, with hash collisions disambiguated.
 *
 * Built once per document and handed to both halves, because the disambiguating
 * suffix depends on the whole id set: the compiler writing `-0` while the
 * renderer writes the bare class would anchor the stylesheet to a name the
 * markup does not carry, which is a worse failure than the collision it set out
 * to fix.
 *
 * The set spans BOTH key spaces: the document's own nodes, and one ref-scoped key per node of
 * every reusable block in `refs`. Pass the library whenever the page can reference one — omitting
 * it, or discarding this map at a `core/ref` boundary, puts a library node back on a bare-id name
 * and it silently takes the class, and therefore the styles, of a document node holding that id.
 *
 * One call rather than two, because the disambiguating suffix depends on the whole set: naming the
 * document from one call and the library from another would let a document key and a library key
 * hash alike and each be told it was unique.
 */
export function documentNodeClasses(
  doc: BlockDocument,
  refs?: Record<string, BlockNode>
): Map<string, string> {
  return nodeClassNames(pageStyleKeys(doc, refs));
}

/**
 * The class that identifies ONE document, for everything two documents on a
 * page must not share.
 *
 * `nx-pb-page` is on every page-builder document by design — it is the public
 * hook a host styles against — so it cannot also be what separates them. Two
 * documents rendered into one page both anchor their custom CSS to it, and
 * both namespace their `@keyframes` and `@font-face` off it, which means one
 * document's `fade` is the other's and the later `<style>` wins for both. The
 * per-node classes never had that problem because a node id is unique; this
 * gives the document the same property.
 *
 * Derived from the root node's id rather than generated, because the same
 * document has to produce the same class every time it is compiled: a
 * counter or a random token would differ between the server render and the
 * client's, and the styles would arrive anchored to a class the markup does
 * not carry. Two renders of the SAME document share a scope, which is correct —
 * they are the same document, and its names should mean the same thing in both.
 *
 * The engine's digest, at the width it already provides. What a collision costs
 * here is worse than it costs a node — two documents on one page would be back
 * to sharing their custom CSS, their token block and their namespaced
 * `@keyframes`, which is the failure this class exists to prevent, restored
 * silently and only when both happen to render together. 53 bits over the
 * handful of documents a page holds is far past that mattering, and a second
 * digest kept here to widen it is the duplication that let the two disagree.
 */
export function documentScopeClass(doc: BlockDocument): string {
  const id = doc?.root?.id;
  return typeof id === "string" && id !== ""
    ? `nx-pb-d-${hashId(id)}`
    : PAGE_ROOT_CLASS;
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
  // Named by the key it belongs to, so a library node and a document node holding the same id
  // stay apart. Both sides derive the key the same way; a class the compiler invents that the
  // renderer does not is a rule matching nothing.
  const styleKey =
    opts.refScope === undefined || opts.refScope === ""
      ? documentKey(node.id)
      : refScopedKey(opts.refScope, node.id);
  const cls = opts.classes?.get(styleKey) ?? nodeClassName(styleKey);
  // The document's own class in front of the node's, when the caller supplies
  // one. A node class is a hash of the node id, and two documents can hold the
  // same id — a reusable block rendered in both is the ordinary way — so
  // without this the later `<style>` restyles matching blocks in the other
  // document even though their roots now carry different scopes. The same
  // boundary the tokens and the custom CSS already sit behind.
  const self = opts.scope ? `.${opts.scope} .${cls}` : `.${cls}`;
  const blocks: string[] = [];

  const hasHover = !!node.styleHover && Object.keys(node.styleHover).length > 0;
  // Smooth the normal → hover change (Elementor-style).
  if (hasHover) blocks.push(`${self} { transition: all 0.2s ease; }`);

  const emit = (style: ResponsiveStyle | undefined, suffix: string): void => {
    if (!style) return;
    const base = style.base
      ? compileStyleValues(style.base, remotePatterns)
      : [];
    if (base.length) blocks.push(`${self}${suffix} { ${base.join("; ")}; }`);
    for (const bp of bps) {
      const sv = style[bp.id];
      const decls = sv ? compileStyleValues(sv, remotePatterns) : [];
      if (decls.length) {
        blocks.push(
          `@media (max-width: ${bp.maxWidth}px) { ${self}${suffix} { ${decls.join("; ")}; } }`
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
    if (v) blocks.push(`${self} a { color: ${v}; }`);
  }
  if (base?.linkColorHover != null) {
    const v = safeValue(resolveScalar(base.linkColorHover), remotePatterns);
    if (v) blocks.push(`${self} a:hover { color: ${v}; }`);
  }

  // Entrance motion.
  const motionCss = compileMotionCss(node, self);
  if (motionCss) blocks.push(motionCss);

  // Per-breakpoint visibility → display:none media queries.
  if (node.visibility) {
    if (node.visibility.base === false) {
      blocks.push(`${self} { display: none; }`);
    }
    for (const bp of bps) {
      if (node.visibility[bp.id] === false) {
        blocks.push(
          `@media (max-width: ${bp.maxWidth}px) { ${self} { display: none; } }`
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
  // Resolved once for the document and passed down, so every node in this
  // stylesheet is named by the same map the markup is named by.
  const classes = opts.classes ?? documentNodeClasses(doc, opts.refs);
  const nodeOpts = { ...opts, classes };
  const parts: string[] = [];
  walk(doc.root, n => {
    const css = compileNodeCss(n, nodeOpts);
    if (css) parts.push(css);
  });
  // The library, after the document. A reusable block's own styles are the tier BELOW a
  // placement's, so at one specificity source order is what makes a placement able to override
  // the block it places — the same reason the tiers above are emitted whole, one after another.
  for (const refId of placedRefIds(doc, opts.refs)) {
    const target = opts.refs?.[refId];
    if (!target) continue;
    walk(target, n => {
      const css = compileNodeCss(n, { ...nodeOpts, refScope: refId });
      if (css) parts.push(css);
    });
  }
  return parts.join("\n");
}

/**
 * Emit the shared motion keyframes once, if anything the page renders animates.
 *
 * The library counts. A reusable block that animates is on the page as much as a document node
 * that does, and withholding the keyframes because only a referenced node uses them leaves its
 * animation naming a rule nobody wrote.
 */
export function compileDocumentMotionCss(
  doc: BlockDocument,
  refs?: Record<string, BlockNode>
): string {
  let any = false;
  const check = (n: BlockNode): void => {
    if (n.motion?.entrance && n.motion.entrance !== "none") any = true;
  };
  walk(doc.root, check);
  for (const target of Object.values(refs ?? {})) {
    if (target) walk(target, check);
  }
  return any ? MOTION_KEYFRAMES : "";
}

/** Collect every node's sanitized per-block custom CSS for the page <style> (spec §4.4). */
export function compileDocumentBlockCss(
  doc: BlockDocument,
  classes?: ReadonlyMap<string, string>,
  refs?: Record<string, BlockNode>,
  /**
   * The document's own class, nested outside each block's.
   *
   * Without it a block's custom CSS is anchored to the node class alone, and a node class is a
   * hash of a key rather than of a document — so two pages rendering the same reusable block with
   * different custom CSS resolve to the same selector.
   */
  scope?: string
): string {
  const map = classes ?? documentNodeClasses(doc, refs);
  const parts: string[] = [];
  // Named through the same key as every other tier, so a reusable block's custom CSS is anchored
  // to the class its markup carries. Scoped by the ref it belongs to for the document's nodes as
  // much as the library's: an unscoped spelling here would re-open the collision the scoped key
  // exists to close, on this tier alone, and the symptom would be one block's custom CSS silently
  // styling another.
  const collect = (n: BlockNode, refScope?: string): void => {
    if (!n.customCss) return;
    const key =
      refScope === undefined || refScope === ""
        ? documentKey(n.id)
        : refScopedKey(refScope, n.id);
    const scoped = sanitizeBlockCss(
      n.customCss,
      map.get(key) ?? nodeClassName(key),
      scope
    );
    // `.css`, not the result: the object is always truthy, so testing it
    // would push an empty string for every block that has none.
    if (scoped.css) parts.push(scoped.css);
  };
  walk(doc.root, n => collect(n));
  for (const refId of placedRefIds(doc, refs)) {
    const target = refs?.[refId];
    if (target) walk(target, n => collect(n, refId));
  }
  return parts.join("\n");
}
