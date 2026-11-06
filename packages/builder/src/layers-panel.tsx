"use client";

/**
 * The layers panel: the page as a tree, and the way to reach a block the canvas
 * cannot show.
 *
 * Decides nothing about the tree itself — `layers.ts` derives it, filters it and
 * says what has to open. This draws what that returns and owns one thing the
 * pure module cannot: which branches are expanded, which is state rather than
 * derivation.
 *
 * **The tree is `@nextlyhq/ui`'s `TreeView`, not one built here.** That
 * component exists for this control and says so: virtualized so a document of a
 * few thousand blocks costs a window rather than a tree, and flat
 * `role="treeitem"` rows carrying `aria-level`/`aria-setsize`/`aria-posinset`
 * because virtualization makes the nested `role="group"` markup impossible to
 * build. It also brings the APG keyboard model and typeahead. Reimplementing
 * any of that here would be a second answer to a question the design system has
 * already answered, and the accessibility half is the half that would rot.
 *
 * ## Three things open a branch, and they are not the same kind of thing
 *
 * The author clicks a twisty; a selection made on the canvas sits inside
 * collapsed containers; a search finds a match that is buried. Treating all
 * three as one derived union looks right and makes an ancestor of the selected
 * block IMPOSSIBLE TO CLOSE — the author collapses it, the next render puts it
 * straight back.
 *
 * So they are split by how long they should last. A selection opens its
 * ancestors ONCE, into the author's own set, and the author may close them
 * again. A search opens its matches' ancestors only while the query stands, so
 * clearing it returns the tree to what the author had open. Only the author's
 * set is stored.
 *
 * ## The panel says how to reorder, because nothing else does
 *
 * The bindings that move a block already work here — the tree holds focus and
 * the editor's own keystrokes act on the selection, so an author standing in
 * this panel can already reorder and nest without touching the canvas. Nothing
 * told them so, and a capability nobody can find reads exactly like a missing
 * one.
 *
 * The hint is DERIVED from the bindings rather than written beside them. A
 * retyped "Alt+Up" is correct until someone rebinds the keystroke, and then it
 * is a label that teaches a key which does nothing — with no test that can
 * fail, because the two are only related by having been typed by the same
 * person on the same day.
 *
 * It is also the tree's accessible description, not merely text near it. A
 * sighted author reads it because it sits under the tree; a screen-reader user
 * hears it on entering the tree, which is the moment the question arises.
 *
 * ## Rows can be dragged, through the same rule as everything else
 *
 * A row dragged by the pointer moves its block, and dragged to the right nests
 * it; `layers-drag` follows the gesture and `layers-drop` decides where it
 * lands and whether the placement rule and the locks allow it. Off while a
 * search filters the list, whose hidden neighbours a drop would land between.
 *
 * ## A row is a handle on its block
 *
 * Pointing at a row outlines its block on the canvas, and choosing one
 * scrolls the canvas to it. A row's eye hides its block on the device being
 * edited, and that device only; its padlock locks it. Both icons are for the
 * pointer, shown while the row is hovered and always while they say
 * something (hidden here, locked); the keyboard reaches the same verbs by F2,
 * the eye's and the lock's chords, and the row's menu, which also carries the
 * block verbs every other surface offers. A row renames in place.
 *
 * @module layers-panel
 */

import {
  allBlocks,
  findNode,
  hiddenOnDevice,
  registryNestingSource,
  type BreakpointSet,
  type ComponentLookup,
  type NestingSource,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  TreeView,
  detectApplePlatform,
  useShortcuts,
  type TreeNode,
} from "@nextlyhq/ui";
import {
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  SlidersHorizontal,
  SquareDashed,
} from "lucide-react";
import * as React from "react";

import { BlockIconMark } from "./block-icon";
import { deviceLabel } from "./breakpoint-switcher";
import { DRAG_SOURCE_ATTRIBUTE } from "./canvas";
import { isElement } from "./dom-kind";
import type { EditorState } from "./editor-state";
import { EDITOR_WORDS } from "./editor-words";
import { useHoveredBlockSetter } from "./hovered-block";
import {
  layersLockChangeable,
  lockOp,
  lockStatusOf,
  lockViewOf,
  renameOp,
} from "./inspector";
import { keyHint } from "./key-hint";
import { MOVE_KEYS, type SharedBlockVerbs } from "./keyboard-actions";
import type { MoveDirection } from "./keyboard-move";
import {
  ROW_KEYS,
  rowKeyAction,
  toggleOnDeviceOp,
  type RowKeyAction,
} from "./layer-row-actions";
import { LayerRowMenu, type RowMenuItem } from "./layer-row-menu";
import {
  ancestorIds,
  filterLayers,
  regionsTo,
  slotRowsIn,
  type SlotRow,
  layerLabel,
  layersOf,
  UNNAMED_COMPONENT,
  type ComponentTitleOf,
  type LayerNode,
} from "./layers";
import {
  type LayersDrag,
  LAYERS_TREE_CLASS,
  LayersDropOverlay,
  useLayersDrag,
} from "./layers-drag";
import { lockRefusalWording } from "./lock-refusal";
import { refusalAnnouncement } from "./move-refusal";
import type { BuilderOp } from "./op-vocabulary";
import { revealNode } from "./reveal-node";

export interface LayersPanelProps {
  /** The editor whose document this shows and whose selection it drives. */
  editor: EditorState;
  /**
   * Whether the block-move keystrokes are bound for THIS editor.
   *
   * Owned by the host, which is the only place that can answer it. This panel
   * is drawn in the shell's panel region while the keystrokes are registered by
   * a component wrapping the shell's children, and those are sibling subtrees —
   * so nothing readable from where this sits describes the bindings beside it.
   * A host with two editors on one page has two answers, and only it knows
   * which belongs to which.
   *
   * Defaults to `false`, so a panel told nothing says nothing: the legend is a
   * claim that pressing something does something, and silence is the safe
   * direction for a claim that cannot be checked from here.
   */
  moveHints?: boolean;
  /**
   * The nesting rules a dragged row is judged by. Defaults to the registry's,
   * which is what the keyboard moves and the canvas default to.
   */
  nesting?: NestingSource;
  /**
   * The component definitions the canvas draws instances from, so a dragged
   * instance is judged by what it draws, as its canvas drop is.
   */
  definitions?: ComponentLookup;
  /**
   * The regions of the page's Layout, shown as read-only rows: a header above
   * the page's blocks, a footer below them.
   *
   * Outside the tree on purpose. They are not the page's blocks, so they take
   * no part in its selection, its drag and drop, its locks or its visibility;
   * each is one button an author reaches by Tab, and activating it shows the
   * region on the canvas.
   */
  regions?: readonly LayersRegionRow[];
  /**
   * A component's title by id, so a placement's row reads as what the author
   * placed, and a search for that title finds it. The library holds the
   * titles, and the host read it.
   */
  componentTitle?: ComponentTitleOf;
  /**
   * The site's breakpoints and the one being edited, which the eye hides a
   * block on. Absent, rows offer no eye: hiding "here" needs a device.
   */
  device?: { breakpoints: BreakpointSet | undefined; id: string };
  /**
   * The canvas, as the frame draws it: its root element or the frame's
   * document. A row chosen here scrolls its block into view there.
   */
  canvasRoot?: HTMLElement | Document | null;
  /**
   * The block verbs the host's verbs provider shares, for the row menu: the
   * same verbs and reasons the toolbar and the canvas menu show. Absent, the
   * menu offers the row's own verbs alone.
   */
  verbs?: SharedBlockVerbs;
  /**
   * Whether the panel sits inside a shortcut provider, so the row keystrokes
   * (F2, the eye's and the lock's chords) register with it and Help lists
   * them. Owned by the host, as `moveHints` is. Without one, the panel reads
   * the keys on its own rows.
   */
  shortcuts?: boolean;
}

/** One region of the page's Layout, as a read-only row in Layers. */
export interface LayersRegionRow {
  readonly area: RegionArea;
  /** The area's name, "Header". */
  readonly name: string;
  /** Where it comes from, "from Layout Main". */
  readonly origin: string;
  /** Show the region on the canvas. */
  readonly onActivate: () => void;
}

/** A region of the page's Layout, as a row that is not one of the page's blocks. */
function RegionRow({ row }: { row: LayersRegionRow }): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-layers-region"
      data-nx-layers-region={row.area}
      // Named whole, so it is announced as one sentence: what it is, where it
      // comes from, and that it cannot be changed here.
      aria-label={`${row.name}, ${row.origin}, locked`}
      onClick={row.onActivate}
    >
      <Lock size={14} aria-hidden="true" />
      <span className="nx-layers-region__name">{row.name}</span>
      <span className="nx-layers-region__origin">{row.origin}</span>
    </button>
  );
}

/** One badge: an icon nobody has to see, and a word every reader gets. */
function Badge({
  icon,
  text,
  lock,
}: {
  icon: React.ReactNode;
  text: string;
  /** For a lock badge: the block's own lock, or one it is held by. */
  lock?: "own" | "inherited";
}): React.JSX.Element {
  return (
    <span
      className="nx-layer-row__badge"
      {...(lock === undefined ? {} : { "data-lock": lock })}
    >
      {/*
        The icon is decorative and the word is the fact. A title attribute would
        reach a pointer and nothing else, and an icon alone announces as an
        image with no name — so the text ships and is clipped visually.
      */}
      <span aria-hidden="true">{icon}</span>
      <span className="nx-sr-only">{text}</span>
    </span>
  );
}

/**
 * What each block type draws, by type.
 *
 * A layer node carries the block's TYPE and nothing about its definition —
 * `layersOf` reads a document, and a document does not hold editor metadata. So
 * the lookup happens here, where the registry is already reachable, rather than
 * by widening what the derivation returns.
 *
 * Read ONCE per mount, for the reason the insert panel gives for reading the
 * registry the same way: it is global mutable state with no change
 * notification, so there is nothing to subscribe to.
 */
function iconsByType(): ReadonlyMap<string, string | undefined> {
  return new Map(
    allBlocks().map(definition => [definition.name, definition.editor?.icon])
  );
}

/**
 * The mark a row draws: a placement's is the component mark whatever its
 * type's own icon, so it reads as a component beside the blocks around it.
 */
function markOf(
  node: LayerNode,
  icons: ReadonlyMap<string, string | undefined>
): string | undefined {
  return node.component ? "component" : icons.get(node.type);
}

/**
 * The word as well as the mark, for a placement its component's title names:
 * the title alone would read as the block's own name. The fallback is already
 * that word, so it is not said twice.
 */
function ComponentTag({ node }: { node: LayerNode }): React.JSX.Element | null {
  if (!node.component || node.label === UNNAMED_COMPONENT) return null;
  return <span className="nx-layer-row__tag">component</span>;
}

/** What a row is drawn with beyond its own layer. */
interface RowView {
  readonly icons: ReadonlyMap<string, string | undefined>;
  readonly draggingId: string | null;
  /** The row being renamed, which draws a field in place of its name. */
  readonly renamingId: string | null;
  /** The device the eye acts on, by name ("Mobile"); absent, no eye. */
  readonly deviceName: string | undefined;
  readonly onRenamed: (id: string, name: string | null) => void;
  readonly onAct: (id: string, action: RowKeyAction) => void;
}

/**
 * The field a row's name becomes while it is renamed.
 *
 * Its keys are its own: the tree reads arrows, Home, End and typed letters
 * for itself, and a field inside a row would otherwise lose every one of
 * them to the tree. Enter keeps the name and Escape keeps the old one; a
 * blur keeps what was typed, as leaving a field does everywhere else.
 */
function RenameField({
  id,
  label,
  name,
  onDone,
}: {
  id: string;
  label: string;
  /** The author's own name, which the field starts from; none, it is empty. */
  name: string | undefined;
  onDone: (name: string | null) => void;
}): React.JSX.Element {
  const field = React.useRef<HTMLInputElement | null>(null);
  const finished = React.useRef(false);
  React.useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  // Nothing changed is nothing to write: an unchanged field, or one left
  // empty on a block that had no name of its own.
  const finish = (typed: string | null): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(typed === null || typed.trim() === (name ?? "") ? null : typed);
  };
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation();
  return (
    <input
      ref={field}
      className="nx-layer-row__rename"
      // The row's hook stays on what stands for the block while it is renamed.
      data-nx-layer={id}
      // The author's own name, as the inspector's rename starts from; the
      // label it falls back to shows as the placeholder, never as a value a
      // blur would store.
      defaultValue={name ?? ""}
      placeholder={label}
      aria-label={`Rename ${label}`}
      // A press inside the field is a caret, not a drag, a selection or the
      // tree's own click.
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      }}
      onBlur={event => finish(event.currentTarget.value)}
    />
  );
}

/**
 * A row's eye or padlock. Pointer-only, so it is out of the Tab order and
 * hidden from assistive technology: the keyboard reaches the same verb by its
 * chord and the row's menu, and the row says hidden and locked in words.
 */
function RowAction({
  id,
  action,
  title,
  pinned,
  onAct,
  children,
}: {
  id: string;
  action: RowKeyAction;
  title: string;
  /** Shown at rest, not only on hover, because it states something true. */
  pinned: boolean;
  onAct: RowView["onAct"];
  children: React.ReactNode;
}): React.JSX.Element {
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation();
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="nx-layer-row__action"
      data-action={action}
      {...(pinned ? { "data-pinned": "" } : {})}
      title={title}
      // Neither a drag nor a selection of the row: the press is the action.
      // Nor a focus: the row keeps it, so its keystrokes still reach it.
      onPointerDown={stop}
      onMouseDown={event => event.preventDefault()}
      onDoubleClick={stop}
      onClick={event => {
        event.stopPropagation();
        onAct(id, action);
      }}
    >
      {children}
    </button>
  );
}

/**
 * A list's region as a row: "Each entry" or "When empty", with how many
 * blocks it holds. It names no block, so it is never dragged or renamed;
 * choosing it selects the list and shows that region on the canvas.
 */
function slotRow(node: LayerNode, row: SlotRow, view: RowView): TreeNode {
  const held = node.children.filter(child => child.slot === row.slot);
  return {
    id: row.rowId,
    textValue: row.label,
    label: (
      <span className="nx-layer-row" data-nx-layer-slot={row.slot}>
        <SquareDashed
          aria-hidden="true"
          size={14}
          className="nx-layer-row__slot-mark"
        />
        <span className="nx-layer-row__label">{row.label}</span>
        <span className="nx-layer-row__count">
          {held.length === 0
            ? "empty"
            : held.length === 1
              ? "1 block"
              : `${String(held.length)} blocks`}
        </span>
      </span>
    ),
    ...(held.length === 0
      ? {}
      : { children: held.map(child => rowOf(child, view)) }),
  };
}

/** A layer as a row: its mark, its name, and what is true about it. */
function rowOf(node: LayerNode, view: RowView): TreeNode {
  if (node.slotRows !== undefined) {
    return {
      id: node.id,
      textValue: node.label,
      label: <LayerRow node={node} view={view} />,
      children: node.slotRows.map(row => slotRow(node, row, view)),
    };
  }
  return {
    id: node.id,
    // `textValue` carries the NAME alone even though the label renders badges
    // beside it. Typeahead matches what an author would type, and a row whose
    // searchable text included "Locked" would be reachable by typing a word
    // that is not its name.
    textValue: node.label,
    label: <LayerRow node={node} view={view} />,
    // Omitted for a block that holds nothing: the tree draws a twisty and an
    // open/closed state for any row given a children list, empty or not, and
    // a twisty that opens onto nothing is a control that does nothing.
    ...(node.children.length === 0
      ? {}
      : {
          children: node.children.map(child => rowOf(child, view)),
        }),
  };
}

/** A row's contents: its mark, its name or the field renaming it, and facts. */
function LayerRow({
  node,
  view,
}: {
  node: LayerNode;
  view: RowView;
}): React.JSX.Element {
  return (
    <span
      className="nx-layer-row"
      {...(node.component ? { "data-component": "" } : {})}
      // Dimmed where the canvas shows nothing of it, with the word beside.
      {...(node.hiddenHere === true || node.hiddenWith !== undefined
        ? { "data-hidden": "" }
        : {})}
      // The block in hand, faded where it sits as the canvas fades its own
      // drag source; the same attribute, so the two read as one gesture.
      {...(node.id === view.draggingId ? { [DRAG_SOURCE_ATTRIBUTE]: "" } : {})}
    >
      <BlockIconMark icon={markOf(node, view.icons)} size={14} />
      {node.id === view.renamingId ? (
        <RenameField
          id={node.id}
          label={node.label}
          name={node.name}
          onDone={name => view.onRenamed(node.id, name)}
        />
      ) : (
        /* `data-nx-layer` names the block a row stands for. Labels repeat —
          every paragraph is "Text" — so it is the one stable way to find a
          given block's row, the Layers counterpart of the canvas's
          `data-nx-node`. */
        <span className="nx-layer-row__label" data-nx-layer={node.id}>
          {node.label}
        </span>
      )}
      <ComponentTag node={node} />
      <RowFacts node={node} />
      <RowActions node={node} view={view} />
    </span>
  );
}

/** What is true about a block, each in words a screen reader reads. */
function RowFacts({ node }: { node: LayerNode }): React.JSX.Element {
  return (
    <>
      {node.hiddenHere === true ? (
        // A word, on screen and read out: hidden on the device shown.
        <span className="nx-layer-row__hidden">Hidden</span>
      ) : node.hiddenWith === undefined ? null : (
        // Hidden because the block around it is, which is where it is shown
        // again: named, as an inherited lock names its block.
        <span className="nx-layer-row__hidden" data-inherited="">
          Hidden with {node.hiddenWith}
        </span>
      )}
      {/* Both locks in the row's own ink, so each reads against the row in
          every state it can be in. A lock held from a block around it is
          quieter by weight, a thinner stroke, never by a fainter colour; both
          say so in words, and the inherited one names the block to unlock. */}
      {node.locked ? (
        // The word, read out; the padlock pinned at the row's end is what
        // the eye sees, at the stronger stroke.
        <span className="nx-sr-only" data-lock="own">
          Locked
        </span>
      ) : node.lockedBy === undefined ? null : (
        <Badge
          icon={<Lock size={12} strokeWidth={1.25} />}
          text={`Locked by ${node.lockedBy}`}
          lock="inherited"
        />
      )}
      {node.breakpointHidden &&
      node.hiddenHere !== true &&
      node.hiddenWith === undefined ? (
        <Badge icon={<EyeOff size={12} />} text="Hidden at some screen sizes" />
      ) : null}
      {node.conditional ? (
        <Badge
          icon={<SlidersHorizontal size={12} />}
          text="Shown conditionally"
        />
      ) : null}
    </>
  );
}

/** The row's eye and padlock, at its right edge. */
function RowActions({
  node,
  view,
}: {
  node: LayerNode;
  view: RowView;
}): React.JSX.Element {
  return (
    <span className="nx-layer-row__actions">
      <RowEye node={node} view={view} />
      <RowPadlock node={node} view={view} />
    </span>
  );
}

/**
 * The row's eye. Not on a block a lock holds, which refuses the change, nor
 * on one hidden with the block around it, which is shown again there.
 */
function RowEye({
  node,
  view,
}: {
  node: LayerNode;
  view: RowView;
}): React.JSX.Element | null {
  const { deviceName } = view;
  const offered =
    deviceName !== undefined &&
    !node.locked &&
    node.lockedBy === undefined &&
    node.hiddenWith === undefined;
  if (!offered) return null;
  const hidden = node.hiddenHere === true;
  return (
    <RowAction
      id={node.id}
      action="toggle-hidden"
      title={`${hidden ? "Show" : "Hide"} on ${deviceName}`}
      pinned={hidden}
      onAct={view.onAct}
    >
      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
    </RowAction>
  );
}

/** The row's padlock: the block's own lock; one held from around it is lifted there. */
function RowPadlock({
  node,
  view,
}: {
  node: LayerNode;
  view: RowView;
}): React.JSX.Element | null {
  if (node.lockedBy !== undefined) return null;
  return (
    <RowAction
      id={node.id}
      action="toggle-lock"
      title={node.locked ? "Unlock" : "Lock"}
      pinned={node.locked}
      onAct={view.onAct}
    >
      {node.locked ? (
        <Lock size={14} strokeWidth={2.5} />
      ) : (
        <LockOpen size={14} />
      )}
    </RowAction>
  );
}

/**
 * The short label each direction gets in the legend.
 *
 * The binding's own `description` is a SENTENCE — "Move the selected block into
 * the container above it" — because it is written to be announced after the
 * move happens, where the subject has to be named. Four of those stacked under
 * a tree is a paragraph rather than a legend, and it reads as prose to be
 * waded through rather than a key to be scanned.
 *
 * So the legend names the DIRECTION, which the binding table already carries as
 * an enum. That keeps this a projection of something the editor decided rather
 * than a second wording of it: total over `MoveDirection`, so a direction added
 * to the move rule fails to compile here instead of silently drawing nothing.
 *
 * One verb across all four, matching the arrow that runs them, so the pairs
 * read as opposites rather than as four unrelated commands.
 */
const DIRECTION_LABEL: Readonly<Record<MoveDirection, string>> = {
  up: "Move up",
  down: "Move down",
  indent: "Move in",
  outdent: "Move out",
};

/**
 * The drag's state as the panel draws it: absent with no drag, "refused"
 * while the place under the pointer refuses the block — which turns the
 * cursor to no-drop, as the canvas does — and empty otherwise.
 */
function draggingState(drag: LayersDrag): string | undefined {
  if (drag.draggingId === null) return undefined;
  return drag.drawn?.result.kind === "refused" ? "refused" : "";
}

/** The block of the row an event happened in, or `null` off the rows. */
function rowIdOf(target: EventTarget | null): string | null {
  // Asked by node kind, so a row in another document still answers.
  if (!isElement(target)) return null;
  const row = target.closest('[role="treeitem"]');
  return (
    row?.querySelector("[data-nx-layer]")?.getAttribute("data-nx-layer") ?? null
  );
}

/**
 * The handlers the element around the tree carries for the rows: the row
 * under the pointer outlines its block on the canvas, the row's verbs by
 * keyboard for the row that has focus (the eye's and the lock's icons are
 * for the pointer alone), and a double-click renames.
 */
function rowBodyHandlers({
  hover,
  apple,
  act,
  keys,
}: {
  hover: (id: string | null) => void;
  apple: boolean;
  act: (id: string, action: RowKeyAction) => void;
  /** Whether to read the row keystrokes here. */
  keys: boolean;
}): Pick<
  React.HTMLAttributes<HTMLDivElement>,
  "onPointerOver" | "onPointerLeave" | "onKeyDown" | "onDoubleClick"
> {
  return {
    onPointerOver: event => hover(rowIdOf(event.target)),
    onPointerLeave: () => hover(null),
    onKeyDown: event => {
      if (!keys) return;
      const action = rowKeyAction(event, apple);
      const id = action === null ? null : rowIdOf(event.target);
      if (action === null || id === null) return;
      event.preventDefault();
      act(id, action);
    },
    onDoubleClick: event => {
      const id = rowIdOf(event.target);
      if (id !== null) act(id, "rename");
    },
  };
}

/** What each row keystroke does, as Help lists it. */
const ROW_KEY_DESCRIPTIONS: Readonly<Record<RowKeyAction, string>> = {
  rename: "Rename the block of the focused Layers row",
  "toggle-hidden":
    "Hide or show the block of the focused Layers row on the device being edited",
  "toggle-lock": "Lock or unlock the block of the focused Layers row",
};

const ROW_KEY_ACTIONS: readonly RowKeyAction[] = [
  "rename",
  "toggle-hidden",
  "toggle-lock",
];

/**
 * The row keystrokes, registered with the editor's shortcut manager so Help
 * lists them with every other binding. Each acts on the row that has focus,
 * and only while one of this panel's rows has it: the same keys elsewhere,
 * or in a rename's field, are left alone.
 */
function RowShortcuts({
  scope,
  act,
}: {
  scope: React.RefObject<HTMLElement | null>;
  act: (id: string, action: RowKeyAction) => void;
}): null {
  const focusedRow = (): string | null => {
    const root = scope.current;
    const active = root?.ownerDocument.activeElement;
    if (
      root === null ||
      root === undefined ||
      active === null ||
      active === undefined ||
      !root.contains(active) ||
      active.getAttribute("role") !== "treeitem"
    ) {
      return null;
    }
    return rowIdOf(active);
  };
  useShortcuts(
    ROW_KEY_ACTIONS.map(action => ({
      keys: ROW_KEYS[action],
      description: ROW_KEY_DESCRIPTIONS[action],
      when: () => focusedRow() !== null,
      run: () => {
        const id = focusedRow();
        if (id !== null) act(id, action);
      },
    })),
    { name: "builder-layers-rows" }
  );
  return null;
}

/**
 * The name of the nearest block around `id` hidden on the device being
 * edited, or `undefined` when none is.
 */
function hiddenAround(
  editor: EditorState,
  id: string,
  device: NonNullable<LayersPanelProps["device"]>
): string | undefined {
  const around = ancestorIds(editor.document, id)
    .map(each => findNode(editor.document.nodes, each))
    .filter(
      (node): node is NonNullable<typeof node> =>
        node !== undefined &&
        hiddenOnDevice(node.visibility, device.breakpoints, device.id)
    );
  const nearest = around[around.length - 1];
  return nearest === undefined ? undefined : layerLabel(nearest);
}

/**
 * A row chosen here scrolls the canvas to its block, on every choice: a row
 * chosen again after the canvas was scrolled away scrolls back, though the
 * selection did not change. A frame later, once the selection has reached
 * the canvas: a hidden block is drawn only once it is selected.
 */
function useRevealChosen(
  canvasRoot: LayersPanelProps["canvasRoot"]
): (id: string) => void {
  const latestCanvas = React.useRef(canvasRoot);
  latestCanvas.current = canvasRoot;
  return React.useCallback((id: string) => {
    requestAnimationFrame(() => {
      const root = latestCanvas.current;
      if (root !== null && root !== undefined) revealNode(root, id);
    });
  }, []);
}

/** The device the eye acts on, by the name the device buttons give it. */
function deviceNameOf(device: LayersPanelProps["device"]): string | undefined {
  if (device === undefined) return undefined;
  return deviceLabel(device.breakpoints, device.id) ?? device.id;
}

/**
 * The move legend's rows, from the binding table, so a rebound keystroke
 * moves the hint with it. A binding this cannot spell is dropped rather than
 * guessed at — see `keyHint` for why a wrong hint is worse than no hint.
 * None until the platform is known, or where the host binds no moves.
 */
function moveHintsFor(
  apple: boolean | null,
  moveHints: boolean
): { keys: string; shown: string; label: string; description: string }[] {
  if (apple === null || !moveHints) return [];
  return MOVE_KEYS.flatMap(({ keys, direction, description }) => {
    const shown = keyHint(keys, apple);
    return shown === null
      ? []
      : [{ keys, shown, label: DIRECTION_LABEL[direction], description }];
  });
}

/** Whether the block is hidden on the device being edited. */
function hiddenHere(
  editor: EditorState,
  id: string,
  device: NonNullable<LayersPanelProps["device"]>
): boolean {
  const node = findNode(editor.document.nodes, id);
  return (
    node !== undefined &&
    hiddenOnDevice(node.visibility, device.breakpoints, device.id)
  );
}

/**
 * Flip a block's visibility on the device being edited, answering what to
 * say, or `null` when nothing changed.
 */
function toggleHidden(
  editor: EditorState,
  id: string,
  device: LayersPanelProps["device"]
): string | null {
  if (device === undefined) return null;
  const wasHidden = hiddenHere(editor, id, device);
  const op = toggleOnDeviceOp(editor.document, id, device);
  if (op === null || editor.apply(op) === null) return null;
  const name = deviceLabel(device.breakpoints, device.id) ?? device.id;
  return wasHidden ? `Shown on ${name}.` : `Hidden on ${name}.`;
}

/** Lock or unlock a block, answering what to say, or `null` when nothing changed. */
function toggleLock(editor: EditorState, id: string): string | null {
  const node = findNode(editor.document.nodes, id);
  if (node === undefined) return null;
  const locking = node.locked !== true;
  if (editor.apply(lockOp(id, locking)) === null) return null;
  return locking ? "Locked." : "Unlocked.";
}

/** Put focus back on a block's row, once a rename has ended. */
function focusRow(scope: HTMLElement | null, id: string): void {
  requestAnimationFrame(() => {
    // This panel's rows only: a second editor on the page holds the same ids.
    const rows = scope?.querySelectorAll<HTMLElement>('[role="treeitem"]');
    const row = Array.from(rows ?? []).find(each => rowIdOf(each) === id);
    row?.focus();
  });
}

/** What the row verbs give the panel. */
interface RowVerbs {
  readonly renamingId: string | null;
  readonly onRenamed: (id: string, name: string | null) => void;
  readonly act: (id: string, action: RowKeyAction) => void;
  /** The row menu's own items, for the row the menu was opened on. */
  readonly menuItems: (id: string | null) => readonly RowMenuItem[];
  /** What the last verb did, or why it was refused. */
  readonly notice: string;
}

/**
 * Rename, the eye and the lock for one row, refused up front in the words
 * every lock refusal uses, so a verb the store would refuse says why instead
 * of doing nothing.
 */
function useRowVerbs(
  editor: EditorState,
  device: LayersPanelProps["device"],
  scope: React.RefObject<HTMLElement | null>
): RowVerbs {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const latest = React.useRef({ editor, device });
  latest.current = { editor, device };

  /** Why the store would refuse `ops`, or `undefined` when it would not. */
  const refusalOf = React.useCallback(
    (ops: readonly BuilderOp[]): string | undefined => {
      const found = latest.current.editor.lockRefusalFor(ops);
      return found === undefined
        ? undefined
        : refusalAnnouncement(lockRefusalWording(found));
    },
    []
  );

  /** Why a verb may not run on `id`, or `undefined` when it may. */
  const reasonFor = React.useCallback(
    (id: string, action: RowKeyAction): string | undefined => {
      const { editor: now, device: on } = latest.current;
      switch (action) {
        case "rename":
          return refusalOf([renameOp(id, "name")]);
        case "toggle-hidden": {
          if (on === undefined) return "";
          // Hidden with a block around it: changing this one shows nothing.
          const around = hiddenAround(now, id, on);
          if (around !== undefined) {
            return `Hidden with ${around}. Show ${around} on this device to show it.`;
          }
          const op = toggleOnDeviceOp(now.document, id, on);
          return op === null ? "" : refusalOf([op]);
        }
        case "toggle-lock": {
          const status = lockStatusOf(now.document, id, lockViewOf(now));
          if (status.inheritedFrom !== undefined && !status.layers) {
            return `This block is inside ${status.inheritedFrom}, which is locked. Unlock ${status.inheritedFrom} to change it.`;
          }
          return layersLockChangeable(status)
            ? undefined
            : "The area it sits in fixes this.";
        }
      }
    },
    [refusalOf]
  );

  const act = React.useCallback(
    (id: string, action: RowKeyAction): void => {
      const reason = reasonFor(id, action);
      if (reason !== undefined) {
        setNotice(reason);
        return;
      }
      setNotice("");
      if (action === "rename") {
        setRenamingId(id);
        return;
      }
      const { editor: now, device: on } = latest.current;
      const said =
        action === "toggle-hidden"
          ? toggleHidden(now, id, on)
          : toggleLock(now, id);
      if (said !== null) setNotice(said);
    },
    [reasonFor]
  );

  const onRenamed = React.useCallback(
    (id: string, name: string | null): void => {
      setRenamingId(null);
      focusRow(scope.current, id);
      if (name === null) return;
      latest.current.editor.apply(renameOp(id, name));
    },
    [scope]
  );

  const menuItems = React.useCallback(
    (id: string | null): readonly RowMenuItem[] => {
      const { editor: now, device: on } = latest.current;
      if (id === null) return [];
      const node = findNode(now.document.nodes, id);
      if (node === undefined) return [];
      const items: RowMenuItem[] = [
        {
          id: "rename",
          label: "Rename",
          reason: reasonFor(id, "rename"),
          keys: ROW_KEYS.rename,
          run: () => act(id, "rename"),
        },
      ];
      if (on !== undefined) {
        const name = deviceLabel(on.breakpoints, on.id) ?? on.id;
        items.push({
          id: "toggle-hidden",
          label: hiddenHere(now, id, on)
            ? `Show on ${name}`
            : `Hide on ${name}`,
          reason: reasonFor(id, "toggle-hidden"),
          keys: ROW_KEYS["toggle-hidden"],
          run: () => act(id, "toggle-hidden"),
        });
      }
      items.push({
        id: "toggle-lock",
        label: node.locked === true ? "Unlock" : "Lock",
        reason: reasonFor(id, "toggle-lock"),
        keys: ROW_KEYS["toggle-lock"],
        run: () => act(id, "toggle-lock"),
      });
      return items;
    },
    [act, reasonFor]
  );

  return { renamingId, onRenamed, act, menuItems, notice };
}

export function LayersPanel({
  editor,
  moveHints = false,
  nesting,
  definitions,
  regions,
  componentTitle,
  device,
  canvasRoot,
  verbs,
  shortcuts = false,
}: LayersPanelProps): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [opened, setOpened] = React.useState<readonly string[]>([]);

  // Memoised on what was supplied, so the drag is not handed a new rule
  // source on every render.
  const rules = React.useMemo(
    () => nesting ?? registryNestingSource(),
    [nesting]
  );
  const drag = useLayersDrag({
    editor,
    nesting: rules,
    ...(definitions === undefined ? {} : { definitions }),
    enabled: query.trim() === "",
    // A collapsed row rested on during a drag opens into the author's own set,
    // as a twisty click would, so it stays open after the drag ends.
    onOpen: id =>
      setOpened(previous =>
        previous.includes(id) ? previous : [...previous, id]
      ),
  });

  // The tree's own element: where a rename's focus returns, and where the
  // row keystrokes are scoped.
  const body = React.useRef<HTMLDivElement | null>(null);
  const rows = useRowVerbs(editor, device, body);
  const setHovered = useHoveredBlockSetter();
  // Nothing stays pointed at once the panel goes, or the canvas would keep
  // outlining a block no row is under.
  React.useEffect(() => () => setHovered(null), [setHovered]);
  // A drag's own marks say where the block will land, so the hover outline
  // goes as the drag starts, though the pointer entered no other row.
  React.useEffect(() => {
    if (drag.draggingId !== null) setHovered(null);
  }, [drag.draggingId, setHovered]);

  const revealChosen = useRevealChosen(canvasRoot);

  // Recomputed each render rather than memoised. The tree is only valid against
  // the document it was read from, and every edit replaces that document — a
  // memo would need the document as its key and would therefore never hit.
  const tree = layersOf(editor.document, componentTitle, device);
  const search = filterLayers(tree, query);
  // The region rows by their own ids, so choosing one is told from choosing
  // a block by what the row is, never by how an id is spelled.
  const regionRows = slotRowsIn(tree);

  /*
   * The document, read at effect time rather than depended on.
   *
   * The effect below must run when the SELECTION moves and not when the
   * document changes. Listing the document as a dependency would re-open the
   * selected block's ancestors after every edit, so a branch the author closed
   * would spring back open the next time they typed in the inspector.
   */
  const documentRef = React.useRef(editor.document);
  documentRef.current = editor.document;

  /*
   * A selection made elsewhere opens its ancestors ONCE.
   *
   * Written into state rather than merged into the expanded set at render.
   * Derived, it could not be undone: the author collapses a branch, the union
   * puts it straight back, and an ancestor of the selected block becomes
   * impossible to close.
   */
  React.useEffect(() => {
    const needed = [
      ...ancestorIds(documentRef.current, editor.selectedId),
      // And each list's region the selection sits in, drawn between them.
      ...regionsTo(documentRef.current, editor.selectedId).map(
        region => region.rowId
      ),
    ];
    if (needed.length === 0) return;
    setOpened(previous => {
      const missing = needed.filter(id => !previous.includes(id));
      // Returning the same array when nothing is missing is what stops this
      // effect re-rendering forever: a new array every run is a new state value.
      return missing.length === 0 ? previous : [...previous, ...missing];
    });
  }, [editor.selectedId]);

  /*
   * Search reveals TEMPORARILY, so its branches are unioned at render and never
   * stored. Clearing the query returns the tree to what the author had open,
   * which is what makes searching feel like looking rather than like editing.
   */
  const expandedIds = React.useMemo(
    () => [...new Set([...opened, ...search.expand])],
    [opened, search.expand]
  );

  const icons = React.useMemo(iconsByType, []);
  const deviceName = deviceNameOf(device);
  const { renamingId, onRenamed, act } = rows;
  const nodes = React.useMemo(
    () =>
      search.roots.map(root =>
        rowOf(root, {
          icons,
          draggingId: drag.draggingId,
          renamingId,
          deviceName,
          onRenamed,
          onAct: act,
        })
      ),
    [
      search.roots,
      icons,
      drag.draggingId,
      renamingId,
      deviceName,
      onRenamed,
      act,
    ]
  );

  /*
   * Which keyboard is in front of the author, resolved AFTER mounting.
   *
   * `detectApplePlatform` reads `navigator`, which a server render does not
   * have — it answers false there, so a server would emit `Alt` and the first
   * browser render `⌥`, and React would find markup it did not produce and
   * throw the subtree away. Held as `null` until it is known, so the legend is
   * absent rather than briefly wrong: this module's whole rule is that a hint
   * naming the wrong key is worse than no hint at all.
   */
  /*
   * Per INSTANCE, not a module constant. A host may mount two editors on one
   * page, and a fixed id would have both trees pointing at the same element —
   * an ambiguous lookup, where assistive technology can read one panel's tree
   * the other panel's description.
   */
  const hintId = React.useId();
  const [apple, setApple] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setApple(detectApplePlatform());
  }, []);

  // Built from the binding table; see `moveHintsFor`.
  const hints = React.useMemo(
    () => moveHintsFor(apple, moveHints),
    [apple, moveHints]
  );

  return (
    <div className="nx-layers-panel">
      <div className="nx-layers-panel__search">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${EDITOR_WORDS.layers.toLowerCase()}`}
          aria-label={`Search ${EDITOR_WORDS.layers.toLowerCase()}`}
        />
      </div>

      {regions
        ?.filter(row => row.area === "header")
        .map(row => (
          <RegionRow key={row.area} row={row} />
        ))}

      {tree.length === 0 ? (
        <p className="nx-layers-panel__note">
          This page has no blocks yet. Open Add in the rail to place one.
        </p>
      ) : nodes.length === 0 ? (
        <p className="nx-layers-panel__note">No blocks match “{query}”.</p>
      ) : (
        <LayerRowMenu
          rowOf={rowIdOf}
          selectedIds={editor.selection.ids}
          select={id => editor.select(id, "replace")}
          items={rows.menuItems}
          verbs={verbs}
          apple={apple}
          // A touch's long press arms the row drag first; the menu claims it.
          onOpen={drag.cancel}
        >
          <div
            ref={body}
            className="nx-layers-panel__body"
            data-nx-dragging={draggingState(drag)}
            {...drag.handlers}
            {...rowBodyHandlers({
              hover: id =>
                // Not during a drag, whose own marks say where it will land.
                setHovered(drag.draggingId === null ? id : null),
              apple: apple ?? false,
              act,
              // Read by the shortcut manager instead where the host has one.
              keys: !shortcuts,
            })}
          >
            <TreeView
              className={LAYERS_TREE_CLASS}
              aria-label={EDITOR_WORDS.layers}
              nodes={nodes}
              selectedId={editor.selectedId}
              // The panel shows what the canvas shows. Passing only the primary
              // would leave two surfaces disagreeing about what is selected, on a
              // screen where a delete acts on all of it.
              selectedIds={editor.selection.ids}
              // The tree's three gestures ARE the editor's three gestures: it
              // reports which one a row's modifiers meant and the store's own rules
              // decide what that does. A panel translating them itself would be a
              // second grammar to keep in step.
              onSelectedChange={(id, mode) => {
                // A list's region names no block: choosing it selects the
                // list, and shows that region on the canvas.
                const region = regionRows.get(id);
                if (region !== undefined) {
                  editor.select(region.parentId, "replace");
                  editor.showListEmpty?.(
                    region.parentId,
                    region.slot === "empty"
                  );
                  revealChosen(region.parentId);
                  return;
                }
                // A block inside a list's region is drawn only while the
                // list shows that region: each list above it is switched to
                // the region it sits in first, so revealing finds it.
                for (const around of regionsTo(editor.document, id)) {
                  editor.showListEmpty?.(
                    around.parentId,
                    around.slot === "empty"
                  );
                }
                editor.select(id, mode);
                revealChosen(id);
              }}
              expandedIds={expandedIds}
              // The tree reports the whole next set, which during a search includes
              // branches only the search opened. Those are dropped before storing,
              // so clearing the query collapses them again instead of baking a
              // temporary reveal into what the author has open.
              onExpandedChange={next =>
                setOpened(next.filter(id => !search.expand.includes(id)))
              }
              // The hint is the tree's DESCRIPTION, so it is announced on entering
              // the tree rather than only readable by someone who can see it below.
              aria-describedby={hints.length === 0 ? undefined : hintId}
            />
            <LayersDropOverlay drawn={drag.drawn} />
          </div>
        </LayerRowMenu>
      )}

      {regions
        ?.filter(row => row.area === "footer")
        .map(row => (
          <RegionRow key={row.area} row={row} />
        ))}

      {/*
        Why a drop under the pointer is refused, or what a row verb did, spoken. Present from the first
        render, since a region that appears with its first message is often not
        announced at all. A `div` rather than the editor's `p` region, which is
        the keyboard moves' own and sits elsewhere in the editor.
      */}
      <div role="status" aria-live="polite" className="nx-sr-only">
        {drag.announcement === "" ? rows.notice : drag.announcement}
      </div>

      {shortcuts ? <RowShortcuts scope={body} act={act} /> : null}

      {/*
        What a row's verb did, or why it could not, on screen: a refused eye or
        rename otherwise changes nothing visible. Read out by the panel's one
        live region above, so it is not announced twice.
      */}
      <p aria-hidden="true" className="nx-layers-panel__notice">
        {rows.notice}
      </p>

      {/*
        Outside the empty and no-match branches deliberately: the bindings are
        what an author reaches for once there ARE layers to move, and a page
        with none has nothing to say this about.
      */}
      {tree.length === 0 || nodes.length === 0 || hints.length === 0 ? null : (
        <ul className="nx-layers-panel__hint" id={hintId}>
          {hints.map(({ keys, shown, label, description }) => (
            <li className="nx-layers-panel__hint-row" key={keys}>
              <span className="nx-layers-panel__hint-key" aria-hidden="true">
                {shown}
              </span>
              {/*
                The short label is what is DRAWN; the binding's own sentence is
                what is read out, because a description announced without its
                subject — "Move in" — says less than the sentence the shortcut
                manager already carries for exactly this.
              */}
              <span className="nx-layers-panel__hint-label" aria-hidden="true">
                {label}
              </span>
              <span className="nx-sr-only">
                {shown}: {description}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
