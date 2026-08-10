/**
 * Webhook domain — recording provenance from plugin contributions.
 *
 * The recording policy tags each decision `code` or `plugin` so a code-first
 * HMR reconcile prunes only code-first slugs and never a plugin's opt-out
 * (plugins do not re-run on reload). Provenance is derived HERE from the actual
 * plugin contribution list — collections/singles a plugin declares via
 * `contributes.{collections,singles}` or the legacy `plugin.{collections,
 * singles}` — NOT from the optional `admin.isPlugin` presentation flag. A
 * third-party plugin that declares `webhooks: false` without ever setting that
 * flag would otherwise be tagged `code` and have its opt-out pruned, silently
 * resuming recording of its (often PII-bearing) content.
 *
 * @module domains/webhooks/recording-provenance
 */

/** Entity kinds that can be contributed by a plugin and carry a recording opt-out. */
type PluginEntityKind = "collections" | "singles";

interface SluggedEntity {
  slug?: string;
}

interface PluginLike {
  collections?: readonly SluggedEntity[];
  singles?: readonly SluggedEntity[];
  contributes?: {
    collections?: readonly SluggedEntity[];
    singles?: readonly SluggedEntity[];
  };
  // A plugin may rename its contributed slugs; the schema fold rewrites the
  // config entry to the renamed slug, so provenance must key on that same
  // effective slug (see `collectPluginContributedSlugs`).
  renameMap?: Record<string, string>;
}

/**
 * The set of EFFECTIVE slugs of `kind` contributed by any plugin in `plugins`,
 * reading both the declarative `contributes.<kind>` and the legacy
 * `plugin.<kind>` (mirrors how the admin-meta fold reads them). Every consumer
 * compares this set against the post-fold `config.<kind>` slug, so each source
 * is resolved to the slug that actually lands in the config:
 *
 * - `contributes.<kind>` entries are folded by
 *   `applyPluginSchemaContributionsDeferred`, which applies the plugin's
 *   `renameMap`, so they are recorded under the RENAMED slug.
 * - legacy `plugin.<kind>` entries are NOT renamed by that fold (only
 *   `contributes` is); they reach the config through the plugin's own
 *   `setup()`/manual merge under their DECLARED slug, so they are recorded
 *   as-declared.
 *
 * Used to tag recording provenance so a plugin's opt-out is never pruned by a
 * code-first reconcile, and to skip a disabled plugin's runtime hooks.
 */
export function collectPluginContributedSlugs(
  plugins: readonly unknown[] | undefined,
  kind: PluginEntityKind
): Set<string> {
  const slugs = new Set<string>();
  for (const raw of plugins ?? []) {
    const plugin = raw as PluginLike;
    const renameMap = plugin.renameMap ?? {};
    // `contributes` entries are rewritten to their renamed form by the schema
    // fold (identity when the plugin declares no rename for the slug).
    for (const entity of plugin.contributes?.[kind] ?? []) {
      if (entity?.slug) slugs.add(renameMap[entity.slug] ?? entity.slug);
    }
    // Legacy top-level entries keep their declared slug: the fold never renames
    // them, so the config carries the declared slug regardless of `renameMap`.
    for (const entity of plugin[kind] ?? []) {
      if (entity?.slug) slugs.add(entity.slug);
    }
  }
  return slugs;
}

/**
 * Whether a registry `source` belongs to config rather than the Builder.
 *
 * Provenance is `"code"` for app config and `"plugin:<name>"` for a plugin's
 * contributed entity; only `"ui"`/`"built-in"` rows are Builder-authored. This
 * matters because the periodic stored-policy refresh replaces the whole `db`
 * set: publishing a config-owned entity as `db` would let the next refresh drop
 * a decision config owns — including the form-builder's submissions opt-out.
 */
export function isConfigOwnedSource(
  source: string | null | undefined
): boolean {
  return source === "code" || (!!source && source.startsWith("plugin:"));
}
