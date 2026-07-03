/**
 * Core contracts for the page builder — isomorphic and runtime-React-free.
 *
 * Only *type-only* imports of React / Nextly are allowed here (they are erased at
 * build, so the `.` bundle has no React/Nextly runtime dependency). The registry
 * stores block-definition objects (including their `render` functions) but core
 * never calls React itself.
 */
import type { ReactNode } from "react";

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
  /** Named child regions. "default" is the primary slot; only container blocks have slots. */
  slots?: Record<string, BlockNode[]>;
  /** Typed data bindings, keyed by the prop they fill. Kept separate from `props` (spec §10). */
  bindings?: Record<string, Binding>;
  /** Author escape hatch. */
  customClass?: string;
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

export type BlockCategory = "basic" | "layout" | "media" | "dynamic";

export interface SlotSpec {
  name: string;
  /** Namespaced block types allowed in this slot. Omit for "any". */
  allowedBlocks?: string[];
}

/** A reference from a block definition to a style control + the style key it edits. */
export interface ControlRef {
  /** Control type registered in the control registry, e.g. "spacing" | "color" | "dimension". */
  control: string;
  /** Style key this control writes (e.g. "padding", "backgroundColor"). */
  styleKey: string;
  label: string;
}

export interface BlockRenderArgs<P = Record<string, unknown>> {
  props: P;
  node: BlockNode;
  slots: Record<string, ReactNode>;
  /** The scoped class the block MUST apply to its own root element (no wrapper div). */
  className: string;
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
