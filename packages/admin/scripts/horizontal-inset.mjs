/**
 * Whether a compiled declaration pulls a box past the page's own inset.
 *
 * A measured page spends its horizontal inset as GRID COLUMNS rather than
 * padding, so a negative margin on that axis has nothing to pull back from: it
 * pulls content PAST its own column. Measured, that was 64px on the entry
 * editor.
 *
 * The distance is COMPUTED, not matched. The same 32px arrives as a calc over
 * the spacing variable, as a literal, in pixels, and as a calc over a calc —
 * every one a different string and the same distance, so the string is the
 * wrong thing to compare.
 *
 * Separate from `build-css.mjs` so it can be tested: these are the parts with
 * arithmetic in them, and the build that uses them has no other way to say
 * whether they are right.
 */

/**
 * One declaration's value split into its top-level components.
 *
 * Whitespace inside parentheses is removed first, tracked by depth rather than
 * matched: a nested calc goes three deep, and a pattern written for one level
 * splits it into pieces and reads every position after it wrong.
 */
export function components(value) {
  let depth = 0;
  let flat = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (!(depth > 0 && /\s/.test(ch))) flat += ch;
  }
  return flat.trim().split(/\s+/).filter(Boolean);
}

/**
 * A CSS length term evaluated to rem, or NaN when it is not one.
 *
 * Only what these declarations actually contain is handled: multiplication,
 * nesting, and the two length units in the sheet. Anything else is NaN and is
 * left alone — the safe direction for a term this does not understand.
 */
export function toRem(term, spacingRem) {
  let text = term.replaceAll("var(--spacing)", `${spacingRem}rem`);

  // Innermost calc first, so a nested one is a plain length by the time its
  // parent is read.
  while (text.includes("calc(")) {
    const before = text;
    text = text.replace(/calc\(([^()]*)\)/g, (_, body) => {
      const factors = body.split("*").map(f => f.trim());
      const lengths = factors.filter(f => /rem|px/.test(f));
      if (lengths.length !== 1) return "NaN";
      const rem = /px/.test(lengths[0])
        ? parseFloat(lengths[0]) / 16
        : parseFloat(lengths[0]);
      const scale = factors
        .filter(f => !/rem|px/.test(f))
        .reduce((acc, f) => acc * Number(f), 1);
      return `${rem * scale}rem`;
    });
    if (text === before) return NaN;
  }

  if (/^-?[\d.]+px$/.test(text)) return parseFloat(text) / 16;
  return /^-?[\d.]+rem$/.test(text) ? parseFloat(text) : NaN;
}

/**
 * The components of a `margin` shorthand that set the horizontal sides: one
 * value sets all four, two and three put the pair second, and four are
 * clockwise from the top, so right is second and left fourth.
 */
export function horizontalOfMargin(parts) {
  if (parts.length === 1) return parts;
  if (parts.length === 4) return [parts[1], parts[3]];
  return [parts[1]];
}

/**
 * Whether a term pulls a box at least as far as the page's own inset.
 *
 * At-least rather than exactly: a wider negative bleeds further out, and the
 * smaller ones the sheet legitimately ships — a card pulling its edge past its
 * padding, a rule overlap — sit well inside it.
 */
export function cancelsInset(term, spacingRem) {
  const rem = toRem(term, spacingRem);
  return Number.isFinite(rem) && rem <= -(spacingRem * 8);
}
