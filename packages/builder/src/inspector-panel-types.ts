/**
 * What the inspector takes from its host: the style state it edits, the
 * resolver for a block's own inspector, the panel's props, and the component
 * library it judges an instance under.
 *
 * @module inspector-panel-types
 */

import type {
  BlockInspectorProps,
  BreakpointId,
  BreakpointSet,
  ComponentLookup,
  ComponentPath,
  SiteTokenSet,
  StyleState,
} from "@nextlyhq/blocks-engine";
import type { BlockResolver, PageStyleCascade } from "@nextlyhq/blocks-react";
import * as React from "react";

import type { CardVerbs } from "./block-card";
import type { CanvasPassage } from "./canvas/canvas-passage";
import type { ComponentFieldsHost } from "./component-fields";
import type { ComponentVariantsHost } from "./component-variants";
import type { ContentServices } from "./content-controls";
import type { BlockCustomCssAccess } from "./custom-css";
import type { EditorState } from "./editor-state";
import type { BreakpointsStatus } from "./hide-on";
import type { LookEditing } from "./look-inspector";
import type { SavedComponent } from "./panels/add/inserter";
import type { StyleInspectorPanelProps } from "./style-inspector-panel";
import type { SharedStylesHost, StyleTargetBarProps } from "./style-target";
import type { StylePolicy } from "./style-values";

export interface StyleStateBinding {
  /** The state being edited. `base` when omitted. */
  state?: StyleState | undefined;
  /** Choose a different one. Omitted withholds the control. */
  onChange?: ((state: StyleState) => void) | undefined;
}

/**
 * Resolves a block's own inspector (`editor.component`) to the component the
 * host loaded for it, or `undefined` when it loaded none.
 *
 * Supplied by the host, because this package reaches no component registry:
 * the components a site's plugins contribute are loaded by the app, and only
 * the app knows which arrived.
 *
 * @experimental The custom inspector contract will grow with the controls
 *   registry.
 */
export type BlockInspectorResolver = (
  path: ComponentPath
) => React.ComponentType<BlockInspectorProps> | undefined;

export interface InspectorPanelProps {
  /**
   * The component placement's exposed passage the canvas is editing in place,
   * whose field the inspector holds meanwhile; `null` or omitted while the
   * canvas edits none.
   */
  canvasPassage?: CanvasPassage | null;
  /**
   * The canvas root, forwarded to the style tab.
   *
   * Declared here only to CARRY it: this panel has no opinion about the canvas,
   * and what the style tab does with it lives on
   * {@link StyleInspectorPanelProps.canvasRoot}. Forwarded rather than left out
   * for the reason the class library is: a prop the chain drops is invisible —
   * the surface renders in isolation, its tests pass, and every real selection
   * in the shipped editor silently loses the answer.
   */
  canvasRoot?: HTMLElement | null;
  /**
   * The site's class library, forwarded to the style tab's class selector.
   *
   * Declared here only to CARRY it: this panel has no opinion about classes,
   * and the meaning of each — including why an absent library is a read in
   * flight rather than a host opting out — lives on
   * {@link StyleTargetBarProps.library}.
   *
   * Forwarded rather than left out because a prop the chain drops is invisible:
   * the surface renders in isolation, its tests pass, and every real selection
   * in the shipped editor shows nothing.
   */
  classLibrary?: StyleTargetBarProps["library"];
  /** Why the library is absent, when it is. Carried, not interpreted. */
  classLibraryAbsence?: StyleTargetBarProps["libraryAbsence"];
  /**
   * What the host lends for shared styles: the author's right, the write that
   * stores a style, and the reads of its reach. Without it a block's shared
   * styles are listed but cannot become the target.
   *
   * @experimental Settles with the shared-styles editor.
   */
  sharedStyles?: SharedStylesHost;
  /**
   * A look edited on its own, chosen in the Design panel: while no block is
   * selected the inspector edits it instead of saying to select a block.
   *
   * @experimental Settles with the Design panel's Block looks group.
   */
  lookEditing?: LookEditing;
  /**
   * The site's fonts, carried to the Style tab's Font control. See
   * {@link StyleInspectorPanelProps.fonts}.
   */
  fonts?: StyleInspectorPanelProps["fonts"];
  /**
   * Opens the Design panel's Block styles at a block type, from the Style
   * tab's "Edit block styles". Absent, the Block style section offers no way
   * there.
   *
   * @experimental Settles with the Design panel's Block styles.
   */
  onEditBlockStyles?: (blockType: string) => void;
  /**
   * A block's own custom CSS, given only where the person may change the
   * site's settings, the permission site code is held to: Advanced then ends
   * with a Custom CSS section, checked by `check` before anything is stored.
   * Absent, there is no such section, the Style tab only says a block has
   * custom CSS, and the CSS itself is never shown.
   *
   * @experimental Settles with custom CSS.
   */
  customCss?: BlockCustomCssAccess;
  /**
   * The editor whose selected block this edits.
   *
   * The whole state rather than a document and an `apply` separately: a patch is
   * built from the node in a particular document, and passing them apart lets a
   * caller hand a node from one render to an `apply` bound to another — which
   * writes a merged props object assembled from a stale node.
   */
  editor: EditorState;
  /**
   * What the site allows, forwarded to the Style tab.
   *
   * Carried rather than defaulted: the engine ships no host list of its own, so
   * omitting it does not mean "allow" — it means the question was never asked.
   */
  policy?: StylePolicy;
  /**
   * The interaction state the Style tab edits, and how to change it.
   *
   * ONE prop rather than a value and a setter beside each other, because they
   * are one decision: this state and `Canvas.forcedState` must be the same
   * value, and a host wiring them separately gets a panel reporting a state its
   * canvas is not showing. Bundled, the pair travels together or not at all.
   *
   * `onChange` absent WITHHOLDS the switcher rather than disabling it. A host
   * that cannot carry the choice to its canvas would otherwise show a control
   * whose selection nothing follows — the arrangement that contract exists to
   * prevent.
   */
  styleState?: StyleStateBinding;
  /** The breakpoint the Style tab edits. The unconditional one by default. */
  breakpoint?: BreakpointId;
  /**
   * The definitions the CANVAS renders against, forwarded to the Advanced tab.
   *
   * A host that gives `Canvas` a `render.blocks` resolver must give the same one
   * here, or the id-collision check answers about a different page than the one
   * on screen. Omitted, both sides fall back to the global registry, which is
   * what `PageRenderer` itself defaults to.
   */
  blocks?: BlockResolver;
  /**
   * The declarations the compiler wrote and the tree they describe, so the Style
   * tab can say where a control's value came from.
   *
   * Forwarded rather than compiled here for the reason the panel states: the
   * cascade is walked ONCE per document, by the host that already holds the
   * breakpoints it must be compiled against. The tree is carried with it so the
   * panel resolves the selected node in the same tree the declarations belong
   * to; see {@link StyleInspectorPanelProps.cascade}.
   */
  cascade?: PageStyleCascade;
  /** The site's breakpoints, which decide which of those declarations are live. */
  breakpoints?: BreakpointSet;
  /**
   * Whether `breakpoints` is the site's own set yet: `loading` while the
   * config's defaults stand in for the stored set being read, `unavailable`
   * when that read failed. "Hide on" writes only once it is `ready`: a
   * hide resolved against the wrong set is stored wrong. Defaults to
   * `ready`, for a host whose breakpoints are known up front.
   */
  breakpointsStatus?: BreakpointsStatus;
  /**
   * The container the canvas compiled its breakpoints against, when it is
   * previewing rather than rendering at the browser's own width.
   *
   * Forwarded for the reason the Style tab states: which declarations are LIVE
   * is a question about the queries the sheet was emitted under, and a panel
   * given only the set compares the window against rules a preview compile
   * never wrote.
   */
  previewContainer?: string;
  /**
   * Which breakpoints the canvas is ACTUALLY applying, forwarded to the Style
   * tab. Needed only while previewing, where the queries are about the preview
   * box and only its owner can observe them.
   */
  liveBreakpoints?: readonly BreakpointId[];
  /**
   * Move the canvas to a breakpoint, forwarded to the Style tab.
   *
   * Only the surface owning the canvas width can do this, and it sits above
   * this panel — so the capability is passed down and each control whose value
   * came from another tier offers to use it.
   */
  onJumpToBreakpoint?: (breakpoint: BreakpointId) => void;
  /**
   * The site's design tokens, forwarded to the Style tab's colour controls.
   *
   * Carried rather than defaulted, as `policy` is: omitting it means the
   * question was never asked, not that the site defines none. See
   * {@link StyleInspectorPanelProps.tokens} for why `policy.tokens` cannot
   * serve this.
   */
  tokens?: SiteTokenSet;
  /**
   * The site's component library, as the host read it: the definitions the
   * CANVAS resolves instances against, and the rows that name them.
   *
   * ONE prop rather than a lookup and a list beside each other, because they
   * are one read: a selected instance's rows are read from the very document
   * the page is drawn from, and its title from the row the same read returned.
   * Handed two props from two reads, a host could title an instance from one
   * library and resolve it against another.
   *
   * Supplied rather than fetched, as every input to this package is. Omitted,
   * an instance is inspected as one whose definition could not be loaded —
   * which is what the canvas draws for it under the same omission — and
   * titled by its component id.
   */
  componentLibrary?: ComponentLibrary;
  /**
   * Resolves a block's own inspector. A block naming one gets it in place of
   * its generated content controls; one this answers `undefined` for keeps the
   * generated controls, so an unloaded component never leaves a block with no
   * way to edit it. Omitted, every block gets the generated controls.
   */
  inspectors?: BlockInspectorResolver;
  /**
   * The block verbs the card's menu offers beside Rename and Lock: the same
   * verbs and verdicts the toolbar uses, handed out of the editor's verbs
   * provider. Omitted, the menu offers Rename and Lock alone.
   */
  verbs?: CardVerbs;
  /**
   * What the host lends the Content tab: the media library and the shared
   * rich-text editor. A control whose service is absent says so.
   *
   * @experimental Grows with the controls registry.
   */
  contentServices?: ContentServices;
  /**
   * What the host knows about the component being edited, when the document
   * is one: the ids it may never mint again, and how many pages place it.
   * Exposing fields is offered for any component document; without this, a
   * new field's id is kept clear of the ids this session has seen only.
   *
   * @experimental Settles when the component editor ships.
   */
  componentFields?: ComponentFieldsHost;
  /**
   * What the host can tell the component's variants section: how many
   * placements chose a variant, for the delete dialog. Omitted, the dialog
   * says the placements fall back without a number.
   *
   * @experimental Settles when the component editor ships.
   */
  componentVariants?: ComponentVariantsHost;
  /**
   * The open document's own settings, drawn while nothing is selected: a
   * page's title and address, or a component's or template's own fields.
   * Handed what the builder draws of the document itself (a component's
   * fields and variants), or null, to place among its own rows. Without it
   * the panel shows only that part, and keeps its width either way.
   *
   * @experimental Settles with the page's settings panel.
   */
  documentSettings?: DocumentSettingsView;
  /**
   * The host's card for the header or footer selected on the canvas: what it
   * is, where it comes from and how to change it. Drawn in place of
   * everything else while no block is selected; absent while no region is.
   *
   * @experimental Settles with editing a header or footer in place.
   */
  regionCard?: React.ReactNode;
  /**
   * The name of the region of the page's layout edited in place, while one
   * is ("Site header"): `editor` is the region's, and the selected block's
   * card says where it is, "Navigation · in Site header".
   *
   * @experimental Settles with editing a header or footer in place.
   */
  editingIn?: string;
}

/** What the host draws of the open document while nothing is selected. */
export type DocumentSettingsView = (
  own: React.ReactNode | null
) => React.ReactNode;

/** What the inspector needs of the host's component read. */
export interface ComponentLibrary {
  /** The definitions the canvas resolves instances against, keyed by id. */
  readonly definitions: ComponentLookup;
  /** The library's rows, the only holder of a definition's title and usage. */
  readonly components: readonly SavedComponent[];
}
