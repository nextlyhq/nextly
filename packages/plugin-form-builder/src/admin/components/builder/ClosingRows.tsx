"use client";

/**
 * The two ways a live form closes by itself, in Settings' Availability: on a
 * date, and once it has a number of submissions. Each is off until switched
 * on, which fills in a value to change, and switching it off clears it.
 *
 * @module admin/components/builder/ClosingRows
 */
import { Input, Switch } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { useFormBuilder } from "../../context/FormBuilderContext";

import { descriptionIdOf, SettingRow } from "./settings-rows";

/** What a new limit starts at, to be changed. */
const DEFAULT_LIMIT = 100;

/** Two digits, as a date-and-time input writes them. */
const two = (n: number) => String(n).padStart(2, "0");

/**
 * An instant as the author's date-and-time input shows it, in their own time
 * zone; empty when it is not a readable instant.
 */
function toLocalInput(iso: string | undefined): string {
  const date = iso === undefined ? undefined : new Date(iso);
  if (date === undefined || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** What the author typed, read in their time zone, as the instant stored. */
function fromLocalInput(value: string): string | undefined {
  const date = new Date(value);
  return value === "" || Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

/** A week from now, on the hour: a closing time to change. */
function aWeekFromNow(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

/** A whole number above zero, or nothing. */
function asLimit(value: string): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * What a field shows while a person types: their own text, stored once it
 * reads as a value, so a field can be emptied and typed again. A change to
 * the stored value from elsewhere (Undo, a switch) replaces it, and leaving
 * the field puts back the stored value if the text never became one.
 */
function useDraft(stored: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    setDraft(stored);
  }
  return {
    value: draft,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      commit(event.target.value);
    },
    onBlur: () => setDraft(stored),
  };
}

export function ClosingTimeRow(): JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  const on = settings.closesAt !== undefined;
  const field = useDraft(toLocalInput(settings.closesAt), text => {
    const closesAt = fromLocalInput(text);
    if (closesAt !== undefined) updateSettings({ closesAt });
  });
  return (
    <SettingRow
      label="Close on a date"
      htmlFor="settings-closes-on"
      description="Closes by itself at this time, in your time zone. Visitors then see the closed message."
    >
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <Input
            type="datetime-local"
            aria-label="Closing date and time"
            className="w-auto"
            {...field}
          />
        ) : null}
        <Switch
          id="settings-closes-on"
          aria-describedby={descriptionIdOf("settings-closes-on")}
          checked={on}
          onCheckedChange={next =>
            updateSettings({ closesAt: next ? aWeekFromNow() : undefined })
          }
        />
      </div>
    </SettingRow>
  );
}

export function SubmissionLimitRow(): JSX.Element {
  const { settings, updateSettings } = useFormBuilder();
  const on = settings.submissionLimit !== undefined;
  const field = useDraft(String(settings.submissionLimit ?? ""), text => {
    const submissionLimit = asLimit(text);
    if (submissionLimit !== undefined) updateSettings({ submissionLimit });
  });
  return (
    <SettingRow
      label="Limit the number of submissions"
      htmlFor="settings-limit-on"
      description="Closes once this many arrive. Spam does not count. Whichever comes first, the date or the limit, closes it."
    >
      <div className="flex flex-wrap items-center gap-3">
        {on ? (
          <Input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            aria-label="Submission limit"
            className="w-24"
            {...field}
          />
        ) : null}
        <Switch
          id="settings-limit-on"
          aria-describedby={descriptionIdOf("settings-limit-on")}
          checked={on}
          onCheckedChange={next =>
            updateSettings({
              submissionLimit: next ? DEFAULT_LIMIT : undefined,
            })
          }
        />
      </div>
    </SettingRow>
  );
}
