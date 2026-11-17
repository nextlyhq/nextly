/**
 * The inspector while a look is edited on its own, from the Design panel's
 * Block looks group, with no block selected: the look's name, a bar that says
 * who an edit reaches and how to go back, and the Style controls bound to the
 * look.
 *
 * The bar carries the same State switch a block's Style tab has (Normal,
 * Hover, Focus, Pressed) and names the device the top bar edits, so a look's
 * hover and other states, at each device, are set where its normal values
 * are. The choice is the look editor's own, held per look: no block is
 * selected while a look is edited, so the host's choice, which is what the
 * selected block shows on the canvas, stays Normal.
 *
 * The controls are the Style tab's own, read and written as a shared style
 * is. They are drawn over a stand-in editor holding one block of the look's
 * type, so they offer what that block type supports; it takes no page edit,
 * so nothing the controls do can reach the page except through the look.
 *
 * A look has no element of its own on the canvas, so its sides and corners
 * are named in the site's own direction, read from the canvas root: the same
 * Top, Right, Bottom, Left box a block of that site shows, mirrored on a
 * right-to-left site.
 *
 * @module look-inspector
 * @experimental Settles with the Design panel's Block looks group.
 */

import {
  BASE_BREAKPOINT,
  type BlockDocument,
  type BlockNode,
  type BreakpointId,
  type BreakpointSet,
  type NamedClass,
  type StyleState,
} from "@nextlyhq/blocks-engine";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import {
  lookReachWords,
  type BlockLookRow,
  type LookKey,
} from "./block-look-rows";
import { useSiteOrientation } from "./canvas/use-canvas-reading";
import { stateLookLine } from "./editing-bar";
import type { EditorState } from "./editor-state";
import { lookReach, markLookReach } from "./look-reach";
import { blockLabel } from "./panels/add/inserter";
import { deviceLabel } from "./shell/breakpoint-switcher";
import { StyleStateField } from "./state-switcher";
import {
  StyleInspectorPanel,
  type StyleInspectorPanelProps,
} from "./style-inspector-panel";
import { breakpointLabel } from "./style-provenance-indicators";
import { useLookTarget, type SharedStylesHost } from "./style-target";

/** What the host lends the inspector while a look is edited on its own. */
export interface LookEditing {
  /** The look being edited, by its id and block type. */
  readonly look: LookKey;
  /** Leave look editing, back to editing blocks. */
  readonly onExit: () => void;
}

export interface LookInspectorProps
  extends Omit<
    StyleInspectorPanelProps,
    "editor" | "target" | "sideOrientation" | "state"
  > {
  readonly editor: EditorState;
  readonly look: BlockLookRow;
  readonly host: SharedStylesHost | undefined;
  readonly onExit: () => void;
  /** The site's class library, which decides the look each block wears. */
  readonly library: readonly NamedClass[];
  /**
   * The canvas, where the blocks the edit reaches are marked, and whose root
   * says which way the site runs.
   */
  readonly canvasRoot?: HTMLElement | null;
}

/** Why an own look whose id another entry in the library carries is held. */
const SHARED_ID_REASON =
  "Another look or shared style on this site has the same id, so this one can't be edited here. Give one of them its own name in your site's code.";

/** The stand-in block's id, which no document block can share. */
const STAND_IN_ID = "nx-look-stand-in";

/**
 * The editor the controls read: one block of the look's type, selected, and
 * no page edit taken, so a control that would write the block writes nothing.
 */
function standInEditor(editor: EditorState, blockType: string): EditorState {
  const node: BlockNode = {
    id: STAND_IN_ID,
    type: blockType,
    version: 1,
    props: {},
  };
  const document: BlockDocument = { ...editor.document, nodes: [node] };
  return {
    ...editor,
    document,
    selectedId: STAND_IN_ID,
    selection: {
      ...editor.selection,
      ids: [STAND_IN_ID],
      primary: STAND_IN_ID,
    },
    select: () => {},
    apply: () => null,
    applyAll: () => null,
  };
}

/**
 * What an edit to the look changes, under the bar's first line: every block
 * of the type for its own look, which every other look is laid on, and every
 * block of the type using it for any other.
 */
function lookChangeWords(look: BlockLookRow, title: string): string {
  return look.own
    ? `Changes every ${title} on every page. Where another look, a shared style or the block's own values set something, they win.`
    : `Changes every ${title} using ${look.name} on every page`;
}

/**
 * The controls on the tint a block's Style tab draws them on, under the line
 * that names the state while one other than Normal is edited.
 */
function StateTint({
  state,
  children,
}: {
  readonly state: StyleState;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="nx-style-tab__body" data-state={state}>
      {state === "base" ? null : (
        <p className="nx-style-tab__state-line" data-editing-state-line="">
          {stateLookLine(state)}
        </p>
      )}
      {children}
    </div>
  );
}

/** The device an edit lands on, named as the top bar's switcher names it. */
function editedDevice(
  breakpoints: BreakpointSet | undefined,
  breakpoint: BreakpointId | undefined
): string {
  const id = breakpoint ?? BASE_BREAKPOINT;
  return deviceLabel(breakpoints, id) ?? breakpointLabel(breakpoints, id);
}

/**
 * Which state the look editor edits, held per look: a look opened afresh, or
 * another one chosen, starts at Normal.
 */
function useLookState(
  look: LookKey
): readonly [StyleState, (state: StyleState) => void] {
  const key = JSON.stringify([look.blockType, look.id]);
  const [chosen, setChosen] = React.useState<{
    readonly key: string;
    readonly state: StyleState;
  }>({ key, state: "base" });
  const choose = React.useCallback(
    (state: StyleState) => setChosen({ key, state }),
    [key]
  );
  return [chosen.key === key ? chosen.state : "base", choose];
}

/**
 * Where the look's edit lands: the device the top bar edits, and the State
 * switch, its dots read from the look's own styles, so a state is marked
 * where the look sets something.
 */
function LookPlace({
  state,
  onState,
  styles,
  breakpoints,
  breakpoint,
}: {
  readonly state: StyleState;
  readonly onState: (state: StyleState) => void;
  readonly styles: BlockLookRow["styles"] | undefined;
  readonly breakpoints: BreakpointSet | undefined;
  readonly breakpoint: BreakpointId | undefined;
}): React.JSX.Element {
  return (
    <p className="nx-look-bar__place">
      <span className="nx-look-bar__device">
        {editedDevice(breakpoints, breakpoint)}
      </span>
      <StyleStateField
        state={state}
        onSelect={onState}
        node={styles === undefined ? null : { styles }}
        breakpoints={breakpoints}
      />
    </p>
  );
}

export function LookInspector({
  editor,
  look,
  host,
  onExit,
  library,
  canvasRoot,
  ...style
}: LookInspectorProps): React.JSX.Element {
  const read = useLookTarget(look, host);
  const [state, setState] = useLookState(look);
  // An own look whose id another look or shared style carries is held: a
  // write by id would reach both, so the bar says why and nothing is written.
  const target =
    read !== undefined && read.kind === "shared" && look.sharedId
      ? { ...read, readOnly: SHARED_ID_REASON }
      : read;
  // The blocks on this page the edit reaches, marked while the look is edited.
  // Over the page as the canvas draws it, components composed in, so a block
  // a placement draws is marked too. Keyed as JSON, which spells any id.
  const reachKey = JSON.stringify([
    ...lookReach(editor.composed() ?? editor.document, library, look),
  ]);
  React.useEffect(() => {
    if (canvasRoot === null || canvasRoot === undefined) return;
    markLookReach(canvasRoot, new Set(JSON.parse(reachKey) as string[]));
    return () => markLookReach(canvasRoot, null);
  }, [canvasRoot, reachKey]);
  const stand = React.useMemo(
    () => standInEditor(editor, look.blockType),
    [editor, look.blockType]
  );
  // The site's direction names the look's sides, as a block's box names its
  // own. Re-read on the signals that can restyle the page.
  const sideOrientation = useSiteOrientation(canvasRoot, {
    document: editor.document,
    state,
    breakpoint: style.breakpoint,
    cascade: style.cascade,
    previewContainer: style.previewContainer,
  });
  const title = blockLabel(look.blockType);
  return (
    <div className="nx-inspector nx-look-inspector" data-look={look.id}>
      <div className="nx-look-inspector__head">
        <span className="nx-look-inspector__name">{look.name}</span>
        <span className="nx-look-inspector__kind">
          {`A look for ${title} blocks`}
        </span>
      </div>
      <LookBar
        look={look}
        title={title}
        onExit={onExit}
        readOnly={target?.kind === "shared" ? target.readOnly : undefined}
        place={
          <LookPlace
            state={state}
            onState={setState}
            styles={target?.kind === "shared" ? target.style.styles : undefined}
            breakpoints={style.breakpoints}
            breakpoint={style.breakpoint}
          />
        }
      />
      {target === undefined ? (
        <p className="nx-inspector__note">
          {
            "This look can't be changed here: the site's shared styles aren't available."
          }
        </p>
      ) : (
        <StateTint state={state}>
          <StyleInspectorPanel
            {...style}
            state={state}
            editor={stand}
            target={target}
            sideOrientation={sideOrientation}
          />
        </StateTint>
      )}
    </div>
  );
}

/**
 * The bar above the controls: which look is edited and who the edit reaches,
 * what it changes, and the way back to editing blocks. Esc goes back too.
 */
function LookBar({
  look,
  title,
  onExit,
  readOnly,
  place,
}: {
  readonly look: BlockLookRow;
  readonly title: string;
  readonly onExit: () => void;
  /** Why the look's values can't be changed, when they can't. */
  readonly readOnly: string | undefined;
  /** The device and the State switch the edit lands on. */
  readonly place: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="nx-look-bar"
      role="group"
      aria-label={`Editing ${look.name}`}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onExit();
      }}
    >
      <p className="nx-look-bar__line">
        <span className="nx-look-bar__label">Editing</span>{" "}
        <span className="nx-look-bar__chip">{look.name}</span>{" "}
        <span className="nx-look-bar__reach">
          {`· ${lookReachWords(look, title)}`}
        </span>
      </p>
      <p className="nx-look-bar__note">{lookChangeWords(look, title)}</p>
      {place}
      {/* The controls below are held: the bar says why, as the editing bar
          does for a shared style the block wears. */}
      {readOnly === undefined ? null : (
        <p className="nx-look-bar__held" role="note">
          {readOnly}
        </p>
      )}
      <button type="button" className="nx-look-bar__back" onClick={onExit}>
        <ArrowLeft aria-hidden="true" size={12} />
        Back to block editing
        <kbd className="nx-look-bar__key">Esc</kbd>
      </button>
    </div>
  );
}
