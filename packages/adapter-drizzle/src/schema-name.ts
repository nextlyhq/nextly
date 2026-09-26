/**
 * The one rule for a PostgreSQL schema name.
 *
 * Lives in the adapter package because both sides need it and neither may
 * import the other: `nextly` validates the configured value at boot so the
 * error names the setting, and the Postgres adapter validates again at the
 * point of interpolation, because that is where a bad value becomes SQL.
 *
 * @module schema-name
 * @since 1.0.0
 */

/**
 * A plain, lower-case identifier.
 *
 * Checked rather than quoted because the value is interpolated into
 * `search_path` and `CREATE SCHEMA`, where a quoted-but-hostile name is still
 * a name somebody else chose. Refusing the shapes that need quoting costs
 * nothing real and removes the question entirely.
 */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/** Whether this is a name the adapter will interpolate. */
export function isValidSchemaName(name: string): boolean {
  // `pg_` is PostgreSQL's reserved prefix for system catalogs.
  return IDENTIFIER.test(name) && !name.startsWith("pg_");
}

/**
 * Return the name, or throw rather than interpolate something unchecked.
 *
 * The adapter throws a plain Error: it has no access to the config path that
 * produced the value, and `nextly` already refuses the same shapes at boot
 * with a message that names `db.postgres.schema`. This is the backstop for a
 * caller that constructed the adapter directly.
 */
export function assertSchemaName(name: string): string {
  if (!isValidSchemaName(name)) {
    throw new Error(
      `Invalid PostgreSQL schema name "${name}". Use lower-case letters, digits and underscores, starting with a letter or underscore (max 63 characters), and not beginning with "pg_".`
    );
  }
  return name;
}
