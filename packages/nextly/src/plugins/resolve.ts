import { collectPluginAuditKinds } from "../domains/audit/plugin-audit";
import { assertSchemaVersionDeclarable } from "../domains/schema/ownership/schema-version-check";

import { validateCapabilities, validateRequires } from "./capabilities";
import { collectHookPoints, publishHookPoints } from "./hook-points";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { topoSortPlugins } from "./topo-sort";
import { assertAdminWidgets } from "./validate-admin-widgets";
import { assertClientConfigs } from "./validate-client-config";
import { validatePluginMenus } from "./validate-menus";
import { validatePluginSlugs } from "./validate-slugs";
import { validatePluginVersions } from "./validate-versions";

export interface ResolvePluginsOptions {
  /**
   * Concrete running core version, e.g. "0.0.2-alpha.21". Supplied by the caller;
   * P1 wires the runtime source (CLI + register).
   */
  coreVersion: string;
}

/**
 * The single shared plugin resolver used by both the CLI and the runtime.
 * Validates compatibility, then returns dependency order. Fail-fast.
 *
 * Pure — NOT yet wired into boot. P1 calls this from `register.ts` (runtime) and
 * `config-loader.ts` (CLI).
 */
/**
 * Every check that must hold for the plugin list a boot actually USES.
 *
 * Separated from `resolvePlugins` because the list can change after it runs: a
 * `setup` transformer may add, rename or replace entries, and everything from
 * that point on consumes the transformed list. Re-running this against it is
 * what stops a transformer-introduced declaration going unchecked —
 * `assertSecretPaths` most of all, since a secret path that never matches
 * means the credential it names is stored as ordinary text, with nothing at
 * runtime to say so.
 *
 * Idempotent, so calling it twice costs a second pass and changes nothing.
 * Version compatibility and the topological sort are NOT here because they
 * live in `resolvePlugins`, which is what a caller holding a TRANSFORMED
 * list should re-run: a replacement or addition can change its declared
 * version and dependencies, so those checks travel with the list that will
 * actually initialize.
 */
export function assertPluginManifests(plugins: PluginDefinition[]): void {
  // Before any surface reads the manifest. A capability that is misspelled or
  // an outbound host that is not a hostname would otherwise be discovered as a
  // runtime surface quietly not existing, which reads as a bug in the plugin's
  // own code rather than in its declaration.
  validateCapabilities(plugins);
  validateRequires(plugins);
  // Names and collisions, before anything can register a handler at a seam
  // that two plugins both believe they own — and PUBLISHED, so the seams can
  // consult what was declared. Discarding it left every declared payload
  // schema checking nothing.
  publishHookPoints(collectHookPoints(plugins));
  // Audit kinds, for the reason hook point names are checked above: a kind
  // outside the plugin's prefix used to be dropped where it was collected, so
  // the application booted with `ctx.audit` present and every write of that
  // kind discarded at runtime. The operator is then missing the trail the
  // manifest said it would keep, and nothing says so until it is needed.
  // The SAME call the provider makes, so resolution cannot accept a
  // declaration the provider would refuse.
  for (const plugin of plugins) {
    // Disabled plugins are skipped, as `collectHookPoints` skips them: a
    // plugin that is off contributes no `ctx.audit`, so there is no trail for
    // a bad declaration to be missing from. Refusing it would let something
    // nobody is running stop the application from starting at all.
    if (plugin.enabled === false) continue;
    const declared = plugin.contributes?.audit?.kinds;
    if (!declared) continue;
    collectPluginAuditKinds(
      pluginAdminSlug(plugin.name),
      declared,
      plugin.name
    );
  }
  // Before anything reads it. A `clientConfig` that cannot be delivered is a
  // configuration error like an incompatible version, so it belongs with the
  // other fail-fast checks rather than surfacing when the admin first asks for
  // its metadata and losing the whole branding response with it.
  assertClientConfigs(plugins);
  // Beside it, and for the same reason one level up: a contributed widget rides
  // in the SAME `/api/admin-meta/workspace` payload, through the same single
  // `JSON.stringify`. A bigint under `query.where` is type-legal there, so the
  // throw lands on the workspace response for every admin rather than on the
  // one card -- which is a worse failure than a bad `clientConfig`, not a
  // lesser one.
  assertAdminWidgets(plugins);
  // Two plugins sharing an admin slug share an address, and nothing downstream
  // can detect it: every lookup along that address returns a plugin, which is
  // what a correct lookup returns. Registration is where the ambiguity is still
  // observable.
  validatePluginSlugs(plugins);
  // A menu item naming a collection its plugin does not contribute is the same
  // kind of mistake, and is equally unobservable downstream: the sidebar hides
  // the item from everyone without the never-seeded permission, which is what
  // a role legitimately lacking access looks like.
  validatePluginMenus(plugins);
}

export function resolvePlugins(
  plugins: PluginDefinition[],
  opts: ResolvePluginsOptions
): PluginDefinition[] {
  validatePluginVersions(plugins, opts.coreVersion);
  assertPluginManifests(plugins);
  // Last, because it reads what the earlier validators already accepted: a
  // declared schemaVersion must be one the plugin's own migrations reach.
  validateSchemaVersionDeclarations(plugins);
  return topoSortPlugins(plugins);
}

/**
 * A declared `schemaVersion` must be one its own migrations can reach, or the
 * boot check could never pass — caught where the manifest is read so the
 * failure names the declaration rather than arriving later as a production
 * boot refusal nothing explains.
 */
function validateSchemaVersionDeclarations(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    assertSchemaVersionDeclarable({
      pluginName: plugin.name,
      declaredVersion: plugin.schemaVersion,
      migrationVersions:
        plugin.contributes?.schema?.migrations?.map(m => m.schemaVersion) ??
        [],
    });
  }
}
