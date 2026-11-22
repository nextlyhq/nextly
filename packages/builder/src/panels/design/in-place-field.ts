"use client";

/**
 * A name edited in place: its field takes focus with the name selected as it
 * opens, and the edit finishes once. Enter's own close takes the field away,
 * and the blur that follows must not keep or cancel a second time.
 *
 * @module in-place-field
 */
import * as React from "react";

export function useInPlaceField(): {
  readonly field: React.RefObject<HTMLInputElement | null>;
  /** Set once the edit has finished, kept or cancelled. */
  readonly done: React.RefObject<boolean>;
} {
  const done = React.useRef(false);
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  return { field, done };
}
