/**
 * How `core/form` looks: the root's grid and the parts it draws inside it.
 *
 * Every form is drawn with these parts, the simple form and a provider's
 * alike, so the block's Style settings and the site's dark values reach a
 * provider's form with no stylesheet of the provider's own.
 *
 * **Two distances, not one.** The root's `gap` falls between fields; each
 * field's own `gap` sits between its label, its control, its help and its
 * error. One even gap spaced a label as far from its own control as from the
 * next question, so nothing read as belonging together.
 *
 * Colours are tokens, because a literal is wrong in whichever of light and
 * dark it was not chosen for; spacing and radii are literals, which is safe
 * for the reason `core/card` gives. A property the style catalog does not
 * carry is dropped by the compiler without a word, so the tests assert the
 * COMPILED CSS rather than these objects.
 *
 * @module blocks/form-parts
 */
import type { BlockPart } from "@nextlyhq/blocks-engine";

import { BUTTON_BASE_STYLES } from "./button";

/** The grid that stacks the form's messages, fields and button. */
export const FORM_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      // The distance between one field and the next. A field's label, control
      // and help are closer together, inside the field's own part.
      gap: "1rem",
    },
  },
} as const;

/**
 * The words that are not a control's: help under a control, the
 * "* Required" note. Muted, which `color.muted` keeps above 4.5:1 on the
 * page's background in light and dark.
 */
const QUIET = {
  color: { $token: "color.muted" },
  fontSize: "0.875rem",
} as const;

/** Taken off screen and out of the layout, but still read where meant. */
const OFF_SCREEN = {
  position: { type: "absolute" },
  margin: { inlineStart: "-10000px" },
  width: "1px",
  height: "1px",
  overflow: "hidden",
} as const;

/** A one-pixel border on every logical side, in `colour`. */
function outline(colour: string) {
  return {
    // Per LOGICAL side, so it follows writing direction rather than assuming
    // left-to-right.
    width: {
      blockStart: "1px",
      blockEnd: "1px",
      inlineStart: "1px",
      inlineEnd: "1px",
    },
    style: "solid",
    color: { $token: colour },
  } as const;
}

/** The parts `core/form` draws, by name. */
export const FORM_PARTS: Readonly<Record<string, BlockPart>> = {
  /**
   * One field: its label (or legend), control, help and error, close
   * together. A `<fieldset>` for a Choice, so its own border and padding are
   * taken away here.
   */
  field: {
    baseStyles: {
      base: {
        base: {
          display: "grid",
          gap: "0.375rem",
          margin: { blockStart: "0", blockEnd: "0" },
          padding: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
          border: {
            width: {
              blockStart: "0",
              blockEnd: "0",
              inlineStart: "0",
              inlineEnd: "0",
            },
            style: "none",
          },
          minWidth: "0",
        },
      },
    },
  },
  /**
   * The control a field's label names.
   *
   * It has to LOOK like a control: a host reset (Tailwind's Preflight, which
   * the scaffold ships) takes the browser's border and background away, and a
   * form then rendered as a column of labels with nothing under them.
   *
   * At least 16px of text, so a phone does not zoom the page in when a
   * visitor taps it, and at least 44px tall, a target a thumb can hit.
   */
  control: {
    baseStyles: {
      base: {
        base: {
          boxSizing: "border-box",
          width: "100%",
          minHeight: "2.75rem",
          fontSize: "1rem",
          padding: {
            blockStart: "0.5rem",
            blockEnd: "0.5rem",
            inlineStart: "0.75rem",
            inlineEnd: "0.75rem",
          },
          backgroundColor: { $token: "color.background" },
          color: { $token: "color.text" },
          borderRadius: "6px",
          /*
           * `color.border-strong`, NOT the hairline `color.border`. The border
           * is the only thing telling a person where the field is, which WCAG
           * 2.2 SC 1.4.11 requires to clear 3:1, and the hairline does not:
           * `#e5e7eb` on `#ffffff` is 1.24:1, `#1f2937` on `#0b0f19` 1.30:1.
           */
          border: outline("color.border-strong"),
        },
      },
    },
  },
  /**
   * One option of a Choice, or a lone checkbox: the box and its words on one
   * line, the whole line the target, at least 44px tall.
   */
  choice: {
    baseStyles: {
      base: {
        base: {
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          minHeight: "2.75rem",
          fontSize: "1rem",
        },
      },
    },
  },
  /** The box of a checkbox or a radio, large enough to see and press. */
  tick: {
    baseStyles: {
      base: {
        base: {
          width: "1.25rem",
          height: "1.25rem",
          margin: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
          flexShrink: 0,
        },
      },
    },
  },
  /** A field's line of help, under its control. */
  help: { baseStyles: { base: { base: { ...QUIET } } } },
  /** "* Required", said once above the fields. */
  note: { baseStyles: { base: { base: { ...QUIET } } } },
  /**
   * The reason a provider's own script gives under a field it refused. Empty
   * and hidden until that script fills it; in the text's own colour, so it
   * reads at full contrast in light and dark.
   */
  error: {
    baseStyles: {
      base: { base: { color: { $token: "color.text" }, fontSize: "0.875rem" } },
    },
  },
  /**
   * The message a send comes back to: "Thanks, we got your message." in
   * place of the form, or the reason a send was refused above it. A box on
   * the page's surface, so it reads as the form's answer, with a
   * heading-sized line.
   */
  message: {
    baseStyles: {
      base: {
        base: {
          boxSizing: "border-box",
          padding: {
            blockStart: "1rem",
            blockEnd: "1rem",
            inlineStart: "1rem",
            inlineEnd: "1rem",
          },
          backgroundColor: { $token: "color.surface" },
          color: { $token: "color.text" },
          borderRadius: "8px",
          border: outline("color.border-strong"),
          fontSize: "1.125rem",
          fontWeight: 600,
        },
      },
    },
  },
  /**
   * The submit, wearing `core/button`'s own appearance: the WHOLE envelope,
   * so a hover or a breakpoint the button grows reaches the form's submit
   * too. Sized to its words rather than to the grid's column, and at least
   * 44px tall. (`justify-self: start` would say the first, and is a grid
   * item property the button's own styles do not need.)
   */
  submit: {
    baseStyles: {
      ...BUTTON_BASE_STYLES,
      base: {
        ...BUTTON_BASE_STYLES.base,
        base: {
          ...BUTTON_BASE_STYLES.base.base,
          width: "fit-content",
          minHeight: "2.75rem",
        },
      },
    },
  },
  /**
   * Words for screen readers only: " (required)" after a required field's
   * visible "*". Taken off screen like the trap, not hidden, so a screen
   * reader reads it as part of the label.
   */
  spoken: { baseStyles: { base: { base: { ...OFF_SCREEN } } } },
  /**
   * The spam trap's box, taken off screen: absolutely positioned, so it takes
   * no row of the grid, and moved far past the inline start, where no
   * scrolling reaches it in either writing direction.
   */
  trap: { baseStyles: { base: { base: { ...OFF_SCREEN } } } },
};
