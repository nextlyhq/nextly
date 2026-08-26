/**
 * What a field is called on screen — one answer, for every surface that names
 * one.
 *
 * There were four resolutions of "label or name" in the admin and they
 * disagreed where it mattered: the form printed "Excerpt", the entry list
 * printed "Excerpt" through its own second copy of the humaniser, and the
 * version diff printed the raw key `excerpt`. A translator asked to act on
 * `excerpt` has to guess which field of the form that is, and the guess is
 * different in each place they might read it.
 *
 * Two functions rather than one because two questions are asked. `fieldLabel`
 * is `humanizeFieldName` plus the label-wins rule; a caller holding only a key
 * — a table column with no field config behind it — wants the narrower one, and
 * without it exported would write a fifth copy.
 *
 * @module lib/field-label
 */

/** The minimum a field must carry to be named on screen. */
export interface LabelledField {
  name?: string | undefined;
  label?: string | undefined;
}

/**
 * A field's key as a human reads it.
 *
 * Kebab and snake are both legal in a schema and both mean a word boundary, so
 * they are treated identically — one earlier copy split on `_` alone and left
 * `user-email` as "User-email".
 *
 * @example
 * humanizeFieldName("firstName")  // "First Name"
 * humanizeFieldName("user_email") // "User Email"
 * humanizeFieldName("user-email") // "User Email"
 * humanizeFieldName("address1Line") // "Address1 Line"
 */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

/**
 * What this field is called on screen: its declared label, else its key made
 * readable, else `""`.
 *
 * A blank label loses to the name rather than winning as empty text — a field
 * declared `label: " "` is one nobody meant to leave nameless, and a heading
 * rendered as whitespace names nothing while looking deliberate.
 *
 * `""` rather than a built-in fallback phrase: what to show for a field that
 * cannot be named at all is the surface's decision. A version diff wants
 * "Untitled field"; a table column wants an empty header rather than that
 * phrase repeated down the page. Baking either in would hand every caller a
 * string it never shows, and invite two of them to disagree about the copy for
 * one situation — which is the drift this module exists to end.
 */
export function fieldLabel(field: LabelledField): string {
  const declared = field.label?.trim() ?? "";
  if (declared !== "") return declared;
  return humanizeFieldName(field.name ?? "");
}
