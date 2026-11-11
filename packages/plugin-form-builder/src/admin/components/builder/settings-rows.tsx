"use client";

/**
 * The rows Settings is drawn with: a setting's name and what it does on the
 * left with its control on the right, or stacked when the control needs the
 * width (a message, a list of choices). Every section uses these, so the page
 * reads as one list whatever the setting.
 *
 * @module admin/components/builder/settings-rows
 */
import { Label, RadioGroup, RadioGroupItem } from "@nextlyhq/ui";
import type { JSX, ReactNode } from "react";

/** The id of a setting's description, for its control's `aria-describedby`. */
export function descriptionIdOf(htmlFor: string): string {
  return `${htmlFor}-description`;
}

export interface SettingRowProps {
  label: ReactNode;
  /** What the setting does; read out with the control it describes. */
  description?: ReactNode;
  /** The control's id. Its description is `descriptionIdOf(htmlFor)`. */
  htmlFor?: string;
  /** Put the control under the text, at the row's full width. */
  stack?: boolean;
  children: ReactNode;
}

export function SettingRow({
  label,
  description,
  htmlFor,
  stack = false,
  children,
}: SettingRowProps): JSX.Element {
  return (
    // The section spaces its rows; a row that padded itself would double it.
    <div
      className={
        stack
          ? "flex flex-col gap-3"
          : "flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6"
      }
    >
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={htmlFor} className="text-sm font-semibold">
          {label}
        </Label>
        {description ? (
          <p
            id={htmlFor ? descriptionIdOf(htmlFor) : undefined}
            className="max-w-prose text-xs leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      <div
        className={
          stack ? undefined : "flex shrink-0 items-center sm:justify-end"
        }
      >
        {children}
      </div>
    </div>
  );
}

/** One choice of a `ChoiceCards` list. */
export interface Choice<Value extends string> {
  value: Value;
  title: string;
  description?: ReactNode;
  disabled?: boolean;
  /** Shown under the choice whether or not it is chosen. */
  note?: ReactNode;
  /** Shown under the choice once it is chosen: its message, address, page. */
  details?: ReactNode;
}

export interface ChoiceCardsProps<Value extends string> {
  /** Names the group; each choice's id starts with it. */
  name: string;
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  choices: readonly Choice<Value>[];
}

/**
 * A choice of one among a few, each a card with what it means, and the chosen
 * one opening to show what it needs. Cards rather than bare radio buttons,
 * because each choice carries a sentence and, once chosen, a control.
 */
export function ChoiceCards<Value extends string>({
  name,
  label,
  value,
  onChange,
  choices,
}: ChoiceCardsProps<Value>): JSX.Element {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={next => {
        // Only a value one of the choices carries.
        const chosen = choices.find(choice => choice.value === next);
        if (chosen) onChange(chosen.value);
      }}
      className="flex flex-col gap-2"
    >
      {choices.map(choice => {
        const id = `${name}-${choice.value}`;
        const chosen = choice.value === value;
        return (
          <div
            key={choice.value}
            className={`flex items-start gap-3 rounded-md border bg-background px-3 py-2.5 ${
              chosen ? "border-foreground" : "border-border"
            }`}
          >
            <RadioGroupItem
              value={choice.value}
              id={id}
              disabled={choice.disabled}
              aria-describedby={
                choice.description ? descriptionIdOf(id) : undefined
              }
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <Label
                htmlFor={id}
                className={
                  choice.disabled
                    ? "text-sm font-semibold text-muted-foreground"
                    : "text-sm font-semibold"
                }
              >
                {choice.title}
              </Label>
              {choice.description ? (
                <p
                  id={descriptionIdOf(id)}
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  {choice.description}
                </p>
              ) : null}
              {choice.note}
              {chosen && choice.details ? (
                <div className="pt-1">{choice.details}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </RadioGroup>
  );
}
