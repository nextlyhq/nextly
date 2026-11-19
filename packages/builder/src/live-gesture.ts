/**
 * A drag that writes as the pointer moves, so the canvas follows it: a
 * number label dragged, a colour dragged across the picker, a slider moved.
 *
 * Every write the drag makes is part of one run of typing (`typing-run.ts`),
 * so the history keeps the whole drag as ONE step: undo takes it back to the
 * value from before the press. Letting go writes the last value in the same
 * run and ends it; the next drag is a step of its own. Abandoning the drag
 * (Escape, a cancelled pointer) puts back everything it wrote through the
 * editor's `cancelTyping`, and records nothing.
 *
 * At most one write a frame. A pointer reports far more often than a screen
 * draws, and each write redraws the canvas, so moves are held until the next
 * frame and only the latest of them is written: the canvas keeps up with the
 * pointer, and the work a drag costs is set by the screen's rate rather than
 * by the mouse's.
 *
 * @module live-gesture
 */

import * as React from "react";

import { TypingCancel } from "./live-draft";
import { joinTyping } from "./typing-run";

/** A drag's writes, as one step of the editor's history. */
export interface LiveGesture {
  /**
   * The pointer moved: write with `write` at the next frame, in the drag's
   * run. A later move before that frame replaces it.
   */
  readonly move: (write: () => void) => void;
  /**
   * The drag was let go of: a move still waiting for its frame is dropped,
   * and `write`, given, is written now in the same run, so the whole drag is
   * one step. The next move begins a new drag.
   */
  readonly end: (write?: () => void) => void;
  /**
   * The drag was abandoned: nothing more is written, and what it wrote is
   * put back, with nothing recorded.
   */
  readonly cancel: () => void;
}

/** What one drag holds between its moves. */
interface Drag {
  /** The run its writes are made in, from its first write. */
  run: object | null;
  /** The latest move, waiting for its frame. */
  pending: (() => void) | null;
  /** The frame asked for, while one is. */
  frame: number | null;
}

/**
 * A drag's writes, for a field drawn over the editor: the block settings
 * panel provides the cancel ({@link TypingCancel}). Outside one, abandoning
 * a drag cannot put its writes back, so a field there writes only on release.
 */
export function useLiveGesture(): LiveGesture {
  const cancelTyping = React.useContext(TypingCancel);
  const drag = React.useRef<Drag>({
    run: null,
    pending: null,
    frame: null,
  }).current;
  // A field taken away mid-drag asks for no frame after it is gone.
  React.useEffect(
    () => () => {
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drag.frame = null;
      drag.pending = null;
    },
    [drag]
  );
  return React.useMemo(() => {
    const runOf = (): object => {
      drag.run ??= {};
      return drag.run;
    };
    const drop = (): void => {
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      drag.frame = null;
      drag.pending = null;
    };
    const draw = (): void => {
      drag.frame = null;
      const write = drag.pending;
      drag.pending = null;
      if (write !== null) joinTyping(runOf(), write);
    };
    return {
      move: write => {
        drag.pending = write;
        drag.frame ??= requestAnimationFrame(draw);
      },
      end: write => {
        drop();
        if (write !== undefined) joinTyping(runOf(), write);
        drag.run = null;
      },
      cancel: () => {
        drop();
        const { run } = drag;
        drag.run = null;
        if (run !== null) cancelTyping?.(run);
      },
    };
  }, [drag, cancelTyping]);
}
