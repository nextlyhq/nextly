/**
 * Label in Name (WCAG 2.5.3), read the way axe-core's
 * `label-content-name-mismatch` rule reads it, for a test that cannot run axe.
 *
 * axe runs in jsdom for most rules, but not this one: it sets aside text drawn
 * as an icon font, which it measures on a canvas jsdom does not have, so every
 * control comes back "incomplete". These two functions follow the rule as
 * axe-core 4.14 writes it instead:
 *
 * - The drawn text is every text node under the control, joined with nothing
 *   between them. `<span>Brand</span><span>1</span>` reads "Brand1", one word,
 *   so a count drawn in its own span runs into the name before it unless a real
 *   space separates them. Text a screen reader skips (`aria-hidden`) still
 *   counts, as it is still drawn; text that is not drawn (`sr-only`, `hidden`,
 *   `display: none`) does not.
 * - Both texts drop anything in parentheses, turn every character that is not
 *   a letter or a digit into a space, and split into words. The control passes
 *   when the drawn words appear in its accessible name, in order and next to
 *   each other.
 *
 * jsdom applies no stylesheet, so `sr-only` is read from the class itself.
 *
 * @module __tests__/helpers/label-in-name
 */

/** Whether an element is left undrawn: hidden outright, or visually hidden. */
function undrawn(element: Element): boolean {
  if (element.hasAttribute("hidden")) return true;
  if (element.classList.contains("sr-only")) return true;
  return (element as HTMLElement).style?.display === "none";
}

/** The text a sighted reader sees on the control, as axe joins it. */
export function drawnText(element: Element): string {
  let text = "";
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.nodeValue ?? "";
    } else if (child instanceof Element && !undrawn(child)) {
      text += child.tagName === "BR" ? " " : drawnText(child);
    }
  }
  return text;
}

/** The words axe compares: parentheses dropped, punctuation made spaces. */
function words(text: string): string[] {
  let stripped = text.normalize("NFKD").toLowerCase();
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/\([^()]*\)/g, "");
  } while (stripped !== previous);
  return stripped
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether the drawn words sit in the name, in order and next to each other.
 * True when nothing is drawn, as axe has nothing to compare then.
 */
export function nameHoldsDrawnText(name: string, drawn: string): boolean {
  const label = words(drawn);
  if (label.length === 0) return true;
  const named = words(name);
  for (let at = 0; at + label.length <= named.length; at += 1) {
    if (label.every((word, offset) => named[at + offset] === word)) {
      return true;
    }
  }
  return false;
}
