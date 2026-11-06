/**
 * A language's own name for itself, as a person looking for it would read it:
 * `fr` is "Français", `pt-BR` is "Português (Brasil)".
 *
 * Named in itself rather than in the interface language, so someone who
 * cannot read the current one can still find theirs. Falls back to the tag
 * where the runtime has no name for it.
 *
 * @module lib/i18n/language-name
 */
export function languageName(tag: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
  } catch {
    name = undefined;
  }
  if (!name) return tag;
  return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
}
