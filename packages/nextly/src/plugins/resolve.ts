import { MUST_CHANGE_PASSWORD_CHALLENGE } from "../auth/pipeline/pending-token";
import { collectPluginAuditKinds } from "../domains/audit/plugin-audit";
import { assertSchemaVersionDeclarable } from "../domains/schema/ownership/schema-version-check";
import type { NextlyError } from "../errors/nextly-error";
import { isReservedEventName } from "../events/event-bus";

import { validateCapabilities, validateRequires } from "./capabilities";
import { collectHookPoints, publishHookPoints } from "./hook-points";
import {
  assertConsentDeclaredBeforeSetup,
  assertPluginConsent,
  copyPluginDefinitions,
  decidePluginGrants,
  NO_PLUGIN_CONSENT,
  type PluginConsent,
  type PluginGrants,
  type PreSetupPlugin,
  recordPreSetupPlugins,
} from "./plugin-consent";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";
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
  /**
   * What the app lists plugins for (`pluginConsentFromConfig`). Read from the
   * config as the app wrote it, never from one a `setup` transformer
   * returned. Absent, nothing is listed, so a plugin declaring a capability
   * that needs the app's consent is refused.
   */
  consent?: PluginConsent;
}

export interface ResolveTransformedPluginsOptions
  extends ResolvePluginsOptions {
  /**
   * The plugin list as configured, recorded before any `setup` transformer
   * ran (`resolveDeclaredPlugins`). A capability that needs the app's consent
   * is held on the transformed list only by a plugin that declared it here
   * under the same name.
   */
  declared: readonly PreSetupPlugin[];
}

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
  // A challenge under core's own password-change id would be offered in
  // place of that step, and two under one id leave the registry unable to say
  // which one a pending token names. The registry refuses both too, but only
  // when the auth dependencies are built — on every `/auth/*` request, each of
  // which then failed. Refused here, they fail the boot instead.
  assertChallengeIds(plugins);
  // A declared event under a core prefix, or outside the plugin's own
  // namespace, boots, appears in the generated types, and is then refused on
  // every emit — the per-plugin bus lets a plugin speak neither for core nor
  // for another plugin. Refused here, the mistake is named at boot.
  assertPluginEventNames(plugins);
}

/**
 * Refuse a plugin event declared under a prefix core reserves, or outside the
 * plugin's own namespace — the two names the per-plugin bus refuses to emit.
 */
function assertPluginEventNames(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const event of plugin.contributes?.events ?? []) {
      if (isReservedEventName(event.name)) {
        throw resolutionError(
          "plugin-event-name-reserved",
          `Plugin "${plugin.name}" declares the event "${event.name}", whose prefix core reserves for its own events.`,
          { plugin: plugin.name, event: event.name }
        );
      }
      if (!isInPluginNamespace(plugin.name, event.name)) {
        const prefix = `${pluginAdminSlug(plugin.name)}.`;
        throw resolutionError(
          "plugin-event-outside-namespace",
          `Plugin "${plugin.name}" declares the event "${event.name}", which must start with "${prefix}".`,
          { plugin: plugin.name, event: event.name, expectedPrefix: prefix }
        );
      }
    }
  }
}

/**
 * Refuse a plugin challenge declared under an id core reserves, or under an
 * id another enabled challenge already declares. Enabled plugins only, the
 * set the auth registry is built from.
 */
function assertChallengeIds(plugins: PluginDefinition[]): void {
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const challenge of plugin.contributes?.auth?.challenges ?? []) {
      if (challenge.id === MUST_CHANGE_PASSWORD_CHALLENGE) {
        throw resolutionError(
          "plugin-challenge-id-reserved",
          `Plugin "${plugin.name}" declares the challenge id "${challenge.id}", which core reserves for its forced password change.`,
          { plugin: plugin.name, challengeId: challenge.id }
        );
      }
      const owner = owners.get(challenge.id);
      if (owner !== undefined) {
        throw duplicateChallengeIdError(challenge.id, owner, plugin.name);
      }
      owners.set(challenge.id, plugin.name);
    }
  }
}

/** The refusal for a challenge id declared twice, naming both declarers. */
function duplicateChallengeIdError(
  challengeId: string,
  first: string,
  second: string
): NextlyError {
  return resolutionError(
    "plugin-challenge-id-duplicate",
    first === second
      ? `Plugin "${first}" declares the challenge id "${challengeId}" more than once.`
      : `Plugins "${first}" and "${second}" both declare the challenge id "${challengeId}".`,
    { plugins: [first, second], challengeId }
  );
}

/**
 * The single shared plugin resolver used by both the CLI and the runtime.
 * Validates compatibility, then returns dependency order. Fail-fast.
 *
 * Pure, so the boot (`register.ts`) and the CLI (`config-loader.ts`) resolve a
 * plugin list the same way.
 */
export function resolvePlugins(
  plugins: PluginDefinition[],
  opts: ResolvePluginsOptions
): PluginDefinition[] {
  validatePluginVersions(plugins, opts.coreVersion);
  assertPluginManifests(plugins);
  // After the manifests' shape is known good, so a capability is read from a
  // declaration that parsed. Here rather than in `assertPluginManifests`
  // because it judges the manifest against the app's config, which that
  // check never sees.
  assertPluginConsent(plugins, opts.consent ?? NO_PLUGIN_CONSENT);
  // Last, because it reads what the earlier validators already accepted: a
  // declared schemaVersion must be one the plugin's own migrations reach.
  validateSchemaVersionDeclarations(plugins);
  return topoSortPlugins(plugins);
}

/**
 * The configured plugins, resolved, and the record of them the checks after
 * the `setup` transformers judge against.
 *
 * Resolved from copies (`copyPluginDefinitions`), so the list the boot or CLI
 * goes on to use shares no object with the app's config, and recorded
 * (`recordPreSetupPlugins`) before any transformer can run. The boot and the
 * CLI both start from this.
 */
export function resolveDeclaredPlugins(
  plugins: readonly PluginDefinition[],
  opts: ResolvePluginsOptions
): { plugins: PluginDefinition[]; preSetup: readonly PreSetupPlugin[] } {
  const resolved = resolvePlugins(copyPluginDefinitions(plugins), opts);
  return { plugins: resolved, preSetup: recordPreSetupPlugins(resolved) };
}

/**
 * A config whose `setup` transformers have run, with its plugin list resolved
 * again in full.
 *
 * A transformer may add, rename or replace entries in `plugins`, and
 * everything after it consumes the transformed config. Resolving the whole
 * list again — versions, dependencies, cycles, every manifest assertion and
 * the topological sort — makes a transformer-added plugin as checked as a
 * declared one. The boot and the CLI both call this, so a configuration one
 * of them accepts is one the other accepts too. The grants the resolved list
 * holds (`decidePluginGrants`) are returned beside it.
 */
export function resolveTransformedPlugins<
  C extends { plugins?: PluginDefinition[] },
>(
  config: C,
  opts: ResolveTransformedPluginsOptions
): { config: C & { plugins: PluginDefinition[] }; grants: PluginGrants } {
  // Copied first, so every check below and everything after it reads one
  // snapshot of what the transformers returned, and an accessor on a
  // transformer-built definition is read once rather than at each check.
  const plugins = resolvePlugins(
    copyPluginDefinitions(config.plugins ?? []),
    opts
  );
  assertConsentDeclaredBeforeSetup(opts.declared, plugins);
  // Decided here, once, from the copies every check above read: the grants
  // travel beside the config to whatever builds a plugin context, and a
  // manifest changed after this point grants nothing.
  return {
    config: { ...config, plugins },
    grants: decidePluginGrants(plugins),
  };
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
        plugin.contributes?.schema?.migrations?.map(m => m.schemaVersion) ?? [],
    });
  }
}
