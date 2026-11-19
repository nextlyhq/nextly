"use client";

/**
 * "Play", beside "Animation when it appears": the block's animation played
 * once on the canvas, on a press and whenever the animation changes.
 *
 * The canvas otherwise shows every block in its final state, so an author
 * sees the animation only when they ask for it or have just changed it, and
 * never while scrolling or as the page redraws.
 *
 * A change is a different value where the panel is looking: the same block,
 * target, state and device. Selecting another block, or switching the device,
 * the state or what the panel edits (the block or one of its shared styles),
 * shows another value without anyone changing one, so it plays nothing.
 *
 * @module appear-play
 */
import type { BreakpointId, StyleState } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import { Play } from "lucide-react";
import * as React from "react";

import { playAppear } from "./canvas/appear-replay";
import { useCanvasFrame } from "./canvas/canvas-frame-context";
import type { EditorState } from "./editor-state";
import { StyleTargetContext } from "./style-field-surroundings";
import { fieldStyles, targetKey } from "./style-field-target";
import { readStyleValue } from "./style-values";

/** The style property the button plays. */
export const APPEAR_PROPERTY = "appear";

/**
 * Calls `play` when `value` changes while `where` stays the same; never on
 * the first render, nor when `where` moves.
 */
function usePlayOnChange(where: string, value: string, play: () => void): void {
  const last = React.useRef({ where, value });
  React.useEffect(() => {
    const before = last.current;
    last.current = { where, value };
    if (before.where === where && before.value !== value) play();
  }, [where, value, play]);
}

/**
 * The Play button for the animation of block `nodeId`, which also plays the
 * animation once each time the value the panel shows for it changes.
 */
export function AppearPlay({
  nodeId,
  state,
  breakpoint,
  editor,
}: {
  nodeId: string;
  state: StyleState;
  breakpoint: BreakpointId;
  editor: EditorState;
}): React.JSX.Element {
  const canvas = useCanvasFrame().document;
  const target = React.useContext(StyleTargetContext);
  const value = readStyleValue(fieldStyles(target, editor, nodeId).styles, {
    state,
    breakpoint,
    property: APPEAR_PROPERTY,
    path: [],
  });
  const play = React.useCallback(() => {
    if (canvas !== null) playAppear(canvas, nodeId);
  }, [canvas, nodeId]);
  usePlayOnChange(
    [nodeId, targetKey(target), state, breakpoint].join("\u0000"),
    JSON.stringify(value ?? null),
    play
  );
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="nx-style-inspector__play"
      onClick={play}
    >
      <Play size={14} aria-hidden="true" />
      Play
    </Button>
  );
}
