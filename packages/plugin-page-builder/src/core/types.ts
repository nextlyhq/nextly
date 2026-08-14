/**
 * Core contracts for the page builder — isomorphic and runtime-React-free.
 *
 * Only *type-only* imports of React / Nextly are allowed here (they are erased at
 * build, so the `.` bundle has no React/Nextly runtime dependency). The registry
 * stores block-definition objects (including their `render` functions) but core
 * never calls React itself.
 */
import type { ReactNode } from "react";

import type { MotionConfig } from "./motion";
import type { BlockSupports } from "./supports";
import type { RemotePatternInput } from "./url-policy";

// ---------------------------------------------------------------------------
// Document + node model (spec §6)
// ---------------------------------------------------------------------------

/** Document-format version. Bumped only for envelope-shape changes (migrations). */
export type DocumentVersion = 1;

/** Reserved doors (spec §13): templates/parts and i18n are designed-for, not built. */
export type BlockDocumentKind = "page" | "template" | "part";

export interface BlockDocument {
  version: DocumentVersion;
  /** Reserved — defaults to "page". Enables Theme-Builder-style templates later. */
  kind?: BlockDocumentKind;
  /** Reserved (i18n) — the locale this document's content is authored in. */
  locale?: string;
  /** Reserved (i18n) — links documents that are translations of one another. */
  translationGroup?: string;
  root: BlockNode;
  /** Reserved — page-level settings (SEO, etc.). */
  settings?: { seo?: Record<string, unknown> };
  /** Reserved — a usage index so media/relationship refs are trackable without a full walk. */
  assets?: { mediaIds?: string[] };
}

export interface BlockNode {
  /** Stable unique id (crypto.randomUUID). Stable across locales; drives the scoped CSS class. */
  id: string;
  /** Namespaced block type, e.g. "core/heading". */
  type: string;
  /** Schema version of the block instance; compared to the definition's `version` for migrations. */
  definitionVersion?: number;
  /** Content/config values. Literal values only — bound values live in `bindings`. */
  props: Record<string, unknown>;
  /** Typed, responsive style overrides (spec §8). */
  style?: ResponsiveStyle;
  /** Responsive style overrides applied on `:hover` (spec §8, hover states). */
  styleHover?: ResponsiveStyle;
  /** Named child regions. "default" is the primary slot; only container blocks have slots. */
  slots?: Record<string, BlockNode[]>;
  /** Typed data bindings, keyed by the prop they fill. Kept separate from `props` (spec §10). */
  bindings?: Record<string, Binding>;
  /** Author escape hatch. */
  customClass?: string;
  /** Per-block raw custom CSS; `selector` is rewritten to this node's scoped class. */
  customCss?: string;
  /** Per-breakpoint visibility; `false` hides at that breakpoint. Base = default. */
  visibility?: Partial<Record<Breakpoint, boolean>>;
  /** Author-facing instance label (navigator). */
  name?: string;
  /** Author lock: block cannot be moved/deleted while true. */
  locked?: boolean;
  /** CSS id applied to the block root. */
  cssId?: string;
  /** Sanitized custom HTML attributes applied to the block root. */
  attributes?: Record<string, string>;
  /** Entrance motion (spec §5). */
  motion?: MotionConfig;
}

// ---------------------------------------------------------------------------
// Styling (spec §8) — typed; never arbitrary strings compiled straight to CSS
// ---------------------------------------------------------------------------

export type Breakpoint = string; // project-configurable id, e.g. "base" | "tablet" | "mobile"

export interface BoxSides {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

/** A style value may be a literal or a design-token reference (spec §8). */
export type TokenRef = { token: string };
export type StyleScalar = string | TokenRef;

/**
 * The values a keyword style key accepts, as DATA the inspector's option lists are built from.
 *
 * A hand-written option list beside a hand-written union drifts, and the drift is one-way: the
 * editor offers a value the exported types reject, so a document the editor produced cannot be
 * represented by a block author or a consumer without a cast. Deriving both from one list makes
 * that unrepresentable rather than tested for.
 */
export const OBJECT_FIT_VALUES = [
  "fill",
  "contain",
  "cover",
  "none",
  "scale-down",
] as const;
export const OVERFLOW_VALUES = [
  "visible",
  "hidden",
  "clip",
  "auto",
  "scroll",
] as const;
export type ObjectFit = (typeof OBJECT_FIT_VALUES)[number];
export type Overflow = (typeof OVERFLOW_VALUES)[number];

export interface StyleValues {
  margin?: BoxSides;
  padding?: BoxSides;
  backgroundColor?: StyleScalar;
  backgroundImage?: StyleScalar;
  color?: StyleScalar;
  fontSize?: StyleScalar;
  lineHeight?: StyleScalar;
  textAlign?: "left" | "center" | "right" | "justify";
  width?: StyleScalar;
  maxWidth?: StyleScalar;
  height?: StyleScalar;
  borderRadius?: StyleScalar;
  display?: string;
  gridTemplateColumns?: StyleScalar;
  gap?: StyleScalar;
  justifyContent?: string;
  alignItems?: string;
  // Typography (extended)
  fontFamily?: StyleScalar;
  fontWeight?: StyleScalar;
  letterSpacing?: StyleScalar;
  wordSpacing?: StyleScalar;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  fontStyle?: "normal" | "italic";
  textDecoration?: string;
  textShadow?: string;
  // Dimensions (extended)
  minHeight?: StyleScalar;
  objectFit?: ObjectFit;
  overflow?: Overflow;
  aspectRatio?: StyleScalar;
  // Border (structured; borderRadius already above)
  border?: { width?: BoxSides; style?: string; color?: StyleScalar };
  // Effects
  boxShadow?: string; // built by BoxShadowControl, validated by css-tree
  backgroundGradient?: string; // emitted as background-image
  opacity?: StyleScalar;
  filters?: string; // css `filter` value
  mixBlendMode?: string;
  transform?: string;
  transition?: string;
  // Background image (structured)
  backgroundImageObj?: {
    url?: StyleScalar;
    position?: string;
    size?: string;
    repeat?: string;
    attachment?: string;
  };
  // Position
  position?: {
    type?: "static" | "relative" | "absolute" | "fixed" | "sticky";
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
    zIndex?: string;
  };
  // Width alignment (Gutenberg none / wide / full)
  widthAlign?: "none" | "wide" | "full";
  // Descendant link colors → compiled to `.cls a` / `.cls a:hover`
  linkColor?: StyleScalar;
  linkColorHover?: StyleScalar;
}

/** Per-breakpoint style overrides. The base breakpoint holds defaults; others override. */
export type ResponsiveStyle = Partial<Record<Breakpoint, StyleValues>>;

// ---------------------------------------------------------------------------
// Data binding (spec §10) — typed, schema-driven, access-controlled
// ---------------------------------------------------------------------------

export interface Binding {
  source: "field";
  /** Dot-path into the current Query Loop item, e.g. "title" or "author.name". */
  path: string;
  /** Optional display transform, e.g. "date:MMM d, yyyy". */
  transform?: string;
}

// ---------------------------------------------------------------------------
// Block definition + control contracts (spec §7) — the extensibility core
// ---------------------------------------------------------------------------

export type BlockCategory =
  | "basic"
  | "layout"
  | "media"
  | "dynamic"
  | "content"
  | "utility";

export interface SlotSpec {
  name: string;
  /** Namespaced block types allowed in this slot. Omit for "any". */
  allowedBlocks?: string[];
  /**
   * How this slot arranges its children, when that constrains what may sit between them.
   *
   * `"flow"` (the default) is normal block flow, where an extra zero-height element between two
   * children costs nothing. `"formatted"` is a flex or grid container, where any element between
   * two children becomes a flex item or a grid cell of its own — so it takes a gap, shifts every
   * following cell, and the canvas no longer matches the published page.
   *
   * Declared rather than inferred because only the block knows: the layout lives in the style its
   * `render` applies, which nothing outside it can read.
   */
  childLayout?: "flow" | "formatted";
}

/** A reference from a block definition to a style control + the style key it edits. */
export interface ControlRef {
  /** Control type registered in the control registry, e.g. "spacing" | "color" | "dimension". */
  control: string;
  /** Style key this control writes (e.g. "padding", "backgroundColor"). */
  styleKey: string;
  label: string;
  /** Choices for `select`-type style controls (typography weight/transform/etc.). */
  options?: { value: string; label: string }[];
}

export interface BlockRenderArgs<P = Record<string, unknown>> {
  props: P;
  node: BlockNode;
  slots: Record<string, ReactNode>;
  /** The scoped class the block MUST apply to its own root element (no wrapper div). */
  className: string;
  /**
   * The hosts this page may load media from, as `PageRenderer` was given them.
   *
   * A block that renders a media URL into an `src` or an inline background is
   * making a request the style compiler never sees, so the same policy has to
   * reach here. The renderer cannot inspect the element a block returns, so a
   * block applies it: pass this to `mediaUrl` for an attribute, or
   * `cssMediaUrl` for a value interpolated into a CSS `url("…")`. Both are
   * exported from `@nextlyhq/plugin-page-builder`, so a block registered from
   * outside this package can reach them.
   *
   * Absent means relative paths only, which is what an unconfigured page gets.
   */
  remotePatterns?: readonly RemotePatternInput[];
}

export interface BlockDefinition<P = Record<string, unknown>> {
  /** Namespaced type, e.g. "core/heading". */
  type: string;
  /** Schema version; drives per-block migrations. */
  version: number;
  label: string;
  icon: string;
  category: BlockCategory;
  isContainer?: boolean;
  /**
   * The only types this block may be a DIRECT child of. Omit for "anywhere".
   *
   * The child's half of the nesting rule, and not derivable from the parent's `allowedBlocks`:
   * a slot naming a type must not confine that type to it, and a block meaningless outside one
   * parent has to say so itself. Named after the same field in Gutenberg's block metadata.
   *
   * A core block states this on its {@link BlockStructure} and it arrives here by the spread, so
   * the structure and the definition cannot disagree. A plugin block states it here.
   */
  parent?: string[];
  /** Declarative style capabilities → inspector controls + compiled CSS (spec §4.1). */
  supports?: BlockSupports;
  slots?: SlotSpec[];
  /**
   * Content fields — reuse Nextly's field system so the inspector "Content" tab and
   * dynamic-data binding are driven by one schema. Typed loosely here to avoid coupling
   * core's compile to Nextly's full type surface; the admin narrows it to `FieldConfig[]`.
   */
  contentFields?: unknown[];
  /** Style/visual controls (page-builder control registry) driving the Style/Responsive tabs. */
  styleControls?: ControlRef[];
  defaultProps: P;
  defaultStyle?: ResponsiveStyle;
  /** Prop keys that are translatable (i18n door; metadata only for MVP). */
  localized?: string[];
  /** Server-safe by default; may be a client component when interactive. */
  render: (args: BlockRenderArgs<P>) => ReactNode;
  /** Pure JSON→JSON upgrade for instances older than `version`. */
  migrate?: (
    old: unknown,
    fromVersion: number
  ) => { props: P; style?: ResponsiveStyle };
  /** Extra per-instance validation beyond the core invariants. */
  validate?: (node: BlockNode) => true | string;
}

export interface ControlDef {
  /** Control type key, e.g. "spacing" | "color" | "dimension" | "align" | "media" | "link". */
  type: string;
  /** The React control component (registered from the admin entry). Opaque to core. */
  Component: unknown;
}

// ---------------------------------------------------------------------------
// Limits (spec §14)
// ---------------------------------------------------------------------------

export const MAX_DEPTH = 12;
export const MAX_NODES = 5000;
export const DEFAULT_SLOT = "default";
