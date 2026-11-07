"use client";

/**
 * The Format row of a bound prop: how a date or a number reaches a text prop.
 *
 * A date or a number fills a text prop only through a format (the engine's
 * `fillsUnformatted`), so the row is drawn for exactly that pairing and offers
 * plain presets rather than `Intl`'s whole option list. Which presets are
 * offered is the engine's answer, not a list kept here: each is asked of
 * `checkFormat` against the prop and the bound field, so a field holding a
 * calendar date is never offered a time of day, a month never a day, and a
 * time of day never a date. A stored format is judged by the same check, so
 * one written through the API that a visitor's page would refuse is shown as
 * refused, in the words the engine gives.
 *
 * @module binding-format-field
 */
import {
  bindingKindOf,
  checkFormat,
  type BindablePropKind,
  type BindingFieldShape,
  type BindingFormat,
} from "@nextlyhq/blocks-engine";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import * as React from "react";

/** One choice in the Format menu: its words, and the format it writes. */
interface FormatPreset {
  readonly key: string;
  readonly label: string;
  readonly format: BindingFormat;
}

/** The menu's key for a currency, whose code is typed beside it. */
const CURRENCY = "currency";

/** The menu's key for a stored format no preset names. */
const STORED = "stored";

/**
 * A code `checkFormat` knows on every runtime, used only to ask whether a
 * currency format fits the field at all; the author types the real one.
 */
const PROBE_CURRENCY = "EUR";

/**
 * The presets, in the order the menu lists them. Dates: `Intl`'s own styles
 * and the parts a month is shown with. Numbers: plain, whole, percent and
 * compact, and a currency, whose code is the author's.
 */
const PRESETS: readonly FormatPreset[] = [
  {
    key: "date-long",
    label: "Long date",
    format: { type: "date", options: { dateStyle: "long" } },
  },
  {
    key: "date-short",
    label: "Short date",
    format: { type: "date", options: { dateStyle: "short" } },
  },
  {
    key: "date-full",
    label: "Weekday and date",
    format: { type: "date", options: { dateStyle: "full" } },
  },
  {
    key: "date-time",
    label: "Date and time",
    format: {
      type: "date",
      options: { dateStyle: "medium", timeStyle: "short" },
    },
  },
  {
    key: "time",
    label: "Time",
    format: { type: "date", options: { timeStyle: "short" } },
  },
  {
    key: "month-year",
    label: "Month and year",
    format: { type: "date", options: { year: "numeric", month: "long" } },
  },
  { key: "number", label: "Number", format: { type: "number" } },
  {
    key: "number-whole",
    label: "Whole number",
    format: { type: "number", options: { maximumFractionDigits: 0 } },
  },
  {
    key: "percent",
    label: "Percent",
    format: { type: "number", options: { style: "percent" } },
  },
  {
    key: "compact",
    label: "Compact (1.2K)",
    format: { type: "number", options: { notation: "compact" } },
  },
  {
    key: CURRENCY,
    label: "Currency",
    format: { type: "currency", currency: PROBE_CURRENCY },
  },
];

/** Whether a value is a plain object, as a stored format and its options are. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether two option sets hold the same keys with the same values. */
function sameOptions(a: unknown, b: unknown): boolean {
  const left = isRecord(a) ? a : {};
  const right = isRecord(b) ? b : {};
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(key => Object.is(left[key], right[key]))
  );
}

/**
 * The preset a stored format is, or `undefined` for one no preset names. A
 * currency is the currency preset whatever its code, when it sets no options
 * of its own: the code is shown and edited beside the menu.
 */
function presetKeyOf(stored: unknown): string | undefined {
  if (!isRecord(stored)) return undefined;
  if (stored.type === CURRENCY) {
    return sameOptions(stored.options, undefined) ? CURRENCY : undefined;
  }
  return PRESETS.find(
    preset =>
      preset.key !== CURRENCY &&
      preset.format.type === stored.type &&
      sameOptions(preset.format.options, stored.options)
  )?.key;
}

/**
 * The presets the engine accepts for this prop and field: a format turns a
 * value into text, so a prop that is not text is offered none, and a field
 * that is neither a date nor a number none either.
 */
function offeredPresets(
  kind: BindablePropKind | undefined,
  field: BindingFieldShape
): readonly FormatPreset[] {
  return PRESETS.filter(preset => {
    const check = checkFormat(preset.format, kind, field);
    return check.ok && check.format !== null && check.unsupported === undefined;
  });
}

/**
 * Why a stored format can't be used, in the engine's words, or `undefined`
 * when it can. A format this release does not apply leaves a date or a
 * number unformatted, which a text prop can't hold, so it is refused here too.
 */
function refusalOf(
  stored: unknown,
  kind: BindablePropKind | undefined,
  field: BindingFieldShape
): string | undefined {
  if (stored === undefined) return undefined;
  const check = checkFormat(stored, kind, field);
  if (!check.ok) return check.message;
  return check.unsupported === undefined
    ? undefined
    : `The “${check.unsupported}” format isn't applied yet, so visitors see the fallback.`;
}

/** What the bound field holds, as the note under an unset Format says it. */
function heldAs(field: BindingFieldShape): string {
  return bindingKindOf(field) === "date" ? "A date" : "A number";
}

/**
 * Whether a bound prop gets a Format row: a text prop bound to a date or a
 * number, the pairing that shows nothing without one.
 */
export function offersFormat(
  kind: BindablePropKind | undefined,
  field: BindingFieldShape | undefined
): field is BindingFieldShape {
  return field !== undefined && offeredPresets(kind, field).length > 0;
}

/** What the Format row is given. */
export interface BindingFormatFieldProps {
  /** The binding's stored format, as the document holds it. */
  readonly stored: unknown;
  /** The prop's kind, which a format has to turn the value into. */
  readonly kind: BindablePropKind | undefined;
  /** The field the binding reads. */
  readonly field: BindingFieldShape;
  readonly disabled: boolean;
  /** The id of the prop's name, which the row is about. */
  readonly describedBy: string;
  /** Write a format to the binding. */
  readonly onFormat: (format: BindingFormat) => void;
}

/** The currency code a stored currency format names, or `""`. */
function storedCurrencyCode(stored: unknown): string {
  return isRecord(stored) &&
    stored.type === CURRENCY &&
    typeof stored.currency === "string"
    ? stored.currency
    : "";
}

/**
 * The menu's value: a currency waiting for its code, the stored preset, a
 * stored format no listed preset names, or none.
 */
function menuValue(
  choosingCurrency: boolean,
  storedKey: string | undefined,
  stored: unknown
): string {
  if (choosingCurrency) return CURRENCY;
  if (storedKey !== undefined) return storedKey;
  return stored === undefined ? "" : STORED;
}

/** A currency's three-letter code, committed when it is left or on Enter. */
function CurrencyCode({
  storedCode,
  disabled,
  focusOnMount,
  errorId,
  refused,
  onCommit,
}: {
  storedCode: string;
  disabled: boolean;
  /** Take focus when drawn, for a currency just picked from the menu. */
  focusOnMount: boolean;
  errorId: string;
  refused: boolean;
  onCommit: (typed: string) => void;
}): React.JSX.Element {
  const id = React.useId();
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);
  return (
    <>
      <label className="nx-binding__fallback-label" htmlFor={id}>
        Code
      </label>
      <Input
        ref={field}
        id={id}
        key={storedCode}
        defaultValue={storedCode}
        placeholder={PROBE_CURRENCY}
        maxLength={3}
        autoCapitalize="characters"
        spellCheck={false}
        disabled={disabled}
        aria-invalid={refused ? true : undefined}
        aria-describedby={refused ? errorId : undefined}
        onBlur={event => onCommit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onCommit(event.currentTarget.value);
        }}
      />
    </>
  );
}

/** A bound date's or number's Format: a preset menu, and a currency's code. */
export function BindingFormatField({
  stored,
  kind,
  field,
  disabled,
  describedBy,
  onFormat,
}: BindingFormatFieldProps): React.JSX.Element {
  const id = React.useId();
  const noteId = React.useId();
  const errorId = `${id}-error`;
  const presets = offeredPresets(kind, field);
  // A stored preset this field can't take (a time on a calendar date) is
  // shown as set elsewhere, beside the refusal, as the menu doesn't list it.
  const named = presetKeyOf(stored);
  const storedKey = presets.some(preset => preset.key === named)
    ? named
    : undefined;
  const refusal = refusalOf(stored, kind, field);
  // A currency picked from the menu waits for its code before anything is
  // written: a currency format without one is refused.
  const [choosingCurrency, setChoosingCurrency] = React.useState(false);
  const [codeRefusal, setCodeRefusal] = React.useState<string | undefined>();
  const value = menuValue(choosingCurrency, storedKey, stored);
  const storedCode = storedCurrencyCode(stored);
  // A code is judged by the engine whatever it is, an empty one included:
  // refused, nothing is written and the reason is said. A currency only
  // picked, never stored, is let go when its code is left empty, so the menu
  // shows again what the binding holds rather than a currency it doesn't.
  const commitCode = (typed: string): void => {
    const next = typed.trim().toUpperCase();
    if (next !== "" && next === storedCode) {
      setCodeRefusal(undefined);
      return;
    }
    const format: BindingFormat = { type: "currency", currency: next };
    const check = checkFormat(format, kind, field);
    if (!check.ok) {
      setCodeRefusal(check.message);
      if (next === "" && storedKey !== CURRENCY) setChoosingCurrency(false);
      return;
    }
    setCodeRefusal(undefined);
    setChoosingCurrency(false);
    onFormat(format);
  };
  const choose = (next: string): void => {
    setCodeRefusal(undefined);
    if (next === CURRENCY) {
      setChoosingCurrency(storedKey !== CURRENCY);
      return;
    }
    const preset = presets.find(each => each.key === next);
    if (preset === undefined) return;
    setChoosingCurrency(false);
    onFormat(preset.format);
  };
  const message = codeRefusal ?? refusal;
  // Without a format the value shows nothing, so the row says so rather than
  // leaving the canvas's fallback unexplained.
  const noted = message === undefined && stored === undefined;
  const explainedBy = message !== undefined ? errorId : noted ? noteId : "";
  return (
    <div className="nx-binding__fallback nx-binding__format">
      <label className="nx-binding__fallback-label" htmlFor={id}>
        Format
      </label>
      <Select value={value} disabled={disabled} onValueChange={choose}>
        <SelectTrigger
          id={id}
          aria-invalid={refusal === undefined ? undefined : true}
          aria-describedby={`${describedBy} ${explainedBy}`.trim()}
        >
          <SelectValue placeholder="Choose a format" />
        </SelectTrigger>
        <SelectContent>
          {presets.map(preset => (
            <SelectItem key={preset.key} value={preset.key}>
              {preset.label}
            </SelectItem>
          ))}
          {value === STORED ? (
            // Shown, never offered: a format written elsewhere with options
            // no preset names, kept until the author picks another.
            <SelectItem value={STORED} disabled>
              Set elsewhere
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {value === CURRENCY ? (
        <CurrencyCode
          storedCode={storedCode}
          disabled={disabled}
          focusOnMount={choosingCurrency}
          errorId={errorId}
          refused={codeRefusal !== undefined}
          onCommit={commitCode}
        />
      ) : null}
      <FormatMessage
        message={message}
        noted={noted}
        field={field}
        errorId={errorId}
        noteId={noteId}
      />
    </div>
  );
}

/** Under the row: why a format is refused, or what an unset one means. */
function FormatMessage({
  message,
  noted,
  field,
  errorId,
  noteId,
}: {
  message: string | undefined;
  noted: boolean;
  field: BindingFieldShape;
  errorId: string;
  noteId: string;
}): React.JSX.Element | null {
  if (message !== undefined) {
    return (
      <p className="nx-inspector__error" id={errorId} role="alert">
        {message}
      </p>
    );
  }
  if (!noted) return null;
  return (
    <p className="nx-inspector__note" id={noteId}>
      {heldAs(field)} shows as text only through a format; until one is chosen,
      visitors see the fallback.
    </p>
  );
}
