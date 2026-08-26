/**
 * Choosing which viewport the preview shows.
 *
 * ## Why a width and not a device
 *
 * There are no device icons here, and that is a decision rather than an
 * omission. A site defines its own breakpoints, author-named and up to seven of
 * them, so a tier may be called "Watch" or "Kiosk" — and no glyph is honest for
 * a list the product does not control. Text carries an author's name correctly;
 * a phone icon beside a tier called "Kiosk" is confidently wrong.
 *
 * ## Why the real width is always visible when it is scaled
 *
 * The pane cannot be wider than its share of the split, so a desktop width does
 * not fit on a laptop and is drawn smaller. The FRAME keeps the requested width,
 * so the site's media queries still resolve against it and the preview stays
 * truthful about the viewport — but text renders at a physical size no visitor
 * sees. An author comparing type sizes against a scaled preview would be reading
 * the wrong thing, so the scaling is named rather than left to be noticed.
 *
 * @module components/features/entries/PreviewMode/PreviewViewportControl
 */
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useId, useState } from "react";

import type { PreviewFit } from "./previewFrameFit";

/** The width the author asked for, or `null` for "fill the pane". */
export interface PreviewViewportControlProps {
  requestedWidth: number | null;
  onRequestWidth: (width: number | null) => void;
  /** What the pane could actually do with that request. */
  fit: PreviewFit;
}

/** The `Select` value standing for "fill the pane". */
const RESPONSIVE = "responsive";
/** The `Select` value standing for "I will type a width". */
const CUSTOM = "custom";

/**
 * A default to type INTO, not a preset.
 *
 * Switching to a custom width with an empty box would leave the control in a
 * state that renders nothing and reports nothing, so the box opens on a common
 * laptop width. It is a starting value the author overwrites, which is why it
 * is not offered as a named option — naming it would make it a claim about the
 * site's breakpoints, and the site's breakpoints are not known here.
 */
const CUSTOM_SEED_WIDTH = 1280;

export function PreviewViewportControl({
  requestedWidth,
  onRequestWidth,
  fit,
}: PreviewViewportControlProps) {
  const widthInputId = useId();
  const selection = requestedWidth === null ? RESPONSIVE : CUSTOM;

  /*
   * What the box SAYS, held separately from the width the frame is at.
   *
   * They are different facts. Clearing the box to retype it leaves text that
   * names no width, and a frame cannot be sized to "nothing" — so the committed
   * value stays where it was until the box says something a frame can be sized
   * to. Collapsing the two meant an empty box committed `null`, which selected
   * Responsive, which removed this input: the field the author was typing in
   * disappeared under them and the rest of their keystrokes went nowhere.
   *
   * `null` means "not being edited", and the box then shows the committed
   * width — so a value arriving from anywhere else is displayed rather than
   * masked by a draft nobody is typing.
   */
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Select
        value={selection}
        onValueChange={value => {
          // A choice from the list ends the edit, so an abandoned draft does
          // not reappear the next time the box is shown.
          setDraft(null);
          onRequestWidth(value === RESPONSIVE ? null : CUSTOM_SEED_WIDTH);
        }}
      >
        <SelectTrigger
          className="h-7 w-[9.5rem] text-xs"
          aria-label="Preview viewport"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={RESPONSIVE}>Responsive</SelectItem>
          <SelectItem value={CUSTOM}>Custom width</SelectItem>
        </SelectContent>
      </Select>

      {requestedWidth !== null && (
        <>
          {/* Labelled for assistive technology only: the unit beside the box
              reads as the visible label, and a second visible one would say the
              same thing twice in a toolbar that is already dense. */}
          <label className="sr-only" htmlFor={widthInputId}>
            Preview width in pixels
          </label>
          <Input
            id={widthInputId}
            type="number"
            inputMode="numeric"
            min={1}
            className="h-7 w-20 text-xs"
            value={draft ?? String(requestedWidth)}
            onChange={event => {
              const text = event.target.value;
              setDraft(text);

              /*
               * Commit only what a frame can be sized to. An empty or
               * half-typed box is a state of the EDIT, not a viewport request,
               * so the frame holds its last good width while the author types
               * the next one — otherwise the preview flickers back to full
               * width between two keystrokes. Zero and below are rejected here
               * for the same reason `previewFrameFit` refuses them: it fills
               * the pane instead, and committing one would leave this control
               * and the frame describing different states.
               *
               * `Number`, not `parseInt`. A number input accepts and displays
               * `390.5` and `1e3`, and `parseInt` reads those as `390` and `1`
               * — sizing the frame to a width the box is not showing, and
               * replacing the author's text with the truncated value on blur.
               * A fractional width is a real one: CSS sizes to it and the
               * site's media queries resolve against it.
               */
              const next = Number(text);
              if (Number.isFinite(next) && next > 0) onRequestWidth(next);
            }}
            onBlur={() => {
              // Leaving the box ends the edit. A draft left behind would name a
              // width the frame is not at.
              setDraft(null);
            }}
          />
          <span className="text-xs text-muted-foreground">px</span>
        </>
      )}

      {/* Named rather than left to be noticed. The frame is truthful about the
          VIEWPORT while it is scaled and untruthful about physical size, and an
          author checking type sizes needs to know which of the two they are
          looking at. */}
      {fit.kind === "scaled" && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {`${Math.round(fit.scale * 100)}% of ${fit.width}px`}
        </span>
      )}
    </div>
  );
}
