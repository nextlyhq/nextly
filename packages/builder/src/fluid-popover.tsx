/**
 * "Fluid…" on a size: two sizes, "On small screens" and "On large screens",
 * the sentence that says what they make ("16px at 360px, growing to 20px at
 * 1280px"), and "Make fluid", which stores the size grown evenly between
 * them across the site's fluid range, with the two sizes kept beside it.
 *
 * Opened in place inside the variable's editor rather than as a second
 * popover over it, so it stays in the editor's one dialog for focus and for
 * a screen reader. A value written by hand opens on its nearest two sizes,
 * and making it fluid converts it.
 *
 * @module fluid-popover
 */
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import {
  DEFAULT_FLUID_RANGE,
  lengthInPx,
  nearestFluidSizes,
  type FluidRangeWidths,
  type FluidSizes,
} from "./fluid-size";

/** What a size field needs to offer "Fluid…". */
export interface FluidHook {
  /** The sizes the value was made from, where it was made fluid. */
  readonly sizes: FluidSizes | undefined;
  /** The value as stored, to start from where it has no sizes. */
  readonly value: string;
  readonly onFluid: (sizes: FluidSizes) => void;
  /** The site's fluid range. */
  readonly range?: FluidRangeWidths;
  /** Change the site's fluid range, from "Change range". */
  readonly onRange?: (range: FluidRangeWidths) => void;
}

/** The sizes to start from: the stored ones, else the value's nearest. */
function startingSizes(hook: FluidHook, range: FluidRangeWidths): FluidSizes {
  if (hook.sizes !== undefined) return hook.sizes;
  const nearest = nearestFluidSizes(hook.value, range);
  if (nearest !== undefined) return nearest;
  const fixed = lengthInPx(hook.value);
  return fixed === undefined
    ? { small: 16, large: 16 }
    : { small: fixed, large: fixed };
}

/** A typed size in px, or `undefined` for what is not a positive number. */
function sizeOf(text: string): number | undefined {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** "Fluid…", and its two sizes under it while it is open. */
export function FluidButton({ hook }: { hook: FluidHook }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className="nx-vars__link nx-vars-editor__fluid"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        Fluid…
      </button>
      {open ? <FluidForm hook={hook} onDone={() => setOpen(false)} /> : null}
    </>
  );
}

/** The two sizes, what they make, and "Make fluid". */
function FluidForm({
  hook,
  onDone,
}: {
  hook: FluidHook;
  onDone: () => void;
}): React.JSX.Element {
  const range = hook.range ?? DEFAULT_FLUID_RANGE;
  const start = startingSizes(hook, range);
  const [small, setSmall] = React.useState(String(start.small));
  const [large, setLarge] = React.useState(String(start.large));
  const id = React.useId();
  const sizes = { small: sizeOf(small), large: sizeOf(large) };
  const ready =
    sizes.small !== undefined && sizes.large !== undefined
      ? { small: sizes.small, large: sizes.large }
      : undefined;
  return (
    <div className="nx-fluid" role="group" aria-label="Fluid size">
      <div className="nx-fluid__sizes">
        <label className="nx-vars-editor__label" htmlFor={`${id}-small`}>
          On small screens
        </label>
        <Input
          id={`${id}-small`}
          inputMode="decimal"
          autoComplete="off"
          value={small}
          onChange={event => setSmall(event.currentTarget.value)}
        />
        <label className="nx-vars-editor__label" htmlFor={`${id}-large`}>
          On large screens
        </label>
        <Input
          id={`${id}-large`}
          inputMode="decimal"
          autoComplete="off"
          value={large}
          onChange={event => setLarge(event.currentTarget.value)}
        />
      </div>
      <p className="nx-fluid__said" role="status">
        {ready === undefined
          ? "Type two sizes in px."
          : `${String(ready.small)}px at ${String(range.min)}px, growing to ${String(ready.large)}px at ${String(range.max)}px`}
      </p>
      {hook.onRange === undefined ? null : (
        <RangeLink range={range} onRange={hook.onRange} />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="nx-vars-editor__button"
        disabled={ready === undefined}
        onClick={() => {
          if (ready === undefined) return;
          hook.onFluid(ready);
          onDone();
        }}
      >
        Make fluid
      </Button>
    </div>
  );
}

/** "Change range", and the site's fluid range under it while it is open. */
function RangeLink({
  range,
  onRange,
}: {
  range: FluidRangeWidths;
  onRange: (range: FluidRangeWidths) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className="nx-vars__link nx-fluid__range-link"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        Change range
      </button>
      {open ? (
        <FluidRangeFields range={range} onRange={onRange} readOnly={false} />
      ) : null}
    </>
  );
}

/**
 * The site's fluid range: "Smallest screen" and "Largest screen", in px.
 * Each field commits when it is left or on Enter; a range whose smallest
 * screen is not the smaller is refused in its field, saying why, and not
 * written. The one control for the range, in the Type tab and from every
 * "Fluid…".
 */
export function FluidRangeFields({
  range,
  onRange,
  readOnly,
}: {
  range: FluidRangeWidths;
  onRange: (range: FluidRangeWidths) => void;
  readOnly: boolean;
}): React.JSX.Element {
  const id = React.useId();
  const [refused, setRefused] = React.useState<"min" | "max" | undefined>();
  const commit = (end: "min" | "max", text: string): void => {
    const width = sizeOf(text);
    const next = { ...range, [end]: width };
    if (width === undefined || next.min >= next.max) {
      setRefused(end);
      return;
    }
    setRefused(undefined);
    if (next.min !== range.min || next.max !== range.max) {
      onRange({ min: next.min, max: next.max });
    }
  };
  const field = (end: "min" | "max", label: string): React.JSX.Element => (
    <>
      <label className="nx-vars-editor__label" htmlFor={`${id}-${end}`}>
        {label}
      </label>
      <Input
        id={`${id}-${end}`}
        inputMode="decimal"
        autoComplete="off"
        readOnly={readOnly}
        defaultValue={String(range[end])}
        key={`${end}-${String(range[end])}`}
        aria-invalid={refused === end ? true : undefined}
        aria-describedby={refused === end ? `${id}-said` : undefined}
        onBlur={event => commit(end, event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === "Enter") commit(end, event.currentTarget.value);
        }}
      />
    </>
  );
  return (
    <div className="nx-fluid__range" role="group" aria-label="Fluid range">
      {field("min", "Smallest screen")}
      {field("max", "Largest screen")}
      {refused === undefined ? null : (
        <p className="nx-fluid__said" id={`${id}-said`} role="status">
          The smallest screen comes first, and both are widths in px.
        </p>
      )}
    </div>
  );
}
