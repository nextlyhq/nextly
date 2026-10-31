"use client";

/**
 * A card's quick settings on the card itself: the one drawn in its header outside customise
 * mode, and the quick popover, opened from the card's title and from Settings in its menu.
 *
 * Changed in either, a setting applies to the card at once, with the popover still open and the
 * card visible beside it: at rest it is saved for this reader and only this card is asked again,
 * while customising it is staged in the draft (`useCardQuickSetting`). The controls show the
 * chosen value straight away and go back to the stored one if the save does not land; while a
 * save is in flight they wait, so two changes never race one version guard.
 *
 * @module components/features/widgets/edit/CardQuickSetting
 */

import {
  Button,
  Label,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import type {
  ComponentPropsWithRef,
  JSX,
  KeyboardEvent,
  ReactElement,
} from "react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@admin/lib/utils";

import { useCardTier } from "../frame/tier";

import { sizeAxes, type SizeAxis } from "./CardActionsMenu";
import type { PopoverSetting, QuickSetting } from "./quick-setting";
import type { CardQuickPopoverModel } from "./useCardQuickSetting";

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
 * The card's title as the control that opens its quick popover. It reads as the title still
 * does, one line cut with an ellipsis, and its name is the title itself, so the heading and the
 * region it names keep theirs; the popup it opens is said by the trigger's own state.
 *
 * @internal Drawn by the dashboard's own cards only, never part of the widget kit.
 */
export function CardTitleButton({
  label,
  className,
  ...props
}: ComponentPropsWithRef<"button"> & { label: string }): JSX.Element {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-block max-w-full cursor-pointer truncate rounded-sm text-left align-top",
        "underline-offset-2 hover:underline",
        // Inset: the heading clips what lies outside the title to cut it with an ellipsis.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        className
      )}
      data-testid="card-title-button"
    >
      {label}
    </button>
  );
}

/** A choice in the popover: a labelled compact select. */
function ChoiceField({
  label,
  value,
  options,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly { label: string; value: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label id={labelId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger
          aria-labelledby={labelId}
          className="h-8 w-full text-sm"
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** An on/off in the popover: a labelled switch. */
function ToggleField({
  label,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label id={labelId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        data-testid={testId}
      />
    </div>
  );
}

/** One of the popover's settings, drawn by its type. */
function SettingField({
  setting,
  model,
  disabled,
}: {
  setting: PopoverSetting;
  model: CardQuickPopoverModel;
  disabled: boolean;
}) {
  const label = setting.label ?? setting.name;
  const value = model.values[setting.name];
  const testId = `card-quick-${setting.name}`;
  if (setting.type === "checkbox") {
    return (
      <ToggleField
        label={label}
        checked={value === true}
        disabled={disabled}
        onChange={checked => model.changeSetting(setting, checked)}
        testId={testId}
      />
    );
  }
  return (
    <ChoiceField
      label={label}
      value={typeof value === "string" ? value : ""}
      options={
        setting.type === "collection" ? model.collections : setting.options
      }
      disabled={disabled}
      onChange={next => model.changeSetting(setting, next)}
      testId={testId}
    />
  );
}

/** One direction of the card's size, its choices within the widget's bounds. */
function SizeField({ axis, disabled }: { axis: SizeAxis; disabled: boolean }) {
  return (
    <ChoiceField
      label={axis.label}
      value={String(axis.value)}
      options={axis.choices.map(choice => ({
        value: String(choice),
        label: axis.name(choice).spoken,
      }))}
      disabled={disabled}
      // Narrowed rather than asserted: only a size this field offered is chosen.
      onChange={next => {
        const chosen = Number(next);
        if (axis.choices.includes(chosen)) axis.choose(chosen);
      }}
      testId={`card-quick-${axis.kind}`}
    />
  );
}

export interface CardQuickPopoverProps {
  model: CardQuickPopoverModel;
  cardTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * `"trigger"`: `children` opens it, as the card's title does at rest. `"anchor"`: `children`
   * only places it, as the customise controls do, whose menu opens it.
   */
  opensFrom: "trigger" | "anchor";
  children: ReactElement;
  /** Opens the card's settings sheet, where its widget declares settings. */
  onMoreSettings?: (() => void) | undefined;
  /** The control focus goes back to when the popover closes: the one it was opened from. */
  returnFocusTo: () => HTMLElement | null;
}

/**
 * The quick popover: the card's Collection, the settings its widget marks quick and its Size,
 * then "More settings". Not modal, so the card it changes stays in view and the page usable;
 * Escape closes it and focus goes back to the control that opened it.
 */
export function CardQuickPopover({
  model,
  cardTitle,
  open,
  onOpenChange,
  opensFrom,
  children,
  onMoreSettings,
  returnFocusTo,
}: CardQuickPopoverProps): JSX.Element {
  // Set by More settings, which sends focus into the sheet it opens.
  const toSheet = useRef(false);
  // Waits while a write is in flight, and while none can be saved: it says why instead.
  const inert = model.disabled || model.unavailable !== undefined;
  const axes = model.size
    ? sizeAxes(model.size.size, model.size.bounds, model.changeSize)
    : [];
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {opensFrom === "trigger" ? (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      ) : (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      )}
      <PopoverContent
        align="start"
        collisionPadding={16}
        aria-label={`Quick settings for ${cardTitle}`}
        className="flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
        data-testid="card-quick-popover"
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (toSheet.current) {
            toSheet.current = false;
            return;
          }
          returnFocusTo()?.focus();
        }}
      >
        {model.settings.map(setting => (
          <SettingField
            key={setting.name}
            setting={setting}
            model={model}
            disabled={inert}
          />
        ))}
        {axes.map(axis => (
          <SizeField key={axis.kind} axis={axis} disabled={inert} />
        ))}
        {model.unavailable ? (
          <p className="text-xs text-muted-foreground">{model.unavailable}</p>
        ) : null}
        {onMoreSettings ? (
          <div className="-mx-3 -mb-1 border-t border-border px-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                toSheet.current = true;
                onOpenChange(false);
                onMoreSettings();
              }}
              data-testid="card-quick-more-settings"
            >
              More settings
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
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
