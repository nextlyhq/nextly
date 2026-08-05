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

/** Reads `options.junctionTable` off every field, ignoring anything else. */
export function customJunctionNames(collections: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const raw of collections) {
    const fields =
      (raw as { fields?: { options?: { junctionTable?: unknown } }[] })
        .fields ?? [];
    for (const field of fields) {
      const custom = field.options?.junctionTable;
      if (typeof custom === "string" && custom.length > 0) names.push(custom);
    }
  }
  return names;
}
