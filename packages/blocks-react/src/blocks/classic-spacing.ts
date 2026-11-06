/**
 * The classic spacing model, frozen: the element and block defaults this
 * library compiled with before blocks lost their outer margins.
 *
 * A site on the `classic` spacing model (see `style/spacing-mode` in the
 * engine) compiles with these in place of the current defaults, so a page
 * built under that model keeps its look exactly: headings and paragraphs carry
 * their own margins, a divider and a quote are spaced by theirs, a card and a
 * section have no padding of their own, Columns, Gallery and Accordion space
 * their items by `space.4`, and a button keeps its smaller padding. The engine
 * writes no container gap under the same flag.
 *
 * FROZEN on purpose. These values are what that model rendered, so they do not
 * follow later changes to the current defaults; a change here changes every
 * classic site's pages. Each entry is the whole base of its block type as it
 * stood, not a patch over today's, so a later edit to a current default cannot
 * leak into the classic render through a property this table did not repeat.
 *
 * ONE table, consulted at the one place each tier is resolved: the element
 * baseline in `withTypographyDefaults` and the block defaults in
 * `blockBasesFor`. Nothing else asks which model is in force.
 *
 * @module blocks/classic-spacing
 */
import type {
  NodeStyles,
  SpacingMode,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

/** A heading's classic default at one level: its size, leading and margins. */
function heading(size: string, lineHeight: number): NodeStyles {
  return {
    base: {
      base: {
        fontSize: size,
        lineHeight,
        fontWeight: 700,
        // Larger above than below: a heading belongs to the content after it.
        margin: { blockStart: "1.5em", blockEnd: "0.5em" },
      },
    },
  };
}

/**
 * The classic element baseline: the heading scale with its margins, and a
 * paragraph's space below. Nothing else carried an element default.
 */
export const CLASSIC_ELEMENT_BASES: NonNullable<
  StyleCompileContext["elementBases"]
> = Object.freeze({
  h1: heading("2.25em", 1.15),
  h2: heading("1.75em", 1.2),
  h3: heading("1.375em", 1.3),
  h4: heading("1.125em", 1.4),
  h5: heading("1em", 1.45),
  h6: heading("0.875em", 1.5),
  // No space above, so a paragraph after a heading keeps the heading's own.
  p: { base: { base: { margin: { blockStart: "0", blockEnd: "1em" } } } },
});

/** A hairline on the block-start side only, as the classic divider drew. */
const HAIRLINE_ABOVE = {
  width: { blockStart: "1px", blockEnd: "0", inlineStart: "0", inlineEnd: "0" },
  style: "solid",
  color: { $token: "color.border" },
};

/**
 * Each block type's classic default, by type. `null` is a type that had no
 * default of its own under the classic model (a section was unpadded).
 *
 * Only the types whose default changed with container gaps are listed; every
 * other type compiles with its current default under either model.
 */
const CLASSIC_BLOCK_BASES: Readonly<Record<string, NodeStyles | null>> =
  Object.freeze({
    "core/accordion": {
      base: {
        base: {
          display: "grid",
          gap: { $token: "space.4" },
          // The browser's own marker, as these sections drew before an
          // accordion offered an icon of its own, and the icon's position a
          // new accordion has, so choosing an icon puts it after the title.
          disclosureIcon: "browser",
          disclosurePosition: "after",
        },
      },
    },
    "core/button": {
      base: {
        base: {
          display: "inline-block",
          boxSizing: "border-box",
          padding: {
            blockStart: "0.5rem",
            blockEnd: "0.5rem",
            inlineStart: "1rem",
            inlineEnd: "1rem",
          },
          backgroundColor: { $token: "color.primary" },
          color: { $token: "color.background" },
          borderRadius: "8px",
          border: {
            width: {
              blockStart: "0",
              blockEnd: "0",
              inlineStart: "0",
              inlineEnd: "0",
            },
            style: "none",
          },
          textDecoration: "none",
          fontFamily: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
          fontStyle: "inherit",
          lineHeight: "inherit",
          letterSpacing: "inherit",
        },
      },
    },
    "core/card": {
      base: {
        base: {
          display: "block",
          borderRadius: "12px",
          overflow: "hidden",
          backgroundColor: { $token: "color.surface" },
          border: {
            width: {
              blockStart: "1px",
              blockEnd: "1px",
              inlineStart: "1px",
              inlineEnd: "1px",
            },
            style: "solid",
            color: { $token: "color.border" },
          },
        },
      },
    },
    "core/columns": {
      base: {
        base: {
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(240px, 100%), 1fr))",
          gap: { $token: "space.4" },
        },
      },
    },
    "core/divider": {
      base: {
        base: {
          margin: { blockStart: "1.5em", blockEnd: "1.5em" },
          border: HAIRLINE_ABOVE,
        },
      },
    },
    "core/gallery": {
      base: {
        base: {
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
          gap: { $token: "space.4" },
        },
      },
    },
    "core/quote": {
      base: {
        base: {
          margin: {
            blockStart: "1.5em",
            blockEnd: "1.5em",
            inlineStart: "0",
            inlineEnd: "0",
          },
          padding: { inlineStart: "1.5em" },
        },
      },
    },
    "core/section": null,
  });

/**
 * This library's own definitions of the types the classic table lists, by
 * identity. A host may register its own definition under a core name, and the
 * resolver hands that replacement back; its defaults are the host's, so the
 * frozen table stands in only for the definition it was frozen from.
 */
const LIBRARY_DEFINITIONS = new WeakSet<object>();

/** Mark one of this library's own definitions, and hand it back unchanged. */
export function libraryDefinition<T extends object>(definition: T): T {
  LIBRARY_DEFINITIONS.add(definition);
  return definition;
}

/**
 * A block type's default under a spacing model: the frozen classic one when
 * the definition is this library's own and the classic table lists its type,
 * and the definition's own otherwise, a host's replacement included.
 */
export function blockBaseUnder(
  definition: { readonly name: string; readonly baseStyles?: NodeStyles },
  mode: SpacingMode | undefined
): NodeStyles | undefined {
  if (
    mode !== "classic" ||
    !LIBRARY_DEFINITIONS.has(definition) ||
    !Object.hasOwn(CLASSIC_BLOCK_BASES, definition.name)
  ) {
    return definition.baseStyles;
  }
  return CLASSIC_BLOCK_BASES[definition.name] ?? undefined;
}
