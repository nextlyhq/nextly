/**
 * Dragging a number field's LABEL to change its value: the inspector's half of
 * the scrub gesture `scrub-gesture.ts` owns.
 *
 * The label and the field are drawn by different components — the row draws
 * the label, the control kind decides the field — so the two meet through a
 * slot the row provides: the field says what a drag may do to its value, and
 * the label carries the pointer handling. Nothing else about either changes,
 * which is what keeps a field that does not scrub exactly as it was.
 *
 * ## One write, on release
 *
 * While the pointer is down the field SHOWS each value and the document is not
 * touched; letting go writes the last one through the field's own commit, the
 * same path a typed value takes, so one drag is one undo step. Escape puts the
 * field's text back as it was before the press and writes nothing.
 *
 * ## A click is still a click
 *
 * Until the pointer passes the shared dead zone a press is a click, and a click
 * on a label focuses its field as it always has. Touch never scrubs: a finger
 * on a label is a tap that should focus, or the start of a scroll. A press is
 * kept from selecting text, and the click a finished drag produces is
 * swallowed, so letting go does not also put a caret in the field.
 *
 * The keyboard path is the field's own: its arrow keys step by the same
 * amounts, with the same modifiers, as a drag.
 *
 * @module label-scrub
 */
import * as React from "react";

import {
  FIELD_SCRUB_START,
  fieldScrubMove,
  followScrub,
  scrubModifiersOf,
  type ScrubSession,
} from "./scrub-gesture";

/**
 * A value a drag moves: one measurement as text, or a bare number. Never a
 * token or a record, which a drag has no quantity to change in.
 */
export type ScrubbedValue = string | number;

/** What a field lets its label do to its value. */
export interface LabelScrubField {
  /** The value a drag starts from, or `undefined` while the field cannot be dragged. */
  readonly origin: ScrubbedValue | undefined;
  /** The value `delta` from `origin`, held to what the property takes, or `undefined`. */
  readonly at: (
    origin: ScrubbedValue,
    delta: number
  ) => ScrubbedValue | undefined;
  /** The field's text now, put back when a drag is abandoned. */
  readonly draft: string;
  /** Shows text in the field while the pointer is down. */
  readonly show: (text: string) => void;
  /** Writes the value, once, on release. */
  readonly commit: (value: ScrubbedValue) => void;
  /** Shows the field's stored value, for a drag its subject changed under. */
  readonly reset: () => void;
}

/** The row's slot between its label and its field. */
interface LabelScrubSlot {
  readonly field: React.RefObject<LabelScrubField | null>;
  readonly setEnabled: (enabled: boolean) => void;
  /** Whether a drag holds the value now, so the field's own writes wait. */
  readonly owning: React.RefObject<boolean>;
}

/** What a row shares: the slot its field fills, and the props its label takes. */
interface LabelScrubRowValue {
  readonly slot: LabelScrubSlot;
  readonly labelProps: LabelScrubProps | undefined;
}

const LabelScrubContext = React.createContext<LabelScrubRowValue | null>(null);

/** What the label spreads while its field can be dragged. */
export interface LabelScrubProps {
  readonly "data-scrub": "" | "active";
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  readonly onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * One style row: its label and its field meet through this, wherever each is
 * drawn inside it.
 */
export function LabelScrubRow({
  subject,
  children,
}: {
  /**
   * What the row edits: the block and the style target. A drag began on one
   * subject ends, unwritten, when the row is reused for another, as selecting
   * another block does — its value came from the subject it started on.
   */
  readonly subject: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const row = useLabelScrubSlot(subject);
  return (
    <LabelScrubContext.Provider value={row}>
      {children}
    </LabelScrubContext.Provider>
  );
}

/**
 * The label's half: the props it spreads, or `undefined` while its field
 * cannot be dragged, so a colour, a menu or a keyword's label keeps its plain
 * cursor and handlers. Outside a row, always `undefined`.
 */
export function useLabelScrubProps(): LabelScrubProps | undefined {
  return React.useContext(LabelScrubContext)?.labelProps;
}

/** The row's state: a slot for its field, and the props its label takes. */
function useLabelScrubSlot(subject: string): LabelScrubRowValue {
  const field = React.useRef<LabelScrubField | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const session = React.useRef<ScrubSession | null>(null);
  const swallowClick = React.useRef(false);
  const owning = React.useRef(false);
  const slot = React.useMemo<LabelScrubSlot>(
    () => ({ field, setEnabled, owning }),
    []
  );
  // Set when a drag ends because its subject changed, so the field shows its
  // new subject's value rather than the old one's text.
  const superseded = React.useRef(false);
  // A drag does not outlive its row or its subject: taken away mid-drag, or
  // reused for another block, it ends without writing.
  React.useEffect(
    () => () => {
      superseded.current = true;
      session.current?.end();
      superseded.current = false;
    },
    [subject]
  );

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    // A click only ever follows a press, so a flag a drag released elsewhere
    // left behind cannot swallow this one.
    swallowClick.current = false;
    if (event.button !== 0 || event.pointerType === "touch") return;
    if (session.current !== null) return;
    const origin = field.current?.origin;
    const before = field.current?.draft;
    if (origin === undefined || before === undefined) return;
    // No text is selected by the drag. The click a press below the dead zone
    // becomes still reaches the label, which focuses the field.
    event.preventDefault();
    let progress = FIELD_SCRUB_START;
    let shown: ScrubbedValue = origin;
    // The modifiers the field last showed a value with. The release uses
    // these rather than its own: letting go of Shift before the button is
    // ordinary, and the write must be the value on screen.
    let held = scrubModifiersOf(event);
    // Whether the field shows a value of the drag's that is not written.
    let previewing = false;
    const showAt = (dx: number): void => {
      progress = fieldScrubMove(progress, dx, held);
      const live = field.current;
      if (live === null) return;
      const next =
        progress.delta === 0 ? origin : live.at(origin, progress.delta);
      // A step the property refuses outright keeps the last value shown.
      if (next === undefined) return;
      shown = next;
      live.show(String(next));
    };
    session.current = followScrub(
      {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        host: event.currentTarget,
      },
      {
        onMove: (moved, travel) => {
          // From here the drag owns the value: the field writes nothing of
          // its own (a blur, a key) until the drag is released or abandoned.
          owning.current = true;
          previewing = true;
          setDragging(true);
          held = scrubModifiersOf(moved);
          showAt(travel.dx);
        },
        onRelease: (_lifted, travel) => {
          swallowClick.current = true;
          // The release's own position: the last move delivered can be short
          // of it when the browser coalesces pointer movement.
          showAt(travel.dx);
          owning.current = false;
          previewing = false;
          const live = field.current;
          if (live === null) return;
          // Back where it started, the field shows what it did before the
          // press, and nothing is written.
          if (shown === origin) live.show(before);
          else live.commit(shown);
        },
        // Escape, a cancelled pointer and a row taken away all end here
        // without a release: the field goes back to its text before the press.
        onEnd: () => {
          owning.current = false;
          session.current = null;
          setDragging(false);
          if (!previewing) return;
          if (superseded.current) field.current?.reset();
          else field.current?.show(before);
        },
      }
    );
  };

  return {
    slot,
    labelProps: enabled
      ? {
          "data-scrub": dragging ? "active" : "",
          onPointerDown,
          onClickCapture: event => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            // The label would otherwise focus its field as the drag ends.
            event.preventDefault();
            event.stopPropagation();
          },
        }
      : undefined,
  };
}

/**
 * The field's half: offer this value to the row's label.
 *
 * Outside a row that provides a slot it does nothing, so a field drawn on its
 * own keeps only its keyboard stepping.
 *
 * @returns whether a drag owns the value now. The field's own commits — a
 *   blur, Enter, an arrow — must write nothing then: the drag writes once on
 *   release, and a write mid-drag is one Escape could no longer take back.
 */
export function useLabelScrub(field: LabelScrubField): () => boolean {
  const slot = React.useContext(LabelScrubContext)?.slot ?? null;
  // The latest closures, for a drag that reads them as the pointer moves.
  React.useLayoutEffect(() => {
    if (slot !== null) slot.field.current = field;
  });
  const enabled = field.origin !== undefined;
  React.useEffect(() => {
    slot?.setEnabled(enabled);
  }, [slot, enabled]);
  React.useEffect(
    () => () => {
      if (slot === null) return;
      slot.field.current = null;
      slot.setEnabled(false);
    },
    [slot]
  );
  return () => slot?.owning.current === true;
}
