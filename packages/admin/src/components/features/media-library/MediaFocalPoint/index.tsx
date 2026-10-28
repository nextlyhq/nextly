"use client";

/**
 * MediaFocalPoint
 *
 * The whole image, with one dot for the part that must stay in view when the
 * image is cropped. "Set focus point" turns the image into the control: a click
 * or a drag puts the dot there, the arrow keys move it, Centre puts it back in
 * the middle, Done saves it and Escape leaves without saving.
 *
 * The point is measured on the IMAGE's own box, never on the frame around it.
 * The frame is wider or taller than most images, and the bands of backdrop
 * that leaves are not part of the picture: measured on the frame, a click on
 * the image saved a point somewhere else on it.
 *
 * One implementation, used by the details panel, the full-screen viewer and
 * the edit dialog an upload field opens, so the three can't place the point
 * differently.
 */

import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { MEDIA_DESTRUCTIVE_TEXT_CLASSES } from "@admin/constants/media";
import { cn } from "@admin/lib/utils";

/** The stored point: whole percentages from the left and from the top. */
export interface MediaFocalPointValue {
  focalX: number;
  focalY: number;
}

export interface MediaFocalPointProps {
  /** The whole image, never a cropped thumbnail, or the dot lands off it. */
  src: string;
  alt: string;
  focalX?: number | null;
  focalY?: number | null;
  /** Called by Done. A rejection keeps the control open to try again. */
  onSave: (point: MediaFocalPointValue) => Promise<void> | void;
  /** A reader sees the image and the dot, with nothing to change them. */
  readOnly?: boolean;
  /** Sizes the image for its surface: the panel and the viewer differ. */
  imageClassName?: string;
}

/** The middle of the image, which is also what an unset point means. */
const CENTRE = 50;

/** One arrow press moves the dot this far; with Shift, ten times as far. */
const ARROW_STEP = 1;
const SHIFT_ARROW_STEP = 10;

/**
 * Whether a key press was aimed at a focus point being placed. A sheet or a
 * dialog holding this control passes its Escape here and stays open when it
 * is: Radix hears Escape on the document before the dot does, and would close
 * the whole surface when the person only meant to stop placing the point.
 */
export function isFocalPointKeyEvent(event: KeyboardEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("[data-focal-dot]") !== null
  );
}

const clampPercent = (value: number): number =>
  Math.round(Math.min(100, Math.max(0, value)));

/**
 * The point under the pointer, as whole percentages of the image's own box.
 * A pointer on the backdrop beside the image is held at the image's edge. A
 * box with no size, an image not yet laid out, gives no point at all.
 */
function pointOnImage(
  image: HTMLImageElement,
  clientX: number,
  clientY: number
): MediaFocalPointValue | null {
  const rect = image.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    focalX: clampPercent(((clientX - rect.left) / rect.width) * 100),
    focalY: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

export function MediaFocalPoint({
  src,
  alt,
  focalX,
  focalY,
  onSave,
  readOnly = false,
  imageClassName,
}: MediaFocalPointProps): React.JSX.Element {
  const fromProps: MediaFocalPointValue = React.useMemo(
    () => ({ focalX: focalX ?? CENTRE, focalY: focalY ?? CENTRE }),
    [focalX, focalY]
  );
  // The point as last saved: what Done saved, until the item's own values
  // change. A caller that doesn't refresh its item after the save (an upload
  // field's dialog keeps the item it opened with) would otherwise snap the
  // dot back to where it was before Done.
  const [stored, setStored] = React.useState(fromProps);
  React.useEffect(() => setStored(fromProps), [fromProps]);
  const [setting, setSetting] = React.useState(false);
  const [draft, setDraft] = React.useState(stored);
  const [saving, setSaving] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const dotRef = React.useRef<HTMLSpanElement>(null);
  const setButtonRef = React.useRef<HTMLButtonElement>(null);
  // Whether a press is in progress, so a move without one doesn't place the dot.
  const draggingRef = React.useRef(false);
  // Where focus goes when setting ends: back to the button that started it.
  const returnFocusRef = React.useRef(false);

  // The image on screen. Another one (the panel or the viewer moving to the
  // next item) ends any placing in progress without saving it, and starts
  // from the new image's own point: a draft placed on one image and saved
  // by a Done pressed after the move would land on the other.
  const [shownSrc, setShownSrc] = React.useState(src);
  if (shownSrc !== src) {
    setShownSrc(src);
    setSetting(false);
    setSaving(false);
    setSaveFailed(false);
    setStored(fromProps);
    setDraft(fromProps);
  }
  // Read by a save still in flight, so one that settles after the image
  // changed touches nothing on the new one.
  const srcRef = React.useRef(src);
  srcRef.current = src;

  // A different item, or a saved point arriving from the server, replaces the
  // draft, but never while the person is placing the dot.
  React.useEffect(() => {
    if (!setting) setDraft(stored);
  }, [stored, setting]);

  // Focus moves to the dot when setting starts, so the arrow keys work at once,
  // and back to "Set focus point" when it ends.
  React.useEffect(() => {
    if (setting) {
      dotRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      setButtonRef.current?.focus();
    }
  }, [setting]);

  const start = () => {
    setDraft(stored);
    setSaveFailed(false);
    setSetting(true);
  };

  const finish = () => {
    returnFocusRef.current = true;
    setSetting(false);
  };

  const cancel = () => {
    setDraft(stored);
    setSaveFailed(false);
    finish();
  };

  const done = async () => {
    // Nothing moved (Done straight after "Set focus point", or Centre on a
    // point already in the middle): there is nothing to save, and a save
    // would make the server cut every size of the image again for nothing.
    if (draft.focalX === stored.focalX && draft.focalY === stored.focalY) {
      setSaveFailed(false);
      finish();
      return;
    }
    const savingSrc = src;
    setSaving(true);
    setSaveFailed(false);
    try {
      await onSave(draft);
      if (srcRef.current !== savingSrc) return;
      setStored(draft);
      finish();
    } catch {
      // The draft stays on screen, so Done can be pressed again.
      if (srcRef.current === savingSrc) setSaveFailed(true);
    } finally {
      if (srcRef.current === savingSrc) setSaving(false);
    }
  };

  const placeAt = (clientX: number, clientY: number) => {
    const image = imageRef.current;
    if (!image) return;
    const point = pointOnImage(image, clientX, clientY);
    if (point) setDraft(point);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!setting || event.button !== 0) return;
    draggingRef.current = true;
    // Captured so a drag that leaves the frame keeps moving the dot, held at
    // the image's edge, instead of stopping where the pointer crossed out.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    placeAt(event.clientX, event.clientY);
    // The dot keeps focus through a click, so the arrow keys still work.
    event.preventDefault();
    dotRef.current?.focus();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!setting || !draggingRef.current) return;
    placeAt(event.clientX, event.clientY);
  };

  const endDrag = () => {
    draggingRef.current = false;
  };

  const handleDotKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = event.shiftKey ? SHIFT_ARROW_STEP : ARROW_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      // Stopped here so the panel and the viewer don't also read the arrow as
      // "next item".
      event.stopPropagation();
      setDraft(current => ({
        focalX: clampPercent(current.focalX + move[0]),
        focalY: clampPercent(current.focalY + move[1]),
      }));
      return;
    }
    if (event.key === "Escape") {
      // Escape leaves the focus point first; only a second one closes the
      // surface around it.
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void done();
    }
  };

  const shown = setting ? draft : stored;
  // At rest the dot appears only once a point has been chosen: an unset point
  // is the middle, and a dot there says nothing the image doesn't.
  const showDot = setting || shown.focalX !== CENTRE || shown.focalY !== CENTRE;

  return (
    <div className="flex flex-col gap-2">
      <div
        data-focal-frame=""
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted select-none",
          // `touch-none` while setting, so a drag on a touch screen moves the
          // dot rather than scrolling the panel.
          setting && "cursor-crosshair touch-none"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Shrinks to the image, so the dot's percentages are the image's. */}
        <span className="relative inline-flex max-w-full">
          <img
            ref={imageRef}
            src={src}
            alt={alt}
            draggable={false}
            className={cn("block h-auto w-auto max-w-full", imageClassName)}
          />
          {showDot && (
            <span
              ref={dotRef}
              data-focal-dot=""
              // A slider only while it can move: at rest it is a mark on the
              // image, and a focusable mark would be a Tab stop that does
              // nothing.
              {...(setting
                ? {
                    role: "slider",
                    tabIndex: 0,
                    "aria-label": "Focus point",
                    "aria-valuemin": 0,
                    "aria-valuemax": 100,
                    "aria-valuenow": shown.focalX,
                    "aria-valuetext": `${shown.focalX}% from the left, ${shown.focalY}% from the top`,
                    onKeyDown: handleDotKeyDown,
                  }
                : { "aria-hidden": true })}
              className={cn(
                // A ring in the page colour with a thin outline in the text
                // colour, so the dot reads on light and dark parts of any
                // photo, in either colour scheme.
                "pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground/40 outline outline-1 outline-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2"
              )}
              style={{ left: `${shown.focalX}%`, top: `${shown.focalY}%` }}
            />
          )}
        </span>
      </div>

      {!readOnly &&
        (setting ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto min-w-0 flex-1 basis-48 text-sm text-muted-foreground">
              Click or drag to the part that must stay in view when the image is
              cropped. The arrow keys move it too.
            </p>
            {/* One unit, so a narrow row moves both buttons to the next line
                together rather than leaving Done on a line of its own. */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft({ focalX: CENTRE, focalY: CENTRE })}
                disabled={saving}
              >
                Centre
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void done()}
                disabled={saving}
              >
                Done
              </Button>
            </div>
            {saveFailed && (
              <p
                role="alert"
                className={cn("w-full text-sm", MEDIA_DESTRUCTIVE_TEXT_CLASSES)}
              >
                The focus point couldn&apos;t be saved. Press Done to try again.
              </p>
            )}
          </div>
        ) : (
          <div>
            <Button
              ref={setButtonRef}
              type="button"
              variant="outline"
              size="sm"
              onClick={start}
            >
              Set focus point
            </Button>
          </div>
        ))}
    </div>
  );
}
