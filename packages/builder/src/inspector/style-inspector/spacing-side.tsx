"use client";

/**
 * A side of the spacing box: a button showing the side's value whole, which
 * opens the side's popover (`spacing-side-popover.tsx`) to choose a preset,
 * type a value or apply it to several sides.
 *
 * Its keys: a click or Enter opens the popover on its presets, a digit opens
 * it typing that digit, and Tab from there commits and moves to the next
 * side, so "4 0 Tab 4 0 Tab" goes round the box. Alt+Backspace and the
 * side's context menu reset it, as its field's reset does.
 *
 * @module spacing-side
 */
import {
  isTokenRef,
  type SiteTokenSet,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Popover,
  PopoverAnchor,
  TooltipProvider,
} from "@nextlyhq/ui";
import * as React from "react";

import { useCanvasTokenMode } from "../../canvas/prefers-dark";
import { ChromeTooltip } from "../../chrome-tooltip";
import { variableFor, variableLabel, variablesFor } from "../../style-colour";
import type { StyleControl } from "../../style-controls";
import { sideOf, type LogicalSide, type SideBox } from "../../style-sides";

import { variableRead } from "./site-default-source";
import { SpacingSidePopover, type SideClose } from "./spacing-side-popover";
import {
  TokenPrefixContext,
  type CommitOutcome,
} from "./style-field-surroundings";
import { storedText } from "./style-text-field";

/** Which sides a value goes to: this one, it and the one across, or all four. */
export type ApplyTo = "side" | "pair" | "all";

const ApplyToContext = React.createContext<
  readonly [ApplyTo, (next: ApplyTo) => void] | undefined
>(undefined);

/**
 * "Apply to", remembered while the panel is open: a choice made on one side
 * holds for the next side and the next block, until the panel closes.
 */
export function SpacingApplyToProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [applyTo, setApplyTo] = React.useState<ApplyTo>("side");
  const value = React.useMemo(() => [applyTo, setApplyTo] as const, [applyTo]);
  return (
    <ApplyToContext.Provider value={value}>{children}</ApplyToContext.Provider>
  );
}

/** "Apply to" from the panel, or the side's own where no panel holds it. */
function useApplyTo(): readonly [ApplyTo, (next: ApplyTo) => void] {
  const shared = React.useContext(ApplyToContext);
  const local = React.useState<ApplyTo>("side");
  return shared ?? local;
}

/** The ring a side is drawn in: its sides, in Tab order, and their axes. */
export const SpacingRingContext: React.Context<SideBox | undefined> =
  React.createContext<SideBox | undefined>(undefined);

const ACROSS: Readonly<Record<LogicalSide, LogicalSide>> = {
  blockStart: "blockEnd",
  blockEnd: "blockStart",
  inlineStart: "inlineEnd",
  inlineEnd: "inlineStart",
};

/** The paths a value chosen at this side is written to. */
function appliedPaths(
  box: SideBox | undefined,
  control: StyleControl,
  applyTo: ApplyTo
): readonly (readonly string[])[] {
  if (box === undefined || applyTo === "side") return [control.path];
  if (applyTo === "all") return box.controls.map(each => each.path);
  const side = sideOf(box, control);
  const across = box.controls.find(
    each => side !== undefined && sideOf(box, each) === ACROSS[side]
  );
  return across === undefined ? [control.path] : [control.path, across.path];
}

/**
 * The words for a side and the one across from it, as the box shows them:
 * the block sides are top and bottom where lines run across, and left and
 * right where they run down.
 */
function pairLabel(
  box: SideBox | undefined,
  control: StyleControl
): "Top & bottom" | "Left & right" {
  const side = box === undefined ? undefined : sideOf(box, control);
  const block = side === undefined || side.startsWith("block");
  const across =
    (box?.axes?.writingMode ?? "horizontal-tb") === "horizontal-tb";
  return block === across ? "Top & bottom" : "Left & right";
}

/** What a side shows: its value, a variable's name, or what reaches it. */
interface SideText {
  readonly text: string;
  /** The whole value, as it is read out. */
  readonly spoken: string;
  readonly bound: boolean;
  readonly unset: boolean;
}

function useSideText(
  control: StyleControl,
  stored: StyleValue | undefined,
  inherited: string | undefined,
  tokens: SiteTokenSet | undefined
): SideText {
  const mode = useCanvasTokenMode();
  const tokenPrefix = React.useContext(TokenPrefixContext);
  if (isTokenRef(stored)) {
    const variable = variableFor(stored.$token, tokens, mode);
    const named =
      variable === undefined
        ? stored.$token
        : variableLabel(variable, variablesFor(control.leaf, tokens, mode));
    const text =
      stored.times === undefined ? named : `${named} × ${String(stored.times)}`;
    return { text, spoken: text, bound: true, unset: false };
  }
  if (stored === undefined) {
    if (inherited === undefined) {
      return { text: "–", spoken: "not set", bound: false, unset: true };
    }
    const text = inheritedText(control, inherited, tokens, mode, tokenPrefix);
    return { text, spoken: text, bound: false, unset: true };
  }
  const text = storedText(stored);
  return { text, spoken: text, bound: false, unset: false };
}

/**
 * What a side shows of a value reaching it from another tier: a site setting
 * is named as its variable, as a value set from one is, rather than as the
 * CSS that reads it; anything else as it was written.
 */
function inheritedText(
  control: StyleControl,
  inherited: string,
  tokens: SiteTokenSet | undefined,
  mode: ReturnType<typeof useCanvasTokenMode>,
  tokenPrefix: string
): string {
  const read = variableRead(inherited, tokenPrefix);
  const variable =
    read === undefined ? undefined : variableFor(read, tokens, mode);
  return variable === undefined
    ? inherited
    : variableLabel(variable, variablesFor(control.leaf, tokens, mode));
}

/** A digit, a point or a minus sign: the start of a value typed on a side. */
function quickKey(event: React.KeyboardEvent): string | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  return /^[\d.-]$/.test(event.key) ? event.key : undefined;
}

/** The side a step away in the box's Tab order, if there is one. */
function sideAfter(from: HTMLElement, step: 1 | -1): HTMLElement | undefined {
  const sides = Array.from(
    from
      .closest(".nx-spacing-box")
      ?.querySelectorAll<HTMLElement>(".nx-spacing-side") ?? []
  );
  return sides[sides.indexOf(from) + step];
}

/** What a side is given. */
export interface SpacingSideProps {
  /** The field's id: the side's label is for it. */
  readonly id: string;
  /** The id of the side's label, "Margin top". */
  readonly labelledBy: string;
  /** The side's name, which titles its popover. */
  readonly name: string;
  readonly control: StyleControl;
  readonly stored: StyleValue | undefined;
  /** The value reaching the side from another tier, while none is set here. */
  readonly inherited: string | undefined;
  readonly tokens: SiteTokenSet | undefined;
  readonly describedBy: string | undefined;
  /** Why the side's last write was refused, if it was. */
  readonly refusal: string | null;
  readonly onCommit: (value: StyleValue | null) => CommitOutcome;
  readonly onCommitSides: (
    paths: readonly (readonly string[])[],
    value: StyleValue
  ) => CommitOutcome;
}

/** Whether the popover is open, and the digit it opened typing. */
type Opened = false | { readonly seed: string | undefined };

export function SpacingSide(props: SpacingSideProps): React.JSX.Element {
  const { id, labelledBy, name, control, stored, describedBy } = props;
  const box = React.useContext(SpacingRingContext);
  const [applyTo, setApplyTo] = useApplyTo();
  const shown = useSideText(control, stored, props.inherited, props.tokens);
  const [opened, setOpened] = React.useState<Opened>(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const truncated = useTruncated();
  const valueId = `${id}-value`;
  const reset = (): void => {
    props.onCommit(null);
  };
  const close = (to: SideClose): void => {
    const side = button.current;
    // Focus moves first, so a number still being typed commits on its blur.
    const next =
      side === null || to === "side"
        ? side
        : (sideAfter(side, to === "next" ? 1 : -1) ?? side);
    next?.focus();
    setOpened(false);
  };
  return (
    <Popover
      open={opened !== false}
      onOpenChange={open => {
        if (!open) setOpened(false);
      }}
      modal={false}
    >
      <ContextMenu>
        <TooltipProvider delayDuration={300}>
          <ChromeTooltip content={shown.text} disabled={!truncated.is}>
            <PopoverAnchor asChild>
              <ContextMenuTrigger asChild>
                <button
                  ref={button}
                  id={id}
                  type="button"
                  className="nx-spacing-side"
                  data-bound={shown.bound ? "" : undefined}
                  data-unset={shown.unset ? "" : undefined}
                  data-open={opened === false ? undefined : ""}
                  aria-labelledby={`${labelledBy} ${valueId}`}
                  aria-describedby={describedBy}
                  aria-haspopup="dialog"
                  aria-expanded={opened !== false}
                  onPointerEnter={truncated.measure}
                  onFocus={truncated.measure}
                  onClick={() =>
                    setOpened(opened === false ? { seed: undefined } : false)
                  }
                  onKeyDown={event => {
                    const seed = quickKey(event);
                    if (seed === undefined) return;
                    event.preventDefault();
                    setOpened({ seed });
                  }}
                >
                  <span className="nx-spacing-side__text">{shown.text}</span>
                </button>
              </ContextMenuTrigger>
            </PopoverAnchor>
          </ChromeTooltip>
        </TooltipProvider>
        <ContextMenuContent>
          <ContextMenuItem disabled={stored === undefined} onSelect={reset}>
            Reset
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {/* The whole value, which the side's name ends with. */}
      <span id={valueId} hidden>
        {shown.spoken}
      </span>
      {opened === false ? null : (
        <SpacingSidePopover
          name={name}
          control={control}
          stored={stored}
          tokens={props.tokens}
          seed={opened.seed}
          applyTo={applyTo}
          pairLabel={pairLabel(box, control)}
          pathsFor={to => appliedPaths(box, control, to)}
          onApplyTo={setApplyTo}
          onCommit={props.onCommit}
          onCommitSides={props.onCommitSides}
          onReset={reset}
          onClose={close}
          refusal={props.refusal}
          side={button}
        />
      )}
    </Popover>
  );
}

/**
 * Whether a side's text is cut short, measured when it is pointed at or
 * focused: only then does its tooltip say the whole value.
 */
function useTruncated(): {
  is: boolean;
  measure: (event: React.SyntheticEvent<HTMLElement>) => void;
} {
  const [is, setIs] = React.useState(false);
  return {
    is,
    measure: event => {
      const text = event.currentTarget.querySelector(".nx-spacing-side__text");
      setIs(text !== null && text.scrollWidth > text.clientWidth);
    },
  };
}
