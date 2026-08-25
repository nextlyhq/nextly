/**
 * Whether a compiled declaration pulls a box past the page's own inset.
 *
 * A measured page spends its horizontal inset as GRID COLUMNS rather than
 * padding, so a negative margin on that axis has nothing to pull back from: it
 * pulls content PAST its own column. Measured, that was 64px on the entry
 * editor.
 *
 * The distance is COMPUTED rather than matched, because one distance has
 * unbounded spellings: a calc over the spacing variable, a literal in rem, the
 * same in pixels, a calc over a calc, an arbitrary value nesting further. They
 * are different strings and the same displacement, so the string is the wrong
 * thing to compare.
 *
 * Separate from `build-css.mjs` so it can be tested: this is the part with
 * arithmetic in it, and a build can only report pass or fail on one stylesheet.
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
 * Multiplication, nesting and the sheet's two length units are evaluated.
 * Anything else — addition, division, a variable that is not the spacing step
 * — returns NaN, and what the caller does with that is its decision.
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
 *
 * A calculation this cannot evaluate counts as one. That direction is
 * deliberate: an unreadable term is unexamined, and the whole failure mode here
 * is a displacement arriving in a form nobody thought to enumerate.
 */
export function cancelsInset(term, spacingRem) {
  const rem = toRem(term, spacingRem);
  if (Number.isFinite(rem)) return rem <= -(spacingRem * 8);

  // Fail closed on a calculation this cannot evaluate — but only one carrying
  // a negative operand. Blanket refusal was measured and is wrong: Tailwind's
  // `space-x-*` emits `calc(<len> * var(--…-reverse))`, unevaluatable because
  // the reverse flag is a runtime value, non-negative in every case, and
  // present dozens of times. Refusing those would make this a check to switch
  // off.
  //
  // `-` followed by a digit, so a negated factor counts while `- var(…)` and
  // the leading dashes of a custom property do not. That is a heuristic and
  // its limit is real: a calc whose negativity comes from a variable alone
  // reads as safe here. What it does cover is the case where the sign is
  // written down.
  return term.includes("calc(") && /-\s*[\d.]/.test(term);
}
