"use client";

/**
 * A card's quick setting on the card itself: the one its header draws outside customise mode,
 * the first setting its widget marks `quick` that a header can hold (`quickSettingOf`).
 *
 * Changed there, a setting applies to the card at once: it is saved for this reader and only
 * this card is asked again (`useCardQuickSetting`). The control shows the chosen value straight
 * away and goes back to the stored one if the save does not land; while a save is in flight it
 * waits, so two changes never race one version guard. Every setting, this one too, is also in
 * the card's settings drawer.
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
import type { JSX } from "react";
import { useEffect, useState } from "react";

import { useCardTier } from "../frame/tier";

import type { QuickSetting } from "./quick-setting";
import { SegmentedChoice } from "./SegmentedChoice";

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

  // A small card's header has no room beside its title: there the setting is changed in the
  // card's settings drawer, reached from its menu at every size.
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
        aria-label={name}
        options={setting.options}
        value={typeof shown === "string" ? shown : undefined}
        disabled={inert}
        title={unavailable}
        onSelect={change}
        data-testid="card-quick-segmented"
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
