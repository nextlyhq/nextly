/**
 * The inspector while a look is edited on its own, from the Design panel's
 * Block looks group, with no block selected: the look's name, a bar that says
 * who an edit reaches and how to go back, and the Style controls bound to the
 * look.
 *
 * The controls are the Style tab's own, read and written as a shared style
 * is. They are drawn over a stand-in editor holding one block of the look's
 * type, so they offer what that block type supports; it takes no page edit,
 * so nothing the controls do can reach the page except through the look.
 *
 * @module look-inspector
 * @experimental Settles with the Design panel's Block looks group.
 */

import type {
  BlockDocument,
  BlockNode,
  NamedClass,
} from "@nextlyhq/blocks-engine";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import {
  lookReachWords,
  type BlockLookRow,
  type LookKey,
} from "./block-look-rows";
import type { EditorState } from "./editor-state";
import { blockLabel } from "./inserter";
import { lookReach, markLookReach } from "./look-reach";
import {
  StyleInspectorPanel,
  type StyleInspectorPanelProps,
} from "./style-inspector-panel";
import { useLookTarget, type SharedStylesHost } from "./style-target";

/** What the host lends the inspector while a look is edited on its own. */
export interface LookEditing {
  /** The look being edited, by its id and block type. */
  readonly look: LookKey;
  /** Leave look editing, back to editing blocks. */
  readonly onExit: () => void;
}

export interface LookInspectorProps
  extends Omit<StyleInspectorPanelProps, "editor" | "target"> {
  readonly editor: EditorState;
  readonly look: BlockLookRow;
  readonly host: SharedStylesHost | undefined;
  readonly onExit: () => void;
  /** The site's class library, which decides the look each block wears. */
  readonly library: readonly NamedClass[];
  /** The canvas, where the blocks the edit reaches are marked. */
  readonly canvasRoot?: HTMLElement | null;
}

/** Why a look whose id another block type's own look shares is held. */
const SHARED_ID_REASON =
  "Another block type's own look has the same id, so this one can't be edited here. Give one of them its own name in your site's code.";

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

/** What an edit to the look changes, under the bar's first line. */
function lookChangeWords(look: BlockLookRow, title: string): string {
  return look.own
    ? `Changes every ${title} on every page. Where another look, a shared style or the block's own values set something, they win.`
    : `Changes ${look.name} on every page that uses it. A shared style and a block's own values still win.`;
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
  // A look whose id another block type's own look shares is held: a write
  // by id would reach both, so the bar says why and nothing is written.
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
      />
      {target === undefined ? (
        <p className="nx-inspector__note">
          {
            "This look can't be changed here: the site's shared styles aren't available."
          }
        </p>
      ) : (
        <StyleInspectorPanel {...style} editor={stand} target={target} />
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
}: {
  readonly look: BlockLookRow;
  readonly title: string;
  readonly onExit: () => void;
  /** Why the look's values can't be changed, when they can't. */
  readonly readOnly: string | undefined;
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
