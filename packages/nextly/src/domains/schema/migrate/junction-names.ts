/**
 * The junction tables a config names outright.
 *
 * A many-to-many field may carry `options.junctionTable`, and both production
 * naming sites use it verbatim rather than the generated
 * `<mainA>_<mainB>_<field>` convention — so such a name reveals nothing about
 * what it is, and no pattern can infer it.
 *
 * It matters in every place that compares a live database against a snapshot:
 * a junction is never declared by config, so a snapshot can never contain one,
 * and a live scope that includes it reports a difference no migration can
 * resolve. `migrate:baseline` needs it to keep the table out of the recorded
 * starting point; `migrate` needs it so the first migration after adoption
 * still applies.
 *
 * @module domains/schema/migrate/junction-names
 */
import { usesJunctionTable } from "../services/field-column-descriptor";

/**
 * Reads `options.junctionTable`, but only off fields that actually get a
 * junction.
 *
 * The option is inert on anything that is not a many-to-many relationship, so
 * a name left on a field since changed to `manyToOne` names no table. Treating
 * it as a junction anyway is not merely useless: the name is consumed BEFORE
 * the declared-table guard, so a stale option naming a real collection's table
 * would exclude that first-class table from the snapshot and the drift scope.
 *
 * `usesJunctionTable` is the same predicate the DDL generator asks when it
 * decides whether to emit the table, which is what keeps the two from
 * disagreeing about which fields have one.
 */
export function customJunctionNames(collections: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const raw of collections) {
    const fields =
      (raw as { fields?: { options?: { junctionTable?: unknown } }[] })
        .fields ?? [];
    for (const field of fields) {
      if (!usesJunctionTable(field)) continue;
      const custom = field.options?.junctionTable;
      if (typeof custom === "string" && custom.length > 0) names.push(custom);
    }
  }
  return names;
}
