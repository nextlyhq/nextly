"use client";

/**
 * The submissions list's date filter: a button naming the dates shown, which
 * opens the presets and a range of days to pick from.
 *
 * @module admin/components/submissions/DateFilter
 */

import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { type JSX, useId, useState } from "react";

import { type DateChoice, dateChoiceLabel, DATE_PRESETS } from "./date-filter";

/** A range's days as the fields hold them, empty for none. */
function rangeDays(choice: DateChoice): { first: string; last: string } {
  return choice.kind === "range"
    ? { first: choice.firstDay ?? "", last: choice.lastDay ?? "" }
    : { first: "", last: "" };
}

/** Whether two days make a range: one at least, the first not after the last. */
function isRange(first: string, last: string): boolean {
  if (first === "" && last === "") return false;
  return first === "" || last === "" || first <= last;
}

/** One preset, ticked when it is the filter's. */
function PresetOption({
  label,
  chosen,
  onChoose,
}: {
  label: string;
  chosen: boolean;
  onChoose: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:font-medium"
    >
      {label}
      {chosen && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
  );
}

/** The range of days: from and to, applied together. */
function RangeFields({
  choice,
  onApply,
}: {
  choice: DateChoice;
  onApply: (first: string, last: string) => void;
}): JSX.Element {
  const id = useId();
  const [days, setDays] = useState(() => rangeDays(choice));
  const ready = isRange(days.first, days.last);
  return (
    <form
      className="space-y-3 border-t border-border p-3"
      aria-labelledby={`${id}-title`}
      onSubmit={event => {
        event.preventDefault();
        if (ready) onApply(days.first, days.last);
      }}
    >
      <p
        id={`${id}-title`}
        className="text-xs font-medium text-muted-foreground"
      >
        Between two days
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-first`}>From</Label>
          <Input
            id={`${id}-first`}
            type="date"
            value={days.first}
            max={days.last || undefined}
            onChange={event =>
              setDays(current => ({ ...current, first: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-last`}>To</Label>
          <Input
            id={`${id}-last`}
            type="date"
            value={days.last}
            min={days.first || undefined}
            onChange={event =>
              setDays(current => ({ ...current, last: event.target.value }))
            }
          />
        </div>
      </div>
      <Button type="submit" size="sm" className="w-full" disabled={!ready}>
        Show these days
      </Button>
    </form>
  );
}

export function DateFilter({
  choice,
  onChoose,
}: {
  choice: DateChoice;
  onChoose: (choice: DateChoice) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const label = dateChoiceLabel(choice);
  const choose = (next: DateChoice) => {
    onChoose(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          // Named with what it filters, and its visible words inside that
          // name, so a screen reader says what the dates are of.
          aria-label={`Date sent: ${label}`}
          className="max-w-full justify-start gap-2 px-3"
        >
          <CalendarDays
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate">{label}</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
      >
        <div role="group" aria-label="Date sent" className="p-1">
          {DATE_PRESETS.map(preset => (
            <PresetOption
              key={preset.kind}
              label={preset.label}
              chosen={choice.kind === preset.kind}
              onChoose={() => choose({ kind: preset.kind })}
            />
          ))}
        </div>
        <RangeFields
          choice={choice}
          onApply={(firstDay, lastDay) =>
            choose({
              kind: "range",
              ...(firstDay ? { firstDay } : {}),
              ...(lastDay ? { lastDay } : {}),
            })
          }
        />
      </PopoverContent>
    </Popover>
  );
}
