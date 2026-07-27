/**
 * Shape rules for a stored access rule's query constraint.
 *
 * An access constraint is a security predicate, so it is held to a NARROWER
 * shape than a caller's own `where` clause. The query translators are built for
 * caller filters, where dropping a member they cannot handle is acceptable; for
 * a rule that decides who sees what, a dropped member means the read runs under
 * a weaker predicate than the rule states and returns rows it excludes.
 *
 * Enumerating everything translation can drop proved unreliable — the list was
 * incomplete in both directions, missing silent drops while refusing shapes that
 * translate exactly. So only a shape whose translation is exact is accepted, and
 * everything else is refused with its reason.
 *
 * @module services/access/constraint-shape
 */

import { getSupportedOperators } from "../../domains/collections/query/query-operators";

let mappableOperators: ReadonlySet<string> | undefined;

/**
 * Whether an operator name is one the query translator maps.
 *
 * Built on first use, not at module load: the modules involved sit in an import
 * cycle, and reading the operator list eagerly can run before that module has
 * initialized. Checked against an explicit set rather than the `in` keyword,
 * which also answers true for inherited names like `toString`.
 */
function isMappableOperator(operator: string): boolean {
  mappableOperators ??= new Set<string>(getSupportedOperators());
  return mappableOperators.has(operator);
}

/** How a caller reports which columns an entity actually has. */
export type HasColumn = (name: string) => boolean;

/**
 * Why an access constraint cannot be applied exactly, or null when it can.
 *
 * Accepted:
 * - a flat map of field to predicate, no logical groups
 * - fields the entity owns as columns, or localized fields resolvable from a
 *   companion table; no dotted paths, whose suffix translation discards while
 *   comparing the base column instead — a different predicate, not a narrower one
 * - a primitive value (shorthand equality), or operators from the mapped set
 *   with values that survive translation
 *
 * A rule needing a richer shape is a feature, not something to approximate here.
 */
export function describeUntranslatableConstraint(
  constraint: Record<string, unknown>,
  hasColumn: HasColumn,
  isLocalizedField?: (name: string) => boolean,
  /** Operators this caller's translation path cannot apply, refused as unsupported. */
  refusedOperators?: ReadonlySet<string>
): string | null {
  const entries = Object.entries(constraint);
  if (entries.length === 0) return "constraint is empty";

  for (const [field, predicate] of entries) {
    if (field === "and" || field === "or") {
      return `logical group "${field}" is not supported in an access constraint`;
    }
    if (!field) return "field name is empty";
    if (field.includes(".")) {
      return `dotted field "${field}" is not supported in an access constraint`;
    }

    if (!hasColumn(field) && !isLocalizedField?.(field)) {
      return `unknown field "${field}"`;
    }

    // Shorthand equality: a primitive translates to `field = value`. `null` and
    // `undefined` do not — translation skips both, dropping the member while its
    // siblings stay and decide alone.
    if (predicate === null) return `field "${field}" is null`;
    if (predicate === undefined) return `field "${field}" has no value`;
    if (typeof predicate !== "object") continue;

    const operators = Object.keys(predicate);
    if (operators.length === 0) return `field "${field}" has no operator`;
    for (const operator of operators) {
      if (!isMappableOperator(operator) || refusedOperators?.has(operator)) {
        return `operator "${operator}" on "${field}" is not supported`;
      }
      const value = (predicate as Record<string, unknown>)[operator];
      if (value === undefined) {
        return `operator "${operator}" on "${field}" has no value`;
      }
      // An empty `in` list is dropped rather than matching nothing, so a rule
      // that should authorize no rows would leave its siblings deciding alone.
      // An empty `not_in` excludes nothing and is therefore already a no-op, so
      // dropping it changes no outcome and it stays accepted — refusing it would
      // deny every caller of a rule whose exclusion list simply came back empty.
      if (operator === "in" && Array.isArray(value) && value.length === 0) {
        return `operator "${operator}" on "${field}" has an empty list`;
      }
    }
  }
  return null;
}
