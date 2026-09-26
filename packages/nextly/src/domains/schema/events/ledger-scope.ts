/**
 * Which ledger rows a command is talking about.
 *
 * Every existing consumer was written when every row was the app's, so each
 * one silently includes plugin rows now that plugins write them. The
 * consequences are not cosmetic:
 *
 * - `migrate:down` picks the newest applied `file_apply` row of ANY kind, so
 *   it would revert a plugin's migration while reporting an app rollback;
 * - `migrate:status` would list plugin rows as "applied (file missing)",
 *   because it looks for them in the app's migrations directory.
 *
 * The default is therefore to EXCLUDE them, and `--plugin <name>` selects one
 * plugin's rows deliberately.
 *
 * @module domains/schema/events/ledger-scope
 * @since 1.0.0
 */

/** The prefix a plugin's qualified filename carries. */
const PLUGIN_PREFIX = "plugin:";

/** Whether a ledger filename belongs to a plugin rather than the app. */
export function isPluginLedgerRow(filename: string | null): boolean {
  return filename !== null && filename.startsWith(PLUGIN_PREFIX);
}

/** The plugin a qualified filename belongs to, or null when it is the app's. */
export function pluginOfLedgerRow(filename: string | null): string | null {
  if (!isPluginLedgerRow(filename)) return null;
  const withoutPrefix = (filename as string).slice(PLUGIN_PREFIX.length);
  // The LAST slash, not the first.
  //
  // A qualified name is `plugin:<name>/<module>`, and an npm plugin name
  // contains a slash of its own: `@acme/nextly-plugin-auth`. Splitting on the
  // first one returned `@acme`, so `scopeLedgerRows(rows, "@acme/...")`
  // matched nothing and both `migrate:status --plugin` and
  // `migrate:down --plugin` silently reported no migrations for every scoped
  // plugin. A module name cannot contain a slash — `slugify` produces none —
  // so the last one is the separator, whatever the plugin is called.
  const slash = withoutPrefix.lastIndexOf("/");
  // Without any separator the row is malformed rather than the app's, and
  // treating it as the app's would hand it to `migrate:down`.
  return slash === -1 ? withoutPrefix : withoutPrefix.slice(0, slash);
}

/**
 * The key the ledger records a migration under, from the name a caller has.
 *
 * An app migration is a `.sql` file and is recorded with its extension, so a
 * bare name gains it. A plugin module is recorded under its qualified name
 * (`plugin:<name>/<module>`), which has no extension and is returned as it
 * is: every event about a module — applied, rolled back, failed — has to land
 * on the key its applied row carries for the newest-event rule to see it.
 */
export function ledgerFilename(name: string): string {
  if (isPluginLedgerRow(name) || name.endsWith(".sql")) return name;
  return `${name}.sql`;
}

/**
 * Keep only the rows a command should act on.
 *
 * `plugin` undefined means the app's own rows, which is every command's
 * default. Naming a plugin selects exactly that plugin's, never both — a
 * command operating on the union would revert an app migration while the
 * operator was asking about a plugin.
 */
export function scopeLedgerRows<T extends { filename: string | null }>(
  rows: readonly T[],
  plugin?: string
): T[] {
  if (plugin === undefined) {
    return rows.filter(row => !isPluginLedgerRow(row.filename));
  }
  return rows.filter(row => pluginOfLedgerRow(row.filename) === plugin);
}
