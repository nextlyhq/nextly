/**
 * How a colour variable's two values are drawn beside its name: a small
 * swatch for light and one for dark, in that order.
 *
 * One drawing for every list of colour variables, Design's Variables tab and
 * the inspector's colour picker among them, so a variable looks the same
 * wherever an author meets it.
 *
 * @module variable-swatch
 */
import type * as React from "react";

/** A swatch painted through a custom property, or the empty swatch. */
export function swatchStyle(
  colour: string | undefined
): React.CSSProperties | undefined {
  return colour === undefined
    ? undefined
    : ({ "--nx-swatch": colour } as React.CSSProperties);
}

/**
 * The light and dark swatches, each painted with a colour resolved by the
 * caller, or left as the empty swatch when nothing could be resolved. For
 * sight only: a list that draws these says the values in words itself.
 */
export function ColourPair({
  light,
  dark,
}: {
  light: string | undefined;
  dark: string | undefined;
}): React.JSX.Element {
  return (
    <span className="nx-vars__pair" aria-hidden="true">
      <span
        className="nx-vars__swatch nx-vars__swatch--mode"
        data-mode="light"
        style={swatchStyle(light)}
      />
      <span
        className="nx-vars__swatch nx-vars__swatch--mode"
        data-mode="dark"
        style={swatchStyle(dark)}
      />
    </span>
  );
}
