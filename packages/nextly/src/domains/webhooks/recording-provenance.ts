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
 * `plugin.<kind>` (mirrors how the admin-meta fold reads them). Each declared
 * slug is resolved through the plugin's `renameMap`, because the schema fold
 * (`applyPluginSchemaContributionsDeferred`) has already rewritten the config
 * entry to the renamed slug — every consumer compares this set against the
 * post-fold `config.<kind>` slug. Used to tag recording provenance so a
 * plugin's opt-out is never pruned by a code-first reconcile, and to skip a
 * disabled plugin's runtime hooks.
 */
export function collectPluginContributedSlugs(
  plugins: readonly unknown[] | undefined,
  kind: PluginEntityKind
): Set<string> {
  const slugs = new Set<string>();
  for (const raw of plugins ?? []) {
    const plugin = raw as PluginLike;
    const renameMap = plugin.renameMap ?? {};
    const declared = plugin.contributes?.[kind] ?? [];
    const legacy = plugin[kind] ?? [];
    for (const entity of [...declared, ...legacy]) {
      // Resolve the declared slug to its renamed form (identity when the
      // plugin declares no rename for it), matching the folded config entry.
      if (entity?.slug) slugs.add(renameMap[entity.slug] ?? entity.slug);
    }
  }
  return slugs;
}
