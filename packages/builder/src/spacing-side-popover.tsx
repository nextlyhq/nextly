"use client";

/**
 * A spacing-box side's popover: the site's spacing variables as presets, a
 * number with its unit, and "Apply to", which writes the value to this side,
 * it and the one across, or all four, as one edit.
 *
 * Non-modal, and never a trap. Opened by a digit, it is quick entry: Tab or
 * Enter commits, and Tab goes on to the next side. Opened by a click or
 * Enter, Tab walks its controls and, past the last, goes on to the next
 * side. Escape closes it and returns to the side.
 *
 * @module spacing-side-popover
 */
import type { SiteTokenSet, StyleValue } from "@nextlyhq/blocks-engine";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PopoverContent,
} from "@nextlyhq/ui";
import { MoreHorizontal, X } from "lucide-react";
import * as React from "react";

import { useCanvasTokenMode } from "./canvas/prefers-dark";
import { isElement, isInput } from "./dom-kind";
import { SegmentChoices } from "./segment-choices";
import { CompactSides } from "./spacing-box";
import {
  identityOfKey,
  NONE,
  offeredPreset,
  presetKey,
  presetLabels,
  spacingPresets,
} from "./spacing-presets";
import type { ApplyTo } from "./spacing-side";
import type { StyleControl } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { NumericField } from "./style-numeric-field";

/** Where focus goes as the popover closes. */
export type SideClose = "side" | "next" | "previous";

/**
 * What the number's commit comes to as the popover closes.
 *
 * Right after an Enter in the number, the commit that Enter made says, and
 * nothing is committed again: a second commit in the same key press is built
 * before the editor has drawn the first, from the document as it was, and is
 * refused. A number still being typed (Tab in quick entry) is committed by
 * taking focus off it, to no other element, so the popover isn't left.
 * Anywhere else nothing is pending, so an earlier refusal never holds the
 * popover open.
 */
function commitTyped(
  root: HTMLElement | null,
  outcome: React.RefObject<CommitOutcome | undefined>,
  afterEnter: boolean
): CommitOutcome | undefined {
  if (afterEnter) return outcome.current;
  const active = root?.ownerDocument.activeElement;
  if (root === null || !isInput(active) || !root.contains(active)) {
    return undefined;
  }
  outcome.current = undefined;
  active.blur();
  const result = outcome.current;
  if (result === "refused") active.focus();
  return result;
}

/** What the popover is given. */
export interface SpacingSidePopoverProps {
  /** The side's name, its title: "Padding top". */
  readonly name: string;
  readonly control: StyleControl;
  readonly stored: StyleValue | undefined;
  readonly tokens: SiteTokenSet | undefined;
  /** The digit it opened typing, for quick entry. */
  readonly seed: string | undefined;
  readonly applyTo: ApplyTo;
  readonly pairLabel: string;
  readonly pathsFor: (applyTo: ApplyTo) => readonly (readonly string[])[];
  readonly onApplyTo: (next: ApplyTo) => void;
  readonly onCommit: (value: StyleValue | null) => CommitOutcome;
  readonly onCommitSides: (
    paths: readonly (readonly string[])[],
    value: StyleValue
  ) => CommitOutcome;
  readonly onReset: () => void;
  readonly onClose: (to: SideClose) => void;
  /** Why the side's last write was refused, said in the popover. */
  readonly refusal: string | null;
  /** The side it opened from, whose own click closes it. */
  readonly side: React.RefObject<HTMLButtonElement | null>;
}

export function SpacingSidePopover(
  props: SpacingSidePopoverProps
): React.JSX.Element {
  const { name, control, stored, seed, applyTo } = props;
  const id = React.useId();
  const content = React.useRef<HTMLDivElement>(null);
  const mode = useCanvasTokenMode();
  const presets = spacingPresets(control, props.tokens, mode);
  // What the number's last commit came to: a refused one keeps the popover
  // open with the draft, so the author can correct it.
  const outcome = React.useRef<CommitOutcome | undefined>(undefined);
  const record = (result: CommitOutcome): CommitOutcome => {
    outcome.current = result;
    return result;
  };
  /*
   * The write just made, for the rest of the event that made it. Closing
   * moves focus off a number committed by Enter, and its blur commits it
   * again in the same key press, before the editor has drawn the first:
   * built from the page as it was, that second write is refused. A write the
   * same as the one just made is therefore not made again in that event;
   * cleared once the event is done, so the same value chosen again later (an
   * undo between) writes as it should.
   */
  const lastWritten = React.useRef<string | null>(null);
  const write = (value: StyleValue): CommitOutcome => {
    const paths = props.pathsFor(applyTo);
    const key = JSON.stringify([paths, value]);
    if (key === lastWritten.current) return record("unchanged");
    const result = props.onCommitSides(paths, value);
    if (result === "applied") {
      lastWritten.current = key;
      queueMicrotask(() => {
        lastWritten.current = null;
      });
    }
    return record(result);
  };
  /*
   * Every way of closing moves focus itself, before the popover goes, so
   * nothing is left to put it back afterwards. A number still being typed is
   * committed first, by moving focus off it within the popover, and a refused
   * commit keeps the popover open on it.
   */
  const close = (to: SideClose, afterEnter = false): void => {
    if (commitTyped(content.current, outcome, afterEnter) === "refused") {
      return;
    }
    props.onClose(to);
  };
  // Escape, ✕ and Reset close whatever the number holds: the author is
  // leaving it, and its refusal is still said under the side.
  const leave = (to: SideClose): void => props.onClose(to);
  return (
    <PopoverContent
      ref={content}
      // Drawn at the page's end, outside the builder's element: the class
      // brings the builder's tokens (its borders, the shared green) with it.
      className="nx-builder-tokens nx-spacing-popover"
      side="bottom"
      align="center"
      collisionPadding={8}
      aria-labelledby={`${id}-title`}
      onOpenAutoFocus={event => {
        event.preventDefault();
        focusStart(content.current, seed);
      }}
      onEscapeKeyDown={event => {
        event.preventDefault();
        leave("side");
      }}
      // A click elsewhere leaves focus where it went.
      onCloseAutoFocus={event => event.preventDefault()}
      // A press on the side is the side's own toggle, which closes it.
      onInteractOutside={event => {
        const at = event.target;
        if (isElement(at) && props.side.current?.contains(at) === true) {
          event.preventDefault();
        }
      }}
      // An Enter in the number starts with no outcome, so the one it reads
      // after is the commit that Enter made, or none where nothing changed.
      onKeyDownCapture={event => {
        if (event.key === "Enter" && isInput(event.target)) {
          outcome.current = undefined;
        }
      }}
      onKeyDown={event =>
        popoverKeys(event, seed !== undefined, (to, afterEnter) => {
          event.preventDefault();
          close(to, afterEnter);
        })
      }
    >
      <div className="nx-spacing-popover__head">
        <h3 id={`${id}-title`} className="nx-spacing-popover__title">
          {name}
        </h3>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="nx-spacing-popover__icon"
              aria-label={`More for ${name}`}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={stored === undefined}
              onSelect={() => {
                props.onReset();
                leave("side");
              }}
            >
              Reset
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="nx-spacing-popover__icon"
          aria-label="Close"
          onClick={() => leave("side")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="nx-spacing-popover__presets">
        <span id={`${id}-presets`} className="nx-spacing-popover__label">
          Presets
        </span>
        <SegmentChoices
          options={[NONE, ...presets.map(preset => presetKey(preset.identity))]}
          on={offeredPreset(stored, presets)}
          labels={presetLabels(presets)}
          labelId={`${id}-presets`}
          onChoose={choice => {
            const identity = identityOfKey(choice);
            write(identity === undefined ? "0" : { $token: identity });
          }}
        />
      </div>
      <label htmlFor={`${id}-number`} className="nx-spacing-popover__hidden">
        {`Value for ${name}`}
      </label>
      {/* With its unit menu, which the box's own sides have no room for. */}
      <CompactSides.Provider value={false}>
        <NumericField
          id={`${id}-number`}
          control={control}
          stored={stored}
          tokens={props.tokens}
          actionName={name}
          describedBy={props.refusal === null ? undefined : `${id}-refusal`}
          seed={seed}
          offerVariables={false}
          onCommit={value =>
            value === null ? record(props.onCommit(null)) : write(value)
          }
        />
      </CompactSides.Provider>
      {props.refusal === null ? null : (
        <p
          id={`${id}-refusal`}
          className="nx-spacing-popover__refusal"
          role="alert"
        >
          {props.refusal}
        </p>
      )}
      <span id={`${id}-apply`} className="nx-spacing-popover__label">
        Apply to
      </span>
      <SegmentChoices
        options={["side", "pair", "all"] as const}
        on={applyTo}
        labels={{
          side: "This side",
          pair: props.pairLabel,
          all: "All sides",
        }}
        labelId={`${id}-apply`}
        onChoose={next => {
          props.onApplyTo(next);
          // The side's value goes to the sides now included, at once.
          if (stored !== undefined && next !== "side") {
            props.onCommitSides(props.pathsFor(next), stored);
          }
        }}
      />
    </PopoverContent>
  );
}

/**
 * Where focus starts: in the number, after the digit typed, for quick entry;
 * otherwise on the chosen preset, or the first.
 */
function focusStart(root: HTMLElement | null, seed: string | undefined): void {
  if (root === null) return;
  if (seed !== undefined) {
    const input = root.querySelector<HTMLInputElement>("input");
    input?.focus();
    // After the seeded draft has drawn, the caret after it.
    requestAnimationFrame(() => {
      const end = input?.value.length ?? 0;
      input?.setSelectionRange(end, end);
    });
    return;
  }
  // The marked preset, or the first; the number where there is no preset.
  (
    root.querySelector<HTMLElement>(
      '.nx-spacing-popover__presets [role="radio"][tabindex="0"]'
    ) ?? root.querySelector<HTMLElement>("input")
  )?.focus();
}

/** The popover's own keys: Tab past either end, and Enter in the number. */
function popoverKeys(
  event: React.KeyboardEvent<HTMLDivElement>,
  quick: boolean,
  close: (to: SideClose, afterEnter?: boolean) => void
): void {
  const target = event.target as HTMLElement;
  const inNumber = isInput(target);
  // After the number's own Enter has committed it.
  if (event.key === "Enter" && inNumber) return close("side", true);
  if (event.key !== "Tab") return;
  const to =
    quick && inNumber
      ? quickTab(event.shiftKey)
      : tabPastEnd(event.currentTarget, target, event.shiftKey);
  if (to !== undefined) close(to);
}

/** Tab in quick entry: on to the next side, or back to the one before. */
function quickTab(back: boolean): SideClose {
  return back ? "previous" : "next";
}

/**
 * Tab past the popover's last control goes on to the next side, and Shift+Tab
 * before its first goes back to its own; anywhere else Tab moves as usual.
 */
function tabPastEnd(
  root: HTMLElement,
  target: HTMLElement,
  back: boolean
): SideClose | undefined {
  const stops = tabStops(root);
  if (!back && target === stops[stops.length - 1]) return "next";
  if (back && target === stops[0]) return "side";
  return undefined;
}

/** The popover's Tab stops, in order. */
function tabStops(root: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("button, input, [tabindex]")
  ).filter(
    element =>
      element.tabIndex >= 0 &&
      !(element as HTMLButtonElement).disabled &&
      !element.hidden
  );
}
