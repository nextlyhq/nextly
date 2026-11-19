/**
 * What the Background section's size choices write, and how a stored size
 * reads back to one of them.
 *
 * Each choice writes `background-size` and `background-repeat` together: CSS
 * repeats a background image by default, so "Fit" (`contain`) would tile the
 * image unless the same choice also stops it repeating. Where the image sits
 * is the nine-point position picker's, which the object position already uses.
 *
 * @module background-placement
 */
import { trimCssWhitespace, type StyleValue } from "@nextlyhq/blocks-engine";

/** One size choice: its button's words and what it writes. */
export interface BackgroundSizeChoice {
  readonly label: "Cover" | "Fit" | "Tile";
  /** Written to `background-size`. */
  readonly size: string;
  /** Written to `background-repeat` with it. */
  readonly repeat: string;
  /** What it does to the picture, in words, under the buttons. */
  readonly summary: string;
}

/** The three choices, in the order the buttons show them. */
export const BACKGROUND_SIZE_CHOICES: readonly BackgroundSizeChoice[] = [
  // Fills the block, cropping the image; one copy, so no repeat.
  {
    label: "Cover",
    size: "cover",
    repeat: "no-repeat",
    summary: "Fills the block; edges may be cropped",
  },
  // The whole image inside the block, once.
  {
    label: "Fit",
    size: "contain",
    repeat: "no-repeat",
    summary: "The whole image shows, once",
  },
  // The image at its own size, repeated across the block.
  {
    label: "Tile",
    size: "auto",
    repeat: "repeat",
    summary: "At its own size, repeated",
  },
];

/**
 * The choice a stored `background-size` is, `"custom"` for any other value
 * (`50%`, a variable, two sizes), or `undefined` when none is stored. Read
 * from the size alone, so a size written elsewhere reads the same whatever
 * repeat sits beside it.
 */
export function backgroundSizeChoiceOf(
  stored: StyleValue | undefined
): BackgroundSizeChoice | "custom" | undefined {
  if (stored === undefined) return undefined;
  if (typeof stored !== "string") return "custom";
  const size = trimCssWhitespace(stored).toLowerCase();
  return (
    BACKGROUND_SIZE_CHOICES.find(choice => choice.size === size) ?? "custom"
  );
}
