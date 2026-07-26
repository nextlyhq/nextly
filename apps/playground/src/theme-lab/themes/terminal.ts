/**
 * Terminal: a phosphor CRT. Dark in both modes, monospaced everywhere.
 *
 * Design intent. Terminal is the only theme here with no light mode, and that
 * is the proposition rather than an oversight: an admin for people who live in
 * a terminal, which does not turn white when the operating system does. The
 * `light` block is dark on purpose. Nothing about it should be "fixed".
 *
 * Three moves make it, and nothing else does:
 *   1. `fontSans` is set to the SAME stack as `fontMono`, so labels, headings,
 *      table cells and ids are all one monospaced voice. This is the single
 *      biggest visual change any theme in this set makes, and it is typographic
 *      rather than chromatic.
 *   2. Zero radius, and no elevation at all. Card, page and popover sit at the
 *      same lightness; a menu is separated by its rule, the way a TUI draws a
 *      box, not by floating above the screen. Only the rail steps darker.
 *   3. Green phosphor carries every action, amber phosphor carries the accent
 *      surfaces. Two monitors' worth of colour and nothing else.
 *
 * The two modes are tuned rather than duplicated, exactly as a CRT would be:
 * `light` is the screen at working brightness in a lit room; `dark` drops the
 * surfaces further and pushes the phosphor a step brighter, because a dimmer
 * surround needs more separation, not less. Compact density, because a terminal
 * that wastes vertical space is not a terminal.
 */
import type { ThemeDefinition } from "../types";

// One stack, used for both roles. Declared once so the two can never drift:
// the whole point is that there is no sans face anywhere in the interface.
const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const TERMINAL: ThemeDefinition = {
  id: "terminal",
  label: "Terminal",
  group: "nextly",
  recommendedLayout: "rail-panel",
  recommendedDensity: "compact",
  radius: "0px",
  fontSans: MONO_STACK,
  fontMono: MONO_STACK,
  light: {
    // Flat by design: background, card and popover are the same near-black with
    // a faint green cast. A CRT has no depth, so nothing is raised; the rail
    // below is the only surface that steps, and it steps down.
    background: "oklch(0.16 0.008 150)",
    "page-background": "oklch(0.13 0.007 150)",
    foreground: "oklch(0.92 0.025 150)",
    card: "oklch(0.16 0.008 150)",
    "card-foreground": "oklch(0.92 0.025 150)",
    popover: "oklch(0.16 0.008 150)",
    "popover-foreground": "oklch(0.92 0.025 150)",
    // P1 green phosphor. Bright enough to be the light source in the room.
    primary: "oklch(0.8 0.16 145)",
    "primary-foreground": "oklch(0.14 0.008 150)",
    secondary: "oklch(0.235 0.011 150)",
    "secondary-foreground": "oklch(0.92 0.025 150)",
    // The "current line" band, the one surface that lifts, and only just.
    muted: "oklch(0.215 0.01 150)",
    "muted-foreground": "oklch(0.7 0.022 150)",
    // P3 amber phosphor: the second monitor. Kept at hue 68 so it stays clearly
    // orange against `warning`, which sits up at 88 and reads yellow.
    accent: "oklch(0.64 0.125 68)",
    "accent-foreground": "oklch(0.14 0.008 150)",
    // Inverse video: a solid block of phosphor with the screen colour punched
    // out of it, which is how a terminal has always marked a selection.
    highlight: "oklch(0.85 0.17 145)",
    "highlight-foreground": "oklch(0.14 0.008 150)",
    // Status colours are squeezed from two sides here in a way no other theme
    // is. The base token must be light enough to read as TEXT on a near-black
    // page, and the same token also generates the tinted badge shades, whose
    // tightest pair (`600` text on a `50` surface) needs it dark. The window
    // where both hold is narrow, so each of the three is set inside it rather
    // than at the brightness an ANSI palette would suggest.
    destructive: "oklch(0.615 0.19 25)",
    // The fill under near-white type is a separate, deeper red: the base above
    // would leave the on-color at roughly 4:1.
    "destructive-solid": "oklch(0.53 0.21 25)",
    "destructive-foreground": "oklch(0.97 0.01 150)",
    // Hue 162 rather than the phosphor's 145, so "succeeded" is a colder green
    // than the primary and the two do not read as the same state.
    success: "oklch(0.56 0.165 162)",
    "success-solid": "oklch(0.5 0.16 162)",
    "success-foreground": "oklch(0.97 0.01 150)",
    warning: "oklch(0.595 0.135 88)",
    "warning-foreground": "oklch(0.14 0.008 150)",
    // Scrollback: darker than the page, because in a terminal a code block is
    // not a card laid on top, it is the screen with less written on it.
    "code-bg": "oklch(0.09 0.004 150)",
    "code-fg": "oklch(0.9 0.025 150)",
    // ANSI-flavoured rather than Mono's editor palette. On a black slab every
    // syntax colour can run bright, which is the one place this theme has more
    // headroom than the light ones rather than less.
    "code-comment": "oklch(0.58 0.02 150)",
    "code-keyword": "oklch(0.72 0.16 320)",
    "code-string": "oklch(0.78 0.15 150)",
    "code-number": "oklch(0.78 0.11 200)",
    "code-function": "oklch(0.74 0.13 250)",
    "code-operator": "oklch(0.85 0.02 150)",
    "code-punctuation": "oklch(0.62 0.02 150)",
    "code-variable": "oklch(0.78 0.13 70)",
    "code-tag": "oklch(0.7 0.16 25)",
    "code-deleted": "oklch(0.7 0.16 25)",
    "code-inserted": "oklch(0.78 0.15 150)",
    "border-subtle": "oklch(0.85 0.05 150 / 0.1)",
    // Phosphor-tinted rather than white: these are the box-drawing rules, and
    // with no elevation anywhere they are the only thing that says where one
    // region ends. A neutral white line would sit outside the theme's light.
    border: "oklch(0.85 0.05 150 / 0.44)",
    "border-strong": "oklch(0.85 0.05 150 / 0.58)",
    input: "oklch(0.52 0.03 150)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    // The rail is the darkest surface in the theme, so the screen reads as
    // being inset into it rather than sitting beside it.
    "sidebar-background": "oklch(0.115 0.005 150)",
    "sidebar-foreground": "oklch(0.88 0.022 150)",
    "sidebar-primary": "oklch(0.8 0.16 145)",
    "sidebar-primary-foreground": "oklch(0.14 0.008 150)",
    "sidebar-accent": "oklch(0.2 0.016 150)",
    "sidebar-accent-foreground": "oklch(0.92 0.025 150)",
    "sidebar-border": "oklch(0.49 0.03 150)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.205 0.01 150)",
  },
  dark: {
    // The same screen with the lamps off. Every surface drops, and the phosphor
    // is pushed a step brighter to hold its separation against the deeper
    // surround -- which is the adjustment a real monitor needs, and the reason
    // this is authored rather than copied from the block above.
    background: "oklch(0.125 0.006 150)",
    "page-background": "oklch(0.095 0.005 150)",
    foreground: "oklch(0.94 0.03 150)",
    card: "oklch(0.125 0.006 150)",
    "card-foreground": "oklch(0.94 0.03 150)",
    popover: "oklch(0.125 0.006 150)",
    "popover-foreground": "oklch(0.94 0.03 150)",
    primary: "oklch(0.83 0.17 145)",
    "primary-foreground": "oklch(0.11 0.006 150)",
    secondary: "oklch(0.195 0.009 150)",
    "secondary-foreground": "oklch(0.94 0.03 150)",
    muted: "oklch(0.18 0.008 150)",
    "muted-foreground": "oklch(0.7 0.025 150)",
    accent: "oklch(0.66 0.13 68)",
    "accent-foreground": "oklch(0.11 0.006 150)",
    highlight: "oklch(0.87 0.18 145)",
    "highlight-foreground": "oklch(0.11 0.006 150)",
    // Only the dark-mode badge and alert shades are asserted against these, and
    // those sit on tints of the token itself rather than on the page, so the
    // squeeze that constrains the block above does not apply here. The bases
    // are free to run at ANSI brightness.
    destructive: "oklch(0.7 0.19 25)",
    "destructive-solid": "oklch(0.53 0.21 25)",
    "destructive-foreground": "oklch(0.97 0.01 150)",
    success: "oklch(0.72 0.17 162)",
    "success-solid": "oklch(0.5 0.16 162)",
    "success-foreground": "oklch(0.97 0.01 150)",
    warning: "oklch(0.8 0.15 88)",
    "warning-foreground": "oklch(0.11 0.006 150)",
    "code-bg": "oklch(0.07 0.003 150)",
    "code-fg": "oklch(0.92 0.03 150)",
    "code-comment": "oklch(0.56 0.02 150)",
    "code-keyword": "oklch(0.74 0.16 320)",
    "code-string": "oklch(0.8 0.15 150)",
    "code-number": "oklch(0.8 0.11 200)",
    "code-function": "oklch(0.76 0.13 250)",
    "code-operator": "oklch(0.87 0.02 150)",
    "code-punctuation": "oklch(0.6 0.02 150)",
    "code-variable": "oklch(0.8 0.13 70)",
    "code-tag": "oklch(0.72 0.16 25)",
    "code-deleted": "oklch(0.72 0.16 25)",
    "code-inserted": "oklch(0.8 0.15 150)",
    "border-subtle": "oklch(0.85 0.05 150 / 0.1)",
    // Carried UP rather than down, which is the counter-intuitive half of a
    // translucent rule: a line at fixed alpha composites toward whatever is
    // under it, so on the deeper surfaces of this mode the same alpha lands
    // closer to the surface and loses contrast. Holding the rule at a constant
    // ratio rather than a constant value is what keeps the two modes reading as
    // the same screen at two brightnesses.
    border: "oklch(0.85 0.05 150 / 0.45)",
    "border-strong": "oklch(0.85 0.05 150 / 0.6)",
    input: "oklch(0.49 0.028 150)",
    ring: "var(--nx-primary)",
    "focus-ring": "var(--nx-primary)",
    "shadow-color": "oklch(0 0 0)",
    "sidebar-background": "oklch(0.085 0.004 150)",
    "sidebar-foreground": "oklch(0.9 0.025 150)",
    "sidebar-primary": "oklch(0.83 0.17 145)",
    "sidebar-primary-foreground": "oklch(0.11 0.006 150)",
    "sidebar-accent": "oklch(0.17 0.014 150)",
    "sidebar-accent-foreground": "oklch(0.94 0.03 150)",
    "sidebar-border": "oklch(0.485 0.028 150)",
    "sidebar-ring": "var(--nx-primary)",
    "table-border": "var(--nx-border)",
    "table-row-hover": "oklch(0.17 0.008 150)",
  },
};
