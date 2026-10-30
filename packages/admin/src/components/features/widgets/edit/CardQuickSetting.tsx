"use client";

/**
 * A card's quick setting, drawn in its header outside customise mode.
 *
 * Changed here, it is saved at once, for this reader, and only this card is asked again. The
 * control shows the chosen value straight away and goes back to the stored one if the save does
 * not land; while a save is in flight it waits, so two changes never race one version guard.
 *
 * @module components/features/widgets/edit/CardQuickSetting
 */

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { JSX, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@admin/lib/utils";

import { useCardTier } from "../frame/tier";

import type { QuickSetting } from "./quick-setting";

export interface CardQuickSettingProps {
  setting: QuickSetting;
  /** The value the card is using now: the stored one, or the declared default. */
  value: unknown;
  /** The card's title, so the control's name says which card it changes. */
  cardTitle: string;
  /** Another layout write is in flight. */
  disabled: boolean;
  /** Why a change cannot be saved now, when it cannot. */
  unavailable?: string;
  /** Save `value`; `reverted` is called when it did not land. */
  onChange: (value: string | boolean, reverted: () => void) => void;
}

export function CardQuickSetting({
  setting,
  value,
  cardTitle,
  disabled,
  unavailable,
  onChange,
}: CardQuickSettingProps): JSX.Element | null {
  // Shown at once, ahead of the save; the stored value takes over again whenever it changes.
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);

  // A small card's header has no room beside its title: there the setting is reached through
  // the card's menu instead, which is drawn at every size.
  const tier = useCardTier();

  const label = setting.label ?? setting.name;
  const name = `${label} for ${cardTitle}`;
  const inert = disabled || unavailable !== undefined;
  const change = (next: string | boolean) => {
    setShown(next);
    onChange(next, () => setShown(value));
  };

  if (tier === "small") return null;

  if (setting.type === "checkbox") {
    const on = shown === true;
    return (
      <Button
        type="button"
        size="sm"
        variant={on ? "secondary" : "ghost"}
        aria-pressed={on}
        aria-label={name}
        title={unavailable}
        disabled={inert}
        onClick={() => change(!on)}
      >
        {label}
      </Button>
    );
  }

  // A choice of exactly two is drawn as both choices, side by side, so the one not chosen is
  // one press away and in view; a longer list keeps the compact menu.
  if (setting.options.length === 2) {
    return (
      <SegmentedChoice
        name={name}
        options={setting.options}
        value={typeof shown === "string" ? shown : undefined}
        inert={inert}
        title={unavailable}
        onSelect={change}
      />
    );
  }

  return (
    <Select
      value={typeof shown === "string" ? shown : ""}
      disabled={inert}
      onValueChange={change}
    >
      <SelectTrigger
        aria-label={name}
        title={unavailable}
        className="h-7 w-auto gap-1 px-2 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {setting.options.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Where a key moves the choice in a group of `count`, from `index`, as a radio group moves:
 * the arrows to the next or previous choice, wrapping, and Home and End to the first and last.
 * `undefined` for any other key.
 */
function segmentFor(
  key: string,
  index: number,
  count: number
): number | undefined {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/**
 * A choice drawn as a segmented control: a radio group named for the setting and its card, one
 * radio per option, the chosen one raised on the muted track. Only the chosen radio is in the
 * tab order (the first, while none is chosen), and the arrows, Home and End move to another
 * choice and choose it, as a radio group does. Its height is the menu trigger's, so the card's
 * header keeps its own. While the setting cannot change, every radio is disabled, as the menu is.
 */
function SegmentedChoice({
  name,
  options,
  value,
  inert,
  title,
  onSelect,
}: {
  name: string;
  options: readonly { label: string; value: string }[];
  value: string | undefined;
  inert: boolean;
  title: string | undefined;
  onSelect: (next: string) => void;
}): JSX.Element {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex(option => option.value === value);
  const tabbable = chosen === -1 ? 0 : chosen;

  const choose = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    radios.current[index]?.focus();
    if (option.value !== value) onSelect(option.value);
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const next = segmentFor(event.key, index, options.length);
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-disabled={inert || undefined}
      title={title}
      data-testid="card-quick-segmented"
      className="inline-flex h-7 items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {options.map((option, index) => {
        const checked = index === chosen;
        return (
          <button
            key={option.value}
            ref={element => {
              radios.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabbable ? 0 : -1}
            disabled={inert}
            onClick={() => choose(index)}
            onKeyDown={event => onKeyDown(event, index)}
            className={cn(
              "h-full rounded-sm px-2 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              checked
                ? "bg-background font-semibold text-foreground shadow-sm"
                : "font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
