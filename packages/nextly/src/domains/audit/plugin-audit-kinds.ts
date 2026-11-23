/**
 * The audit kinds a plugin declares, checked when its configuration resolves:
 * each under the plugin's own prefix, of one plain shape, short enough for the
 * trail's kind column, and declared once.
 *
 * A module of its own, apart from `plugin-audit.ts`, which writes a plugin's
 * events and reads principals for them: resolving a configuration loads only
 * this check.
 *
 * @module domains/audit/plugin-audit-kinds
 * @since 1.0.0
 */
import { resolutionError } from "../../plugins/resolution-error";
import { AUDIT_KIND_LENGTH } from "../../schemas/audit/widths";

/** What a plugin says it will write. */
export interface PluginAuditKind {
  kind: string;
  metadataKeys?: string[];
}

/**
 * The longest kind the trail's own column can hold: the width the column's
 * declarations are written with, rather than a number restated beside them.
 *
 * Postgres and MySQL declare `kind` as a bounded varchar; SQLite declares
 * text, which holds anything, so the bounded declaration is the one that
 * decides. A kind longer than it is a declaration whose every write fails at
 * the column — and audit writes are fail-safe by design, so the failure is a
 * log line nobody reads and the security event the plugin promised to record
 * simply never exists.
 */
const KIND_COLUMN_MAX = AUDIT_KIND_LENGTH;

/** The whole shape a plugin's kind must have, under its own prefix. */
function kindShape(pluginSlug: string): RegExp {
  // The slug is `[a-z0-9-]` by construction; escaped anyway, so a change to
  // how slugs are made cannot turn one into a pattern.
  const prefix = pluginSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${prefix}\\.[a-z0-9][a-z0-9._-]*$`);
}

/**
 * Every kind a plugin may write, and the keys each kind may carry.
 *
 * A kind must start with the plugin's own prefix, so one plugin cannot write
 * rows that read as another's — or as core's.
 *
 * A mis-prefixed kind is REFUSED, not dropped. Dropping it let the application
 * boot with `ctx.audit` present and the declaration apparently accepted, while
 * every write of that kind was discarded at runtime behind a warning nobody
 * reads — so the operator has no trail for exactly the security event the
 * manifest said would be recorded, and nothing before the incident says so. A
 * misspelled prefix is a configuration error like an incompatible version, and
 * it is only observable here. Same treatment, and the same reason, as a hook
 * point declared outside its plugin's prefix.
 */
export function collectPluginAuditKinds(
  pluginSlug: string,
  declared: readonly PluginAuditKind[],
  pluginName: string = pluginSlug
): Map<string, Set<string>> {
  const kinds = new Map<string, Set<string>>();
  for (const entry of declared) {
    if (!entry.kind.startsWith(`${pluginSlug}.`)) {
      throw resolutionError(
        "plugin-audit-kind-outside-prefix",
        `Plugin "${pluginName}" declares the audit kind "${entry.kind}", which must start with "${pluginSlug}.".`,
        {
          plugin: pluginName,
          auditKind: entry.kind,
          expectedPrefix: pluginSlug,
        }
      );
    }
    // The name after the prefix is held to one plain shape. A prefix check
    // alone accepted `acme-auth.\nFAKE login-succeeded`, which renders in a
    // log or an audit view as a second, forged line; nothing a kind names
    // needs more than lowercase letters, digits, `.`, `_` and `-`.
    if (!kindShape(pluginSlug).test(entry.kind)) {
      throw resolutionError(
        "plugin-audit-kind-invalid",
        `Plugin "${pluginName}" declares the audit kind ${JSON.stringify(entry.kind)}; after "${pluginSlug}." a kind may use only lowercase letters, digits, ".", "_" and "-", starting with a letter or digit.`,
        { plugin: pluginName, auditKind: entry.kind }
      );
    }
    // A kind the column cannot hold is refused here, at the same place the
    // prefix is, and for the same reason: this is the only point where the
    // declaration is observable before it silently stops recording.
    if (entry.kind.length > KIND_COLUMN_MAX) {
      throw resolutionError(
        "plugin-audit-kind-too-long",
        `Plugin "${pluginName}" declares the audit kind "${entry.kind}", which is longer than the ${KIND_COLUMN_MAX} characters the audit trail's kind column holds.`,
        {
          plugin: pluginName,
          auditKind: entry.kind,
          maxLength: KIND_COLUMN_MAX,
        }
      );
    }
    // A kind declared TWICE is refused beside the other declarations, because
    // keeping the last entry silently replaced the first one's allowlist: a
    // metadata key only the first entry declared was dropped from every row,
    // and the manifest promised a trail it did not keep. Which entry wins is
    // not something an operator should have to know.
    if (kinds.has(entry.kind)) {
      throw resolutionError(
        "plugin-audit-kind-declared-twice",
        `Plugin "${pluginName}" declares the audit kind "${entry.kind}" more than once; declare it once with the full list of metadata keys.`,
        { plugin: pluginName, auditKind: entry.kind }
      );
    }
    kinds.set(entry.kind, new Set(entry.metadataKeys ?? []));
  }
  return kinds;
}
