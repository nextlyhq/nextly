/**
 * How far along a set of translations is, as a bar.
 *
 * Two surfaces show one: the language panel counts LANGUAGES against the stored
 * translation map, and translation mode counts FIELDS against the form's live
 * values. Different questions, same drawing — and a second copy of the drawing
 * would drift in height, colour or rounding while both claimed to mean the same
 * thing.
 *
 * `aria-hidden` deliberately: every caller states the same figure in words
 * beside it, and a bar announced as well would say it twice.
 *
 * @module components/features/entries/CompletenessMeter
 */

export function CompletenessMeter({
  translated,
  total,
}: {
  translated: number;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-1.5 w-16 overflow-hidden rounded-sm bg-muted"
    >
      <span
        className="block bg-foreground"
        style={{ width: `${(translated / total) * 100}%` }}
      />
    </span>
  );
}
