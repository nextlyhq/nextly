/**
 * The looks the core blocks ship with: each block's own look, named, and its
 * named variants, which a site receives as shared styles bound to the block
 * type (`blockLooks`) and may edit in Design.
 *
 * Built from the site's tokens, so a look follows the site's colours rather
 * than carrying colours of its own. Each block's own look is its base styles
 * (`isDefault`): wearing it is wearing no look.
 *
 * @module looks
 * @experimental
 */

import type { BlockVariation, NodeStyles } from "@nextlyhq/blocks-engine";

/** A look as declared here: a name, its words, and its styles or none. */
interface LookSeed {
  readonly name: string;
  readonly label: string;
  readonly styles?: NodeStyles;
  readonly isDefault?: true;
}

/** Looks as a block's variations, typed for its own props (looks carry none). */
function looksOf<P extends object>(
  seeds: readonly LookSeed[]
): BlockVariation<P>[] {
  return seeds.map(seed => ({ ...seed }));
}

/** One breakpoint-wide, base-state set of values. */
const values = (set: Record<string, unknown>): NodeStyles =>
  ({ base: { base: set } }) as unknown as NodeStyles;

/** Every side of a box at one value. */
const sides = (value: string) => ({
  blockStart: value,
  blockEnd: value,
  inlineStart: value,
  inlineEnd: value,
});

/** A one-pixel solid border in a token's colour. */
const hairline = (token: string) => ({
  width: sides("1px"),
  style: "solid",
  color: { $token: token },
});

/** A button's looks: Primary is its own; Secondary, Outline and Text vary it. */
export function buttonLooks<P extends object>(): BlockVariation<P>[] {
  return looksOf<P>([
    { name: "primary", label: "Primary", isDefault: true },
    {
      name: "secondary",
      label: "Secondary",
      styles: values({
        backgroundColor: { $token: "color.surface" },
        color: { $token: "color.text" },
        border: hairline("color.border"),
      }),
    },
    {
      name: "outline",
      label: "Outline",
      styles: values({
        backgroundColor: "transparent",
        color: { $token: "color.primary" },
        border: hairline("color.primary"),
      }),
    },
    {
      name: "text",
      label: "Text",
      styles: values({
        backgroundColor: "transparent",
        color: { $token: "color.primary" },
        padding: { inlineStart: "0", inlineEnd: "0" },
        textDecoration: "underline",
      }),
    },
  ]);
}

/** An image's looks: Square is its own; Rounded and Circle vary it. */
export function imageLooks<P extends object>(): BlockVariation<P>[] {
  return looksOf<P>([
    { name: "square", label: "Square", isDefault: true },
    {
      name: "rounded",
      label: "Rounded",
      styles: values({ borderRadius: "12px" }),
    },
    {
      name: "circle",
      label: "Circle",
      styles: values({
        borderRadius: "9999px",
        aspectRatio: "1 / 1",
        objectFit: "cover",
      }),
    },
  ]);
}

/** A section's looks: Plain is its own; Hero is a tall, centred band. */
export function sectionLooks<P extends object>(): BlockVariation<P>[] {
  return looksOf<P>([
    { name: "plain", label: "Plain", isDefault: true },
    {
      name: "hero",
      label: "Hero",
      styles: values({
        backgroundColor: { $token: "color.surface" },
        minHeight: "60vh",
        padding: { blockStart: "6rem", blockEnd: "6rem" },
        textAlign: "center",
      }),
    },
  ]);
}
