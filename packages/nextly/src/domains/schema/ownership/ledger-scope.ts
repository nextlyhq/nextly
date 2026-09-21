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
 * @module domains/schema/ownership/ledger-scope
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
  const slash = withoutPrefix.indexOf("/");
  // A qualified name is `plugin:<name>/<file>`. Without the separator the row
  // is malformed rather than the app's, and treating it as the app's would
  // hand it to `migrate:down`.
  return slash === -1 ? withoutPrefix : withoutPrefix.slice(0, slash);
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
