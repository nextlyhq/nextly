/**
 * Whether a focused control draws a mark a reader can see, from its computed
 * style: an outline with a style, a width and a colour that is not
 * transparent, or a box-shadow ring (a layer with a spread) in such a colour.
 * A transparent outline or ring is a mark in name only, so it does not count.
 *
 * Plain JavaScript, so the scripts' guard test (`scripts/e2e-focus-mark.test.mjs`)
 * can hold it to real and invisible indicators without a browser.
 *
 * @module e2e/tests/support/focus-mark
 */

/**
 * A computed colour's alpha, 0 to 1: `transparent`, the fourth value of a
 * comma `rgba()`, or the value after `/` in the space form of any colour
 * function. Anything else is opaque.
 *
 * @param {string} colour
 * @returns {number}
 */
function alphaOf(colour) {
  const value = colour.trim().toLowerCase();
  if (value === "" || value === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(value);
  if (slash) {
    const amount = Number.parseFloat(slash[1] ?? "1");
    return slash[2] === "%" ? amount / 100 : amount;
  }
  const comma = /^rgba?\(\s*[^,]+,[^,]+,[^,]+,\s*([\d.]+)(%?)\s*\)$/.exec(
    value
  );
  if (comma) {
    const amount = Number.parseFloat(comma[1] ?? "1");
    return comma[2] === "%" ? amount / 100 : amount;
  }
  return 1;
}

/**
 * Each layer of a computed box-shadow: its colour and its spread. Layers are
 * split on the commas between them, never those inside a colour function.
 *
 * @param {string} boxShadow
 * @returns {Array<{ colour: string, spread: number }>}
 */
function shadowLayers(boxShadow) {
  if (boxShadow.trim() === "" || boxShadow.trim() === "none") return [];
  return boxShadow.split(/,(?![^(]*\))/).map(layer => {
    const colour =
      /([a-z-]+\([^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b)/i.exec(layer)?.[1] ??
      "";
    const lengths = layer.replace(colour, " ").match(/-?[\d.]+px/g) ?? [];
    return { colour, spread: Number.parseFloat(lengths[3] ?? "0") };
  });
}

/**
 * @param {{ outlineStyle: string, outlineWidth: string, outlineColor: string, boxShadow: string }} style
 * @returns {boolean}
 */
export function focusMarkShown(style) {
  const outline =
    style.outlineStyle !== "none" &&
    Number.parseFloat(style.outlineWidth) > 0 &&
    alphaOf(style.outlineColor) > 0;
  const ring = shadowLayers(style.boxShadow).some(
    layer => layer.spread > 0 && alphaOf(layer.colour) > 0
  );
  return outline || ring;
}
