"use client";

/**
 * An Embed's empty state on the canvas: the field an author pastes a link
 * into, where an Embed has none yet.
 *
 * The Embed block draws a box where it has no link, only where an author is
 * looking, in the block's own classes, so the box takes the size the frame
 * would. This draws the editor's part over each box, in the editor's own
 * colours: "Paste a YouTube, Vimeo or other link", a field, and Embed.
 *
 * A pasted link is stored at once, as pasting one is the whole act; a typed
 * one is stored on Enter or Embed. Either way it goes through the editor's one
 * write path as one step to undo (`embedLinkOp`): the link as typed and, for
 * a provider the block knows, the provider's shape as the block's own style
 * values. The box then goes, the Embed draws what it loads, and the
 * inspector's Link setting says what was found.
 *
 * An Embed whose link a lock holds, or one inside a placed component, is not
 * offered the field: its link is set elsewhere.
 *
 * An Embed with a link draws a frame, a document of its own that takes every
 * press made over it, so the canvas would never see a click there, and a
 * poster's play link would start the player inside the editor. Each frame is
 * covered by a see-through plate that takes the press instead and selects
 * the Embed, as a click on any other block does.
 *
 * Drawn like `ImageStates`, in the overlay over the canvas, at each box's
 * measured rectangle (`shownRectOf`), and kept current by `watchCanvasFor`.
 *
 * @module canvas/embed-states
 */

import { Button } from "@nextlyhq/ui";
import { MonitorPlay } from "lucide-react";
import * as React from "react";

import { isElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import type { Rect } from "../geometry";
import { designIsWritable, lockViewOf, propIsWritable } from "../inspector";
import { selectionModeFor, type SelectionMode } from "../selection";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  EMBED_STATE_WORDS as WORDS,
  embedFrames,
  embedLinkOp,
  emptyEmbedBoxes,
} from "./embed-states-model";
import { overlaySpaceOf } from "./geometry-dom";
import { shownRectOf } from "./image-states";

export interface EmbedStatesProps {
  /** The editor the links are written through. */
  readonly editor: EditorState;
  /**
   * A block is being dragged. The boxes stay drawn, so the page keeps its
   * shape, and take no presses, so the drag reaches the canvas beneath.
   */
  readonly dragging?: boolean;
}

/** Where one plate is drawn, and for which Embed. */
interface Plate {
  readonly key: string;
  readonly nodeId: string;
  readonly rect: Rect;
  /** `empty`: the link field; `frame`: the cover over a frame. */
  readonly kind: "empty" | "frame";
}

/** What on a plate does something of its own when pressed. */
const CONTROLS = "button, input, label";

/** The field over each Embed that waits for a link. */
export function EmbedStates({
  editor,
  dragging = false,
}: EmbedStatesProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [plates, setPlates] = React.useState<readonly Plate[]>([]);

  // Read in callbacks that outlive the render that made them.
  const latest = React.useRef(editor);
  latest.current = editor;

  const measure = React.useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      setPlates(current => (current.length === 0 ? current : []));
      return;
    }
    const found: Plate[] = [];
    const { document } = latest.current;
    for (const [kind, boxes] of [
      ["empty", emptyEmbedBoxes(space.root, document)],
      ["frame", embedFrames(space.root, document)],
    ] as const) {
      boxes.forEach((box, index) => {
        const rect = shownRectOf(box.element, space);
        if (rect === null) return;
        found.push({
          key: `${box.nodeId}:${kind}:${String(index)}`,
          nodeId: box.nodeId,
          rect,
          kind,
        });
      });
    }
    setPlates(found);
  }, []);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, editor.document, canvasFrame]
  );

  /** Whether the Embed takes a link from here, now: no lock holds it. */
  const writable = (nodeId: string): boolean =>
    propIsWritable(editor.document, nodeId, "src", lockViewOf(editor));

  const select = (nodeId: string, mode?: SelectionMode): void => {
    if (mode === undefined) editor.select(nodeId);
    else editor.select(nodeId, mode);
  };

  /** Store a link on the Embed, through the editor's write path. */
  const store = (nodeId: string, link: string): boolean => {
    const now = latest.current;
    if (!propIsWritable(now.document, nodeId, "src", lockViewOf(now))) {
      return false;
    }
    // The provider's size only where the block's design may change: a
    // content-only area takes the link alone.
    const op = embedLinkOp(now.document, nodeId, link, {
      shape: designIsWritable(now.document, nodeId, lockViewOf(now)),
    });
    if (op === null) return false;
    select(nodeId);
    return now.apply(op) !== null;
  };

  return (
    <div
      ref={layer}
      className="nx-embed-states"
      data-dragging={dragging ? "" : undefined}
      {...{ [CHROME_ATTRIBUTE]: "" }}
    >
      {plates.map(plate =>
        plate.kind === "frame" ? (
          <FrameCover
            key={plate.key}
            plate={plate}
            onSelect={mode => select(plate.nodeId, mode)}
          />
        ) : (
          <EmbedPlate
            key={plate.key}
            plate={plate}
            writable={writable(plate.nodeId)}
            onSelect={mode => select(plate.nodeId, mode)}
            onLink={link => store(plate.nodeId, link)}
          />
        )
      )}
    </div>
  );
}

/**
 * The see-through cover over an Embed's frame: a press on it selects the
 * Embed. Hidden from assistive technology and the tab order, which reach the
 * block through Layers as they reach any other.
 */
function FrameCover({
  plate,
  onSelect,
}: {
  readonly plate: Plate;
  readonly onSelect: (mode: SelectionMode) => void;
}): React.JSX.Element {
  const { x, y, width, height } = plate.rect;
  return (
    <div
      className="nx-embed-state"
      data-embed-state="frame"
      aria-hidden="true"
      style={{ left: x, top: y, width, height }}
      onClick={event => onSelect(selectionModeFor(event))}
      // A secondary press or a touch selects the Embed before its menu
      // opens, which the menu around the canvas then opens for: the menu
      // never acts on the block selected before.
      onPointerDown={event => {
        if (event.button === 2 || event.pointerType === "touch") {
          onSelect(selectionModeFor(event));
        }
      }}
    />
  );
}

interface EmbedPlateProps {
  readonly plate: Plate;
  /** Whether the Embed's link may be set here. */
  readonly writable: boolean;
  readonly onSelect: (mode: SelectionMode) => void;
  /** Store a link; whether the editor took it. */
  readonly onLink: (link: string) => boolean;
}

/** One Embed's field, drawn over its empty box. */
function EmbedPlate({
  plate,
  writable,
  onSelect,
  onLink,
}: EmbedPlateProps): React.JSX.Element {
  const id = React.useId();
  const [typed, setTyped] = React.useState("");
  const fieldId = `${id}-${plate.nodeId}`;
  const { x, y, width, height } = plate.rect;
  return (
    <div
      className="nx-embed-state"
      role="group"
      aria-label="Embed"
      style={{ left: x, top: y, width, height }}
      onClick={event => {
        // Anywhere on the box selects the Embed; its controls do their own
        // thing.
        if (isElement(event.target) && event.target.closest(CONTROLS) !== null)
          return;
        onSelect(selectionModeFor(event));
      }}
      onContextMenu={event => event.stopPropagation()}
    >
      <form
        className="nx-embed-state__form"
        onSubmit={event => {
          event.preventDefault();
          if (onLink(typed)) setTyped("");
        }}
      >
        <MonitorPlay
          className="nx-embed-state__icon"
          size={24}
          aria-hidden="true"
        />
        <label className="nx-embed-state__title" htmlFor={fieldId}>
          {WORDS.field}
        </label>
        <div className="nx-embed-state__row">
          <input
            id={fieldId}
            className="nx-embed-state__address"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            value={typed}
            disabled={!writable}
            onChange={event => setTyped(event.currentTarget.value)}
            onPaste={event => {
              // Pasting a link is the whole act: stored at once, without a
              // second press. Anything that is not one line of text is
              // left to the field as usual.
              const pasted = event.clipboardData.getData("text/plain").trim();
              if (pasted === "" || /\s/.test(pasted)) return;
              event.preventDefault();
              if (!onLink(pasted)) setTyped(pasted);
            }}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!writable || typed.trim() === ""}
          >
            {WORDS.add}
          </Button>
        </div>
      </form>
    </div>
  );
}
