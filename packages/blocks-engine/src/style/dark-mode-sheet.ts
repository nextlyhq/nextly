/**
 * The token blocks of a site with dark values, and the marker that chooses a
 * mode: the light root, the device's dark block, the marker's dark block and
 * the light marker, each stating its colour scheme.
 *
 * Its own file because it is one area of the token sheet, the part a second
 * mode adds, apart from the token rules `site-tokens` holds.
 *
 * @module dark-mode-sheet
 */
import type { TokenMode } from "./site-tokens";

/**
 * The marker a host sets to choose a mode: `"dark"` or `"light"`.
 *
 * Without it the visitor's device decides. With it the marker wins both ways:
 * `"dark"` shows dark values on a light device and `"light"` keeps light values
 * on a dark one.
 *
 * Named rather than themed: it says what it selects and belongs to no design
 * system, so a host wiring its own toggle to it is not adopting anything else.
 */
export const DARK_MODE_ATTRIBUTE = "data-nx-theme";

/** The selector root-scoped tokens are declared under. */
const ROOT_TOKEN_SELECTOR = ":root";

/**
 * The dark block, written for whichever element can actually carry the switch.
 *
 * **Root-scoped tokens are declared on the attribute-bearing element itself,
 * not on the root.** Custom properties inherit, so declaring them wherever the
 * host put the attribute cascades to everything below — which is the only shape
 * that works for all three placements a host chooses between. Measured, with
 * the attribute moved between `<html>`, `<body>` and a wrapper: this form
 * applies in every one. A form anchored to `:root` applies only when the
 * attribute is on `<html>`, because `:root` IS that element and cannot be
 * reached by a rule describing an ancestor.
 *
 * Its specificity equals the light block's `:root`, and it is emitted after it,
 * so order decides and dark wins where both match.
 *
 * **A scoped selector keeps the ancestor form**, because a bare attribute
 * selector would declare these tokens for the whole document and a scoped
 * sheet exists precisely so it does not. There the host has somewhere above the
 * element to put the switch, so the ancestor form is both available and
 * correct.
 */
function darkSelectorFor(selector: string, dark: readonly string[]): string {
  return markerBlockFor(selector, "dark", dark);
}

/**
 * Declarations under the marker for one mode, on whichever element carries it.
 *
 * The light block is the same shape as the dark one, for the same reason: the
 * device block above is guarded only against a marker on the root itself, so a
 * `data-nx-theme="light"` on `<body>` or a wrapper would otherwise inherit the
 * dark values from the root. Declaring the light values on the marked element
 * puts them nearer than anything inherited.
 */
function markerBlockFor(
  selector: string,
  mode: TokenMode,
  declarations: readonly string[]
): string {
  const body = `{${declarations.join(";")}}`;
  const marker = `[${DARK_MODE_ATTRIBUTE}="${mode}"]`;
  if (selector === ROOT_TOKEN_SELECTOR) {
    return `${marker}${body}`;
  }
  // `:is()` around the whole selector, because this one may be a LIST. Appending
  // the attribute to `.preview-a,.preview-b` yields `.preview-a` bare and only
  // `.preview-b[...]` qualified, so the first member would take the dark values
  // unconditionally and a scoped preview would render dark for good. `:is()`
  // takes the specificity of its most specific argument, so a list of single
  // classes weighs exactly what one of them did.
  const scoped = `:is(${selector})`;
  // The NEAREST marker decides. A light and a dark block would otherwise
  // match with equal weight under nested markers, and whichever was written
  // last would win however the markers nest. So a block that applies through
  // an ancestor's marker stands down where the other mode's marker is on the
  // scope itself, or sits between that ancestor and the scope.
  const other = `[${DARK_MODE_ATTRIBUTE}="${mode === "dark" ? "light" : "dark"}"]`;
  return `${scoped}${marker},${marker} ${scoped}:not(${other},${marker} ${other} *)${body}`;
}

/**
 * The dark block written for the visitor's device preference.
 *
 * Guarded by a `not` on the light marker, so a host (or the editor's preview)
 * can keep light values on a device that prefers dark. On `:root` the guard
 * reads the root element alone, because nothing sits above it; a scoped
 * selector is guarded against the marker on itself or on any ancestor, which
 * is where a host puts the switch for a scoped sheet.
 *
 * Wrapped in `:is()` for the same reason as the attribute form: the selector
 * may be a list, and `:not()` appended to it would guard only its last member.
 */
function deviceDarkBlockFor(selector: string, dark: readonly string[]): string {
  const light = `[${DARK_MODE_ATTRIBUTE}="light"]`;
  const guarded =
    selector === ROOT_TOKEN_SELECTOR
      ? `${ROOT_TOKEN_SELECTOR}:not(${light})`
      : `:is(${selector}):not(${light},${light} *)`;
  return `@media (prefers-color-scheme:dark){${guarded}{${dark.join(";")}}}`;
}

/** The declaration telling the browser which scheme to draw its own controls in. */
function colorSchemeOf(mode: TokenMode): string {
  return `color-scheme:${mode}`;
}

/**
 * The token blocks of a site with dark values: the light root, then both dark
 * forms, then the light marker.
 *
 * Both forms, always, and in this order. The device block makes dark values
 * work with no setup; the marker block after it lets a host choose dark on a
 * light device. `set.darkMode` is deliberately not read: it once picked one of
 * the two, and its default picked the form nothing set. The light marker block
 * comes last, so where a light marker sits inside a dark one the nearer marker
 * decides.
 *
 * Each block also states its `color-scheme`. A checkbox, a radio, a select's
 * list and a scrollbar are drawn by the browser from the scheme the page
 * states, not from these variables, so without it a dark page draws them
 * light: a white box on a dark form. The property is inherited, so stating it
 * where the values are declared carries it to every element they reach, and
 * the light marker states light again for the same reason it restores the
 * light values: a marker below the root would otherwise inherit dark.
 */
export function darkModeSheet(
  selector: string,
  light: readonly string[],
  dark: readonly string[],
  undoDark: readonly string[]
): string {
  const lightScheme = colorSchemeOf("light");
  const darkScheme = colorSchemeOf("dark");
  return (
    `${selector}{${[...light, lightScheme].join(";")}}` +
    deviceDarkBlockFor(selector, [...dark, darkScheme]) +
    darkSelectorFor(selector, [...dark, darkScheme]) +
    markerBlockFor(selector, "light", [...undoDark, lightScheme])
  );
}
