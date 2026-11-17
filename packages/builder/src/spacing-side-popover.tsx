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
import {
  isTokenRef,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
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
import type { ApplyTo } from "./spacing-side";
import { variablesFor, type SiteVariable } from "./style-colour";
import type { StyleControl } from "./style-controls";
import type { CommitOutcome } from "./style-field-surroundings";
import { NumericField } from "./style-numeric-field";
import { storedText } from "./style-text-field";
import { lengthInPx, variableValueText } from "./style-variables";
import { variableGroupOf } from "./tokens-studio";

/** Where focus goes as the popover closes. */
export type SideClose = "side" | "next" | "previous";

/** "None", the preset that writes nothing between the edges. */
const NONE = "none";

/** A zero length as it may be stored: "0", "0px", "0rem". */
const ZERO = /^[+-]?0*(?:\.0*)?(?:[a-z%]+)?$/i;

/**
 * The site's spacing variables, smallest first, the order a scale is read
 * in. One with no single size (fluid, or through a function) goes last.
 */
export function spacingPresets(
  control: StyleControl,
  tokens: SiteTokenSet | undefined,
  mode: ReturnType<typeof useCanvasTokenMode>
): readonly SiteVariable[] {
  const size = (variable: SiteVariable): number =>
    lengthInPx(variable.value) ?? Number.POSITIVE_INFINITY;
  return variablesFor(control.leaf, tokens, mode)
    .filter(
      variable =>
        variable.kind === "dimension" && variableGroupOf(variable) === "spacing"
    )
    .sort((a, b) => size(a) - size(b));
}

/** The preset a side holds: its variable, "None" for a zero, else none. */
function heldPreset(stored: StyleValue | undefined): string | undefined {
  if (isTokenRef(stored)) return stored.$token;
  if (stored === undefined) return undefined;
  return ZERO.test(storedText(stored)) && /\d/.test(storedText(stored))
    ? NONE
    : undefined;
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
  const write = (value: StyleValue): CommitOutcome =>
    props.onCommitSides(props.pathsFor(applyTo), value);
  // Every way of closing moves focus itself, before the popover goes, so
  // nothing is left to put it back afterwards.
  const close = (to: SideClose): void => props.onClose(to);
  return (
    <PopoverContent
      ref={content}
      className="nx-spacing-popover"
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
        close("side");
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
      onKeyDown={event =>
        popoverKeys(event, seed !== undefined, to => {
          event.preventDefault();
          close(to);
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
                close("side");
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
          onClick={() => close("side")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="nx-spacing-popover__presets">
        <span id={`${id}-presets`} className="nx-spacing-popover__label">
          Presets
        </span>
        <SegmentChoices
          options={[NONE, ...presets.map(preset => preset.identity)]}
          on={heldPreset(stored)}
          labels={presetLabels(presets)}
          labelId={`${id}-presets`}
          onChoose={choice => {
            write(choice === NONE ? "0" : { $token: choice });
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
          describedBy={undefined}
          seed={seed}
          offerVariables={false}
          onCommit={value => (value === null ? props.onCommit(null) : write(value))}
        />
      </CompactSides.Provider>
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

/** Each preset's name, then its value in a quieter tone; "None" first. */
function presetLabels(
  presets: readonly SiteVariable[]
): Readonly<Record<string, React.ReactNode>> {
  const labels: Record<string, React.ReactNode> = {
    [NONE]: (
      <>
        None <span className="nx-spacing-popover__preset-value">0</span>
      </>
    ),
  };
  for (const preset of presets) {
    labels[preset.identity] = (
      <>
        {preset.label}{" "}
        <span className="nx-spacing-popover__preset-value">
          {variableValueText(preset)}
        </span>
      </>
    );
  }
  return labels;
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
  root
    .querySelector<HTMLElement>(
      '.nx-spacing-popover__presets [role="radio"][tabindex="0"]'
    )
    ?.focus();
}

/** The popover's own keys: Tab past either end, and Enter in the number. */
function popoverKeys(
  event: React.KeyboardEvent<HTMLDivElement>,
  quick: boolean,
  close: (to: SideClose) => void
): void {
  const target = event.target as HTMLElement;
  const inNumber = isInput(target);
  // After the number's own Enter has committed it.
  if (event.key === "Enter" && inNumber) return close("side");
  if (event.key !== "Tab") return;
  if (quick && inNumber) return close(event.shiftKey ? "previous" : "next");
  const stops = tabStops(event.currentTarget);
  if (!event.shiftKey && target === stops[stops.length - 1]) {
    return close("next");
  }
  if (event.shiftKey && target === stops[0]) close("side");
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
