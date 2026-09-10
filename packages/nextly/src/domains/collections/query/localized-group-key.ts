/**
 * Whether a field's LOCALIZATION stops it being a group key.
 *
 * A leaf module importing NOTHING, and that is the whole reason it exists.
 * `group-key-declaration` owns the rest of the declaration-level decision, but
 * it resolves a field's kind through the schema classifier — and
 * `domains/widgets/query` is type-checked by the admin, whose project does not
 * define the aliases that graph pulls in. So the one caller that most needs to
 * agree with the read could not import the module that decides, and answered
 * the localization question itself instead.
 *
 * Two implementations of one rule agree until one of them changes, and the
 * direction this pair drifts in is the costly one: the day localized
 * aggregation becomes supported, the read starts accepting a key the widget
 * validator still refuses, leaving a supported path no author can reach and
 * nothing failing to point at why.
 *
 * The REASON is returned rather than a boolean so that a caller can say why,
 * and so a rule that later gains conditions carries them to every caller
 * instead of to whichever one was remembered. Each caller words its own
 * refusal around it: the read names a group key, the widget validator names a
 * `dateField` on a source, and neither sentence would read correctly in the
 * other's place.
 *
 * @module domains/collections/query/localized-group-key
 */

/**
 * Why a localized field cannot be grouped, or `undefined` when it can.
 *
 * Takes the declaration STRUCTURALLY — only the property the rule reads — so
 * that importing this pulls in no field-definition graph. A caller holding a
 * full `FieldDefinition` satisfies it, and so does a widget source's field
 * description, which is a different type carrying the same flag.
 */
export function localizedGroupKeyProblem(
  declared: { localized?: boolean } | undefined
): string | undefined {
  if (declared?.localized !== true) return undefined;
  return "is localized, so its values are stored per locale rather than on this collection, and grouping over a localized field is not supported yet";
}
