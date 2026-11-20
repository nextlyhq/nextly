/**
 * For tests: whether a control's accessible name holds the words it draws,
 * in the order it draws them, so a speech-input user who says what they see
 * reaches it (WCAG 2.5.3, Label in Name).
 *
 * The words are compared as axe's `label-content-name-mismatch` rule compares
 * them. The drawn text is every text node joined with nothing between them,
 * so `<span>Brand</span><span>1</span>` draws "Brand1". Text hidden from
 * assistive technology still counts, since it is still on screen. Words only
 * a screen reader hears (`.nx-sr-only`) do not. Anything in parentheses is
 * dropped from both sides, and every other mark splits words. As in the
 * rule, only a control named by `aria-label` or `aria-labelledby` is judged:
 * one named by its own content already says what it holds.
 *
 * @module label-in-name.fixture
 */

/**
 * The name a label gives `element`: the text of what `aria-labelledby` names,
 * else its `aria-label`, else nothing, where it is named by its own content.
 */
function labelOf(element: HTMLElement): string | undefined {
  const ids = element.getAttribute("aria-labelledby");
  if (ids !== null) {
    return ids
      .split(/\s+/)
      .map(id => {
        const named = element.ownerDocument.getElementById(id);
        return named?.getAttribute("aria-label") ?? named?.textContent ?? "";
      })
      .join(" ");
  }
  return element.getAttribute("aria-label") ?? undefined;
}

/** The text `element` draws: its text without the words only heard. */
function drawnTextOf(element: HTMLElement): string {
  const drawn = element.cloneNode(true) as HTMLElement;
  for (const heardOnly of drawn.querySelectorAll(".nx-sr-only")) {
    heardOnly.remove();
  }
  return drawn.textContent ?? "";
}

/** The words axe compares: lower case, parentheses dropped, marks split. */
function wordsOf(text: string): string[] {
  let words = text.normalize("NFKD").toLowerCase();
  let previous: string;
  do {
    previous = words;
    words = words.replace(/\([^()]*\)/g, "");
  } while (words !== previous);
  return words
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(word => word !== "");
}

/** Whether `needle` appears in `haystack` as one unbroken run. */
function holdsRun(
  haystack: readonly string[],
  needle: readonly string[]
): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, at) => word === haystack[start + at])) return true;
  }
  return false;
}

/**
 * Why `element`'s name does not hold the words it draws, or `null` where it
 * does. Said in full, so a failing test shows both sides.
 */
export function labelNotInName(element: HTMLElement): string | null {
  const name = labelOf(element);
  if (name === undefined) return null;
  const drawn = drawnTextOf(element);
  if (holdsRun(wordsOf(name), wordsOf(drawn))) return null;
  return `draws "${drawn}" but is named "${name}"`;
}
