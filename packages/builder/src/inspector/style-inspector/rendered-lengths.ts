/**
 * The selected block's text sizes as the canvas draws them: the computed
 * font size and line height of the element it renders as, at the device
 * being edited.
 *
 * What a size field shows for a size reaching it from elsewhere when that
 * size reads a variable (Site text's `var(--…-font-size-h2)`): the size the
 * variable comes to where the author is looking, never its CSS. Carried by
 * context because only the fields that show an inherited value read it, and
 * the field table passes every field the same props.
 *
 * @module rendered-lengths
 */
import * as React from "react";

/**
 * The text sizes the canvas reads, by CSS property, with the style
 * declaration's name for each: the one list both the reading and the fields
 * showing it go by.
 */
export const RENDERED_TEXT_SIZES = {
  "font-size": "fontSize",
  "line-height": "lineHeight",
} as const;

/**
 * Computed values by CSS property, as the canvas resolved them, for the
 * properties in `RENDERED_TEXT_SIZES`. A property absent here was not read.
 */
export type RenderedLengthsValue = Readonly<Record<string, string>>;

export const RenderedLengths: React.Context<RenderedLengthsValue> =
  React.createContext<RenderedLengthsValue>({});
