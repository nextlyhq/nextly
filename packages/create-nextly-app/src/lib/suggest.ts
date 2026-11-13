/**
 * The choice nearest to what was typed, for a "Did you mean" hint, or
 * undefined when none is near enough to be a likely typo. Near means a prefix
 * either way (`postgres` for `postgresql`) or an edit distance of at most a
 * third of the choice's length.
 */
export function nearest(
  typed: string,
  choices: readonly string[]
): string | undefined {
  const value = typed.toLowerCase();
  let best: { choice: string; distance: number } | undefined;
  for (const choice of choices) {
    if (choice.startsWith(value) || value.startsWith(choice)) return choice;
    const distance = editDistance(value, choice);
    if (distance <= Math.max(1, Math.floor(choice.length / 3))) {
      if (!best || distance < best.distance) best = { choice, distance };
    }
  }
  return best?.choice;
}

/** The refusal for a flag value outside its choices, with the nearest one. */
export function invalidChoiceMessage(
  flag: string,
  value: string,
  choices: readonly string[]
): string {
  const hint = nearest(value, choices);
  return (
    `${flag} '${value}' is not one of ${choices.join(", ")}.` +
    (hint ? ` Did you mean ${flag} ${hint}?` : "")
  );
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}
