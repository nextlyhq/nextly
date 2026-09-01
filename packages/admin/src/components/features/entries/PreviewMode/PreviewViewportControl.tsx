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
import { useCallback, useEffect, useId, useState } from "react";

import type { PreviewFit } from "@admin/components/shared/preview/previewFrameFit";
import { UI } from "@admin/constants/ui";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import type { PreviewViewport } from "@admin/services/previewLinkApi";

/** The width the author asked for, or `null` for "fill the pane". */
export interface PreviewViewportControlProps {
  requestedWidth: number | null;
  onRequestWidth: (width: number | null) => void;
  /** What the pane could actually do with that request. */
  fit: PreviewFit;
  /**
   * The named viewports this preview offers, as the server resolved them.
   *
   * May be empty, and that is a real answer rather than a missing one: a site
   * that declares no breakpoints gets Responsive and a custom width, which is
   * everything that can be offered honestly without inventing widths.
   */
  viewports: readonly PreviewViewport[];
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

/**
 * The narrowest width a frame can be asked for.
 *
 * One pixel, because below it the preview is not small — it is gone, and an
 * author who typed `0.5` sees an empty pane rather than a narrow one. The input
 * carries this as its `min` attribute, which marks the field invalid without
 * clamping or refusing the value, so the rule has to live where the width is
 * committed as well. Both read this constant so they cannot disagree.
 */
const MIN_PREVIEW_WIDTH = 1;

export function PreviewViewportControl({
  requestedWidth,
  onRequestWidth,
  fit,
  viewports,
}: PreviewViewportControlProps) {
  const widthInputId = useId();

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
  /** Whether the author asked for a custom width, rather than landing on one. */
  const [editingCustom, setEditingCustom] = useState(false);

  /*
   * The width is taken when the author STOPS typing, not per keystroke.
   *
   * The frame is a live iframe of the site, so each committed width re-lays-out
   * a whole page. Clearing the box and typing `768` emits `7`, `76`, `768`, and
   * committing each one collapsed the preview to 7px and then 76px on the way —
   * the separate draft kept the FIELD from being torn away, but the frame still
   * thrashed through widths the author never asked for.
   */
  const settledDraft = useDebouncedValue(draft, UI.PREVIEW_WIDTH_DEBOUNCE_MS);

  const commitWidth = useCallback(
    (text: string) => {
      // Below one pixel is not a narrow preview, it is an absent one.
      const next = Number(text);
      if (Number.isFinite(next) && next >= MIN_PREVIEW_WIDTH) {
        onRequestWidth(next);
      }
    },
    [onRequestWidth]
  );

  useEffect(() => {
    /*
     * `settledDraft !== draft` means the pause has not happened yet; a null
     * draft means no edit is in progress. The second guard is what stops a
     * choice from the list being undone: selecting Responsive clears the draft,
     * but the debounced copy still holds the old text for one delay, and
     * committing it then would put the frame back at a width the author has
     * just navigated away from.
     */
    if (draft === null || settledDraft !== draft) return;
    commitWidth(settledDraft);
  }, [draft, settledDraft, commitWidth]);

  /*
   * Which option is selected is DERIVED from the width, not stored beside it.
   * A separate selection would let the two disagree — typing a custom width
   * that happens to equal a named one would leave "Custom" showing while the
   * frame is at the named viewport, and the author would have no way to tell
   * which of the two the control thinks it is on.
   *
   * Except while the box is being typed into, where the match is deliberately
   * not resolved. A named match is what REMOVES the custom box, so resolving
   * one mid-edit reopens the unmount this control already had to fix: typing
   * `7680` passes through `768`, and if that is a named tier the field
   * disappears under the author on the third keystroke — and the dropdown flips
   * to "Tablet" while they are still typing into a box labelled Custom.
   *
   * The draft ends on blur or on a choice from the list, and the match resolves
   * then, so a typed width that equals a named tier still gives way to it one
   * moment later — when the author has finished saying so.
   *
   * `editingCustom` is the same exception held for longer. Choosing "Custom
   * width" is a statement the WIDTH cannot carry: it commits a seed, and if the
   * site declares a viewport at that width — 1280 is the seed and an entirely
   * ordinary desktop tier — the lookup resolved it on the next render, showed
   * that preset's name and never rendered the box, so a custom width could not
   * be entered at all. The flag records what the author asked for; every other
   * choice clears it, so the two cannot drift into disagreeing about the width
   * itself, which is what deriving the selection is for.
   */
  const named =
    editingCustom || draft !== null
      ? undefined
      : viewports.find(v => v.width === requestedWidth);
  const selection =
    requestedWidth === null
      ? RESPONSIVE
      : named !== undefined
        ? String(named.width)
        : CUSTOM;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Select
        value={selection}
        onValueChange={value => {
          // A choice from the list ends the edit, so an abandoned draft does
          // not reappear the next time the box is shown.
          setDraft(null);
          setEditingCustom(value === CUSTOM);
          if (value === RESPONSIVE) return onRequestWidth(null);
          if (value === CUSTOM) return onRequestWidth(CUSTOM_SEED_WIDTH);
          /*
           * A named option carries its own width as the value, so no lookup can
           * go stale between rendering the list and reading a choice from it.
           *
           * `Number`, not `parseInt`: a declared width is offered exactly as
           * the site declares it, fractions included, and truncating `767.6` to
           * `767` would size the frame one side of the site's own
           * `@media (max-width: 767.6px)` boundary — and then match no viewport
           * at all, so the control would show Custom for an option the author
           * had just picked by name.
           */
          return onRequestWidth(Number(value));
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
          {/* The author's own names, in the order they declared them. The width
              is shown beside each because two sites can call very different
              numbers "Tablet", and the number is what the preview is actually
              sized to. */}
          {viewports.map(viewport => (
            <SelectItem key={viewport.width} value={String(viewport.width)}>
              {`${viewport.label} · ${viewport.width}px`}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Custom width</SelectItem>
        </SelectContent>
      </Select>

      {requestedWidth !== null && named === undefined && (
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
            min={MIN_PREVIEW_WIDTH}
            /*
             * A number input steps by 1 unless told otherwise, so the browser
             * reports a committed `390.5` as `stepMismatch`: the field reads as
             * invalid to native validation and to assistive technology while
             * the preview is using that exact width. Fractional widths are real
             * here, so the step has to say so.
             */
            step="any"
            className="h-7 w-20 text-xs"
            value={draft ?? String(requestedWidth)}
            onChange={event => {
              /*
               * Records what was typed and nothing else. What a frame can be
               * sized to is decided in `commitWidth`, once the typing stops:
               * an empty or half-typed box is a state of the EDIT, not a
               * viewport request.
               */
              setDraft(event.target.value);
            }}
            onBlur={() => {
              /*
               * Leaving the box ENDS the edit, so the pending width is taken
               * now rather than waiting out a pause that has already been
               * answered. Without this, typing a width and clicking straight
               * into the page would discard it — the debounce would still be
               * running when the draft was cleared.
               */
              if (draft !== null) commitWidth(draft);
              // A draft left behind would name a width the frame is not at.
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
