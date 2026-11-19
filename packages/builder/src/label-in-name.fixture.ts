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
import { screen } from "@testing-library/react";

/** The name a screen reader hears for `element`, found through its role. */
export function accessibleNameOf(
  element: HTMLElement,
  role = "button"
): string {
  let heard: string | undefined;
  screen.queryAllByRole(role, {
    hidden: true,
    name: (name, each) => {
      if (each === element) heard = name;
      return false;
    },
  });
  if (heard === undefined) {
    throw new Error(`the element is not found by the role "${role}"`);
  }
  return heard;
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
export function labelNotInName(
  element: HTMLElement,
  role = "button"
): string | null {
  const labelled =
    element.hasAttribute("aria-label") ||
    element.hasAttribute("aria-labelledby");
  if (!labelled) return null;
  const drawn = drawnTextOf(element);
  const name = accessibleNameOf(element, role);
  if (holdsRun(wordsOf(name), wordsOf(drawn))) return null;
  return `draws "${drawn}" but is named "${name}"`;
}
