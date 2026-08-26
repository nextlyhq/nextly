"use client";

/**
 * The control that sizes the canvas, and thereby chooses the tier being edited.
 *
 * **It sets a WIDTH, and nothing else.** Which tier the inspector edits and
 * which tiers the page is applying are both derived from that width by
 * `canvas-width.ts`, so this component holds no notion of a "current
 * breakpoint" that could disagree with the box on screen. Gutenberg arrived at
 * the same arrangement by unifying a device menu and a resizable canvas that
 * had been mutually exclusive: canvas width became the single source of truth
 * and the device menu was demoted to a way of setting one.
 *
 * The founder's 2026-08-24 ruling deferred this control until canvas width
 * simulation existed, on the grounds that a selector changing which values you
 * edit while the canvas still shows desktop is confusing. That is precisely the
 * state deriving both facts from one width makes unrepresentable.
 *
 * **A breakpoint selector, not a device preview.** It says which of the site's
 * tiers the canvas is sized to; it does not promise that the result matches
 * what a visitor sees. It cannot: the canvas is not an iframe, so a page sized
 * in `vw`/`vh`, a hand-authored `@media` rule, or a block reading
 * `window.innerWidth` still answers to the admin window. `decision:preview-truth-is-the-iframe`
 * settles that the iframe is the authoritative preview and this is the correct
 * interim, so the labels here stay in the vocabulary of breakpoints and make no
 * fidelity claim.
 *
 * **In the top bar beside the manager**, which `breakpoint-manager.tsx` chose
 * its own placement to leave room for: the two read as one control — what the
 * site's breakpoints ARE, and which one you are looking at.
 *
 * @module breakpoint-switcher
 */

import type { BreakpointId, BreakpointSet } from "@nextlyhq/blocks-engine";
import { cn } from "@nextlyhq/ui/utils";
import * as React from "react";

import { authoredBreakpoints, inCascadeOrder } from "./breakpoints";
import { editedBreakpointAtWidth, widthForBreakpoint } from "./canvas-width";

/**
 * Props for BreakpointSwitcher.
 * @experimental
 */
export interface BreakpointSwitcherProps {
  /** The site's saved breakpoints, as the canvas is compiled against them. */
  breakpoints: BreakpointSet | undefined;
  /**
   * The canvas's current width in CSS pixels, or `undefined` for unbounded —
   * the widest tier, filling whatever the region allows.
   */
  width: number | undefined;
  /**
   * The box's MEASURED inline size, or `undefined` before anything was
   * observed.
   *
   * Separate from {@link BreakpointSwitcherProps.width}, because the two are
   * different facts and only one of them is a choice. The request is a CEILING:
   * an editor region narrower than the tier asked for hands the box less, and
   * what the container queries resolve against is the width the box got. Fed
   * back in as `width` it would unselect the option the author just clicked;
   * left out entirely, this control would state a tier for a box nobody looked
   * at.
   */
  appliedWidth?: number;
  /** Size the canvas. `undefined` releases it back to the full region. */
  onSelect: (width: number | undefined) => void;
  /**
   * What the saved set's read has actually done, mirroring
   * {@link BreakpointManagerProps.status} — and disabled for the same reason,
   * which is stronger here than it looks.
   *
   * Until the read answers, the value in hand is the host's CONFIG DEFAULTS. A
   * switcher offering those would size the canvas to a bound the site never
   * chose, and every edit made at that width would land in whichever tier the
   * default bound implies — writing to a breakpoint the author never selected,
   * with nothing on screen to say so.
   */
  status: "loading" | "unavailable" | "ready";
}

/**
 * A segmented control over the site's viewport tiers, widest first.
 *
 * `radiogroup` rather than a row of buttons or a `tablist`: this is a
 * single-choice control over a small set, which is what a radio group means,
 * and it buys arrow-key navigation that assistive technology already announces.
 * A `tablist` would be wrong — no panel is being switched — and plain buttons
 * would leave a screen-reader user with no indication that choosing one
 * deselects the others.
 *
 * @experimental
 */
export function BreakpointSwitcher({
  breakpoints,
  width,
  appliedWidth,
  onSelect,
  status,
}: BreakpointSwitcherProps): React.JSX.Element | null {
  const ready = status === "ready";
  /*
   * The AUTHORED set, in cascade order.
   *
   * `authoredBreakpoints` strips a stored row using the reserved base id — the
   * plugin's own README documents a host config carrying one — which would
   * otherwise appear here as a tier named "Base" beside the unconditional tier
   * this control already offers, two entries for one thing. `inCascadeOrder`
   * puts them widest-first, which is the order the cascade resolves in and the
   * order every builder surveyed presents.
   */
  const tiers = React.useMemo(() => {
    const authored = authoredBreakpoints(
      breakpoints ?? { viewport: [], container: [] }
    );
    // The viewport axis only. A container tier is a question about an element's
    // query container, which sizing the canvas cannot answer — the same
    // exclusion `canvas-width.ts` makes, for the same reason.
    return inCascadeOrder(authored.viewport);
  }, [breakpoints]);

  /*
   * The tier the box is APPLYING, and the tier the SELECTION claims.
   *
   * Two derivations rather than one, because they answer to different widths
   * and the whole point of the indicator below is the case where they differ.
   * `undefined` applied means nothing has been measured, which is a real state:
   * this control then says nothing rather than describing a box nobody looked
   * at.
   */
  const appliedTier =
    appliedWidth === undefined
      ? undefined
      : editedBreakpointAtWidth(breakpoints, appliedWidth);
  const claimedTier = editedBreakpointAtWidth(breakpoints, width);
  /*
   * Whether the width is one this control could have SET.
   *
   * A canvas can be sized to anything — a drag handle, a narrowed window, a
   * region that simply is not as wide as the widest tier's bound. Reporting the
   * derived tier as though it had been chosen would then be a claim the author
   * did not make: at 700px on a site whose tablet bound is 991, the tablet
   * rules are live and the canvas is NOT at the tablet width, and an author
   * reading a selected "Tablet" would reasonably expect the box to be 991.
   *
   * So the selection is exact-match, and a width between bounds selects
   * nothing while the tier indicator still reports what is applying. Gutenberg
   * needed the same distinction once it allowed free resizing.
   */
  const exact = tiers.some(
    tier => widthForBreakpoint(breakpoints, tier.id) === width
  );
  const atWidest = width === undefined;

  /*
   * Roving tabindex: one stop for the whole group, arrows move within it.
   *
   * A radio group that put every option in the tab order would cost a keyboard
   * user one Tab per breakpoint to cross a control they may not be using, and
   * assistive technology announces the group's size for them anyway.
   */
  /*
   * The bound comes from the COMPILER, not from the stored definition.
   *
   * They are the same number whenever the compiler accepted the definition, and
   * the case that matters is the one where it did not: `breakpointContexts`
   * applies its own reading of a stored axis, so a definition it declines to
   * emit a bounded context for has no query in the sheet at all. Sizing the
   * canvas to that stored width would put the box at a number nothing responds
   * to — the author picks a tier, the canvas resizes, and the page does not
   * change, which reads as the whole feature being broken.
   *
   * A tier the compiler emits no bound for is therefore DROPPED rather than
   * offered, which is the honest answer: there is nothing to switch to.
   */
  const options: Array<{ id: BreakpointId; label: string; bound?: number }> = [
    { id: "base", label: "Full width" },
    ...tiers
      .map(tier => ({
        id: tier.id,
        label: tier.label,
        bound: widthForBreakpoint(breakpoints, tier.id),
      }))
      .filter(
        (option): option is typeof option & { bound: number } =>
          option.bound !== undefined
      ),
  ];
  /*
   * Which option the current width CORRESPONDS to, or -1 for none.
   *
   * Separate from the keyboard's landing spot below, because they answer
   * different questions and collapsing them makes a custom width look chosen.
   * At 700px on a site whose tablet bound is 991 no option is selected — the
   * tablet rules are live and the canvas is not at the tablet width — while the
   * keyboard still needs somewhere to land.
   */
  const matchedIndex = options.findIndex(option =>
    option.bound === undefined ? atWidest : exact && option.bound === width
  );
  // Falls back to the widest, which always exists: a roving tabindex with no
  // stop at all removes the control from the tab order entirely.
  const activeIndex = matchedIndex >= 0 ? matchedIndex : 0;

  /*
   * Whether the selection already accounts for what is applying.
   *
   * Two ways it does not, and both need saying. An unmatched width — one no
   * option could have set — leaves every option unselected, and selecting
   * nothing must not mean saying nothing. And a matched option whose tier the
   * box is not actually in is the narrow-region case: the author asked for the
   * full width, the region handed the box less than the widest tier's bound,
   * and their edits are landing in a narrower tier with nothing on screen to
   * say so. That is the confusion the founder's 2026-08-24 ruling named, and
   * the reason this indicator is not merely decorative.
   */
  const describedBySelection = matchedIndex >= 0 && appliedTier === claimedTier;
  /*
   * The tier's own label, never its id. A bounded tier is found among the
   * options; anything else is the unconditional one, whose id a site may spell
   * differently and which this control already names "Full width".
   */
  const appliedLabel =
    options.find(
      option => option.bound !== undefined && option.id === appliedTier
    )?.label ?? "Full width";

  const move = (delta: number): void => {
    const next =
      options[(activeIndex + delta + options.length) % options.length];
    if (next === undefined) return;
    onSelect(next.bound);
  };

  /*
   * Nothing at all when the site defines no viewport breakpoints.
   *
   * A control offering one option is not a choice, and "Full width" alone
   * occupies top-bar space to say the canvas is the width it visibly is. The
   * manager beside it is where an author adds tiers, so the affordance is not
   * lost — it appears when there is something to switch between.
   */
  if (tiers.length === 0) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Canvas width"
      className="nx-breakpoint-switcher inline-flex items-center gap-0.5 rounded-md border p-0.5"
      onKeyDown={event => {
        if (!ready) return;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option, index) => {
        const selected = ready && index === matchedIndex;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!ready}
            /*
             * The WIDTH is in the accessible name, not only in the tooltip.
             * "Tablet" alone does not say what selecting it will do, and the
             * number is the whole content of the choice.
             */
            aria-label={
              option.bound === undefined
                ? "Full width"
                : `${option.label}, up to ${option.bound} pixels`
            }
            title={
              ready
                ? undefined
                : status === "loading"
                  ? "Available once the site's saved styles have loaded."
                  : "Your site's saved styles could not be read, so the canvas cannot be sized against them."
            }
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(option.bound)}
            className={cn(
              "rounded px-2 py-1 text-xs",
              selected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            )}
          >
            <span aria-hidden="true">{option.label}</span>
          </button>
        );
      })}
      {/*
       * What the canvas is APPLYING, shown only when the selection does not
       * already say it.
       *
       * Announced politely rather than drawn silently: which declarations are
       * live has changed, and that is exactly the fact this whole control
       * exists to make legible. Hidden when the selected option already
       * describes the applying tier — which at the widest tier is the case
       * Gutenberg found a badge actively confusing, since edits there apply to
       * every breakpoint and labelling that as a tier suggests otherwise.
       */}
      {ready && appliedTier !== undefined && !describedBySelection ? (
        <span
          className="text-muted-foreground px-1 text-xs tabular-nums"
          aria-live="polite"
        >
          {appliedWidth}px · {appliedLabel}
        </span>
      ) : null}
    </div>
  );
}
