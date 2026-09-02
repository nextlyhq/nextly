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
 * Whether `${tsType} | null` would bind the union somewhere other than the
 * whole type.
 *
 * Union sits below almost everything in TypeScript's type grammar, so the
 * concatenation is safe for identifiers, generics, arrays, object literals,
 * intersections and other unions. Two constructs bind looser and capture the
 * union into a part of themselves:
 *
 * - a conditional type — `A extends B ? X : Y | null` attaches null to the
 *   FALSE branch, so the true branch still rejects it. Verified against the
 *   compiler rather than assumed.
 * - a function type — `() => X | null` makes the RETURN nullable and leaves the
 *   field itself non-null.
 *
 * Only a plugin's `codegen.tsType` callback can produce either; every built-in
 * type is atomic. The test is textual and errs toward parenthesising, which
 * costs a pair of brackets on a nested occurrence and never changes a meaning.
 * `zod-generator.ts` already wraps plugin-contributed expressions for exactly
 * this reason, and this follows it.
 */
function bindsLooserThanUnion(tsType: string): boolean {
  return tsType.includes("=>") || tsType.includes(" extends ");
}

/**
 * The type as written when the field admits null.
 *
 * `unknown` is returned untouched: it already admits null, and `unknown | null`
 * would be noise in a file a user reads.
 */
export function nullableTypeExpression(tsType: string): string {
  if (tsType === "unknown") return tsType;
  return bindsLooserThanUnion(tsType)
    ? `(${tsType}) | null`
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
  field: object
): string {
  if (!fieldAdmitsNull(field)) return `  ${fieldName}: ${tsType};`;
  return `  ${fieldName}?: ${nullableTypeExpression(tsType)};`;
}
