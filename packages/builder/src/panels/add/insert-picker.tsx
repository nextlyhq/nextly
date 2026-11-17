"use client";

/**
 * The in-place block picker: a small dialog that opens where the author is
 * looking, with a search, the six blocks they add most and "Browse all
 * blocks and sections →", and adds a block without a trip to the Add panel.
 *
 * Always mounted, and drawn only while a request is open: the live region
 * that announces an insert has to outlast the picker it was made in, since
 * the insert is what closes it. Each opening is drawn fresh (keyed by its
 * count), so a second opening starts from an empty search.
 *
 * After an insert, the new block is selected (by the Add panel's own insert)
 * and, when it has text, opened for typing by the same verb Enter runs;
 * otherwise focus goes to the canvas, where the keyboard acts on the new
 * selection. Closed without adding, focus goes back to whatever opened it.
 *
 * @module insert-picker
 */

import * as React from "react";

import { returnFocusToCanvas } from "../../canvas/canvas-escape";
import { useCanvasFrame } from "../../canvas/canvas-frame-context";
import { isHTMLElement, isIFrame } from "../../dom-kind";

import type { Measurable } from "./insert-panel-summon";
import { InsertAnnouncement } from "./insert-panel-tiles";
import { OpenPicker } from "./insert-picker-body";
import type {
  InsertPickerProps,
  InsertPickerRequest,
  InsertPickerTarget,
  PickerOutcome,
} from "./insert-picker-types";

export { PICKER_WORDS } from "./insert-picker-body";

/**
 * The picker, drawn while `request` is open.
 *
 * @experimental
 */
export function InsertPicker({
  request,
  onClose,
  onEditText,
  ...props
}: InsertPickerProps): React.JSX.Element {
  const frame = useCanvasFrame().frame;
  // The sentence the last insert is announced with; a repeat gains a
  // zero-width space so a live region reads it again.
  const [said, setSaid] = React.useState("");
  const editText = React.useRef(onEditText);
  editText.current = onEditText;
  const finish = (outcome: PickerOutcome): void => {
    const opener = request?.opener ?? null;
    onClose();
    // Once the picker has gone, and the canvas has drawn what was added.
    setTimeout(() => {
      settleFocus(outcome, { opener, frame, editText: editText.current });
    }, 0);
  };
  return (
    <>
      <InsertAnnouncement text={said} />
      {request === null ? null : (
        <OpenPicker
          key={request.count}
          {...props}
          request={request}
          onFinish={finish}
          onSaid={sentence =>
            setSaid(previous =>
              previous === sentence ? `${sentence}​` : sentence
            )
          }
        />
      )}
    </>
  );
}

/** Where focus goes once an opening of the picker has ended. */
function settleFocus(
  outcome: PickerOutcome,
  {
    opener,
    frame,
    editText,
  }: {
    readonly opener: HTMLElement | null;
    readonly frame: HTMLIFrameElement | null;
    readonly editText: ((nodeId: string) => boolean) | undefined;
  }
): void {
  if (outcome.kind === "browse") return;
  if (outcome.kind === "inserted") {
    if (editText?.(outcome.node.id) === true) return;
    if (frame !== null) returnFocusToCanvas(frame);
    return;
  }
  if (!outcome.returnFocus || opener === null || !opener.isConnected) return;
  // Back to the canvas the way Escape returns there, with its outline.
  if (isIFrame(opener)) returnFocusToCanvas(opener);
  else opener.focus({ preventScroll: true });
}

/** The picker's open request, and the ways to open and close it. */
export interface InsertPickerState {
  readonly request: InsertPickerRequest | null;
  /**
   * Open the picker beside `anchor`. The element with focus now is where
   * focus returns when the picker closes without adding.
   */
  readonly open: (target: InsertPickerTarget, anchor: Measurable) => void;
  readonly close: () => void;
}

/**
 * The picker's state, for a host to hand to {@link InsertPicker} and to the
 * controls that open it.
 *
 * @experimental
 */
export function useInsertPicker(): InsertPickerState {
  const [request, setRequest] = React.useState<InsertPickerRequest | null>(
    null
  );
  const opened = React.useRef(0);
  const open = React.useCallback(
    (target: InsertPickerTarget, anchor: Measurable): void => {
      opened.current += 1;
      const active = document.activeElement;
      setRequest({
        target,
        anchor,
        opener: isHTMLElement(active) ? active : null,
        count: opened.current,
      });
    },
    []
  );
  const close = React.useCallback(() => setRequest(null), []);
  return React.useMemo(
    () => ({ request, open, close }),
    [request, open, close]
  );
}
