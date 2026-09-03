/**
 * One answer to "does this field's API contract admit null", for every
 * artifact `nextly generate:types` emits.
 *
 * The TypeScript interfaces and the Zod schemas are two renderings of one
 * question, and before this module each decided it separately: the type
 * generator appended `| null` while the Zod generator emitted `.optional()`,
 * which rejects the very value the type permits. A payload could be accepted
 * statically and by the API, and refused by the validator generated from the
 * same source.
 *
 * **Not derived from `getColumnDescriptor`, deliberately.** That function
 * answers a different question — whether the DDL needs `NOT NULL` — and its
 * answer differs: it forces `nullable` for `fkSingle` regardless of `required`,
 * because a foreign key column is created without `NOT NULL` and the
 * requirement is enforced above the database. Reusing it here would type a
 * required relationship as nullable, which is accurate about the column and
 * wrong about the contract a reader is handed. Two questions, two answers, and
 * merging them would be the mistake this module exists to prevent.
 */

/**
 * Whether reads may hand back null and writes may pass it.
 *
 * A non-required field becomes a nullable column, so an unset one is stored as
 * NULL and read back as NULL rather than being absent from the row.
 */
export function fieldAdmitsNull(field: object): boolean {
  // `in` rather than a declared `required?: boolean` parameter: `DataFieldConfig`
  // is a union whose members do not all declare the key, and `UserFieldDefinitionRecord`
  // is a different type again. This is the narrowing both generators already
  // used, lifted unchanged rather than restated as a structural type they do
  // not satisfy.
  return !("required" in field && field.required === true);
}

/**
 * The type as written when the field admits null.
 *
 * `unknown` is returned untouched: it already admits null, and `unknown | null`
 * would be noise in a file a user reads.
 *
 * `contributed` says the expression came from a plugin's `codegen.tsType`
 * callback rather than from this module, and it decides two things.
 *
 * **Brackets.** Union binds looser than almost everything, so concatenation is
 * safe for every type built here. An arbitrary expression may bind looser
 * still: a conditional attaches the union to its FALSE branch, leaving the true
 * branch rejecting null, and a function type attaches it to the RETURN.
 * Deciding by provenance rather than by inspecting the text means no formatting
 * of the expression, and no type-level syntax added later, can change the
 * answer.
 *
 * **A newline before the closing bracket.** A contributed expression may end in
 * a line comment, and `//` runs to the end of its line, so `(Foo // why)` would
 * swallow the bracket and leave a generated file that does not compile. The
 * break puts the bracket beyond the comment's reach.
 *
 * `zod-generator.ts` brackets its own contributed expressions for the first of
 * these reasons.
 */
export function nullableTypeExpression(
  tsType: string,
  options: { contributed: boolean } = { contributed: false }
): string {
  if (tsType === "unknown") return tsType;
  return options.contributed
    ? `(\n    ${tsType}\n  ) | null`
    : `${tsType} | null`;
}

/**
 * The rendered `name?: Type` portion of a generated interface member, so the
 * `?` and the `| null` are decided together in one place.
 *
 * The `?` is kept ALONGSIDE `| null` rather than replaced by it. The input
 * types are derived from the entity interface (`CreateInput = Omit<...>`), and
 * the same emission builds the field-group interfaces that nest inside entity
 * fields, so dropping `?` would demand an explicit `null` for every optional
 * key at every depth on create — which a top-level wrapper could not reach.
 */
export function renderFieldMember(
  fieldName: string,
  tsType: string,
  field: object,
  options: { contributed: boolean } = { contributed: false }
): string {
  if (!fieldAdmitsNull(field)) return `  ${fieldName}: ${tsType};`;
  return `  ${fieldName}?: ${nullableTypeExpression(tsType, options)};`;
}
