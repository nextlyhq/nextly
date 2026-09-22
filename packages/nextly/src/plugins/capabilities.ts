/**
 * What a plugin declares it may do, provides, and needs.
 *
 * Nextly runs plugins as trusted code in the host's own process; nothing here
 * is a sandbox, and it is not trying to be one. A manifest is a REVIEWABLE
 * CONTRACT: it makes the reach of a plugin legible before it is installed, and
 * it is what the runtime surfaces enforce — `ctx.fetch` exists only for a
 * plugin that declared the hosts it calls, and the settings store encrypts
 * exactly the keys named as secrets.
 *
 * Every refusal here is a boot failure. A manifest that is wrong is wrong
 * before anything runs, and starting anyway means discovering it later through
 * a surface that quietly did not exist.
 *
 * @module plugins/capabilities
 * @since 1.0.0
 */
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { satisfiesRange } from "./semver-range";

/** The capability keys a plugin may declare. Anything else is a typo. */
const KNOWN_CAPABILITIES = ["net", "db", "secrets"] as const;

/**
 * A hostname, or one leading `*.` wildcard.
 *
 * IP literals are refused deliberately. An allowlist is a statement about WHO
 * a plugin talks to, and an address is not who anybody is — it changes hands,
 * and `ctx.fetch` resolves names to addresses itself precisely so the answer
 * cannot be swapped underneath the check.
 */
/** A dotted-quad, which the hostname pattern would otherwise accept. */
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

const OUTBOUND_HOST =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function plugins(all: PluginDefinition[]): PluginDefinition[] {
  // A disabled plugin contributes nothing, so it neither provides a capability
  // another plugin could require nor has a manifest worth enforcing.
  return all.filter(plugin => plugin.enabled !== false);
}

/**
 * Check every plugin's own manifest: the keys it declares, the hosts it names,
 * the secrets it lists, and its schema version.
 */
/** Refuse a capability key the runtime does not implement. */
function assertKnownCapabilities(plugin: PluginDefinition): void {
  for (const key of Object.keys(plugin.capabilities ?? {})) {
    if (
      !KNOWN_CAPABILITIES.includes(key as (typeof KNOWN_CAPABILITIES)[number])
    ) {
      throw resolutionError(
        "unknown-capability",
        `Plugin "${plugin.name}" declares an unknown capability "${key}".`,
        { plugin: plugin.name, capability: key }
      );
    }
  }
}

/** Refuse an outbound entry that is not a hostname. */
function assertOutboundHosts(plugin: PluginDefinition): void {
  for (const host of plugin.capabilities?.net?.outbound ?? []) {
    // An IP literal is a valid hostname as far as the pattern is concerned —
    // every label is digits — so it is refused explicitly. An allowlist is a
    // statement about WHO a plugin talks to, and an address is not who
    // anybody is.
    if (!OUTBOUND_HOST.test(host) || IP_LITERAL.test(host)) {
      throw resolutionError(
        "invalid-outbound-host",
        `Plugin "${plugin.name}" declares an outbound host that is not a hostname: "${host}".`,
        { plugin: plugin.name, host }
      );
    }
  }
}

/** Refuse a secret path that is empty, repeated, or absent from the schema. */
function assertSecretPaths(plugin: PluginDefinition): void {
  const seen = new Set<string>();
  for (const path of plugin.capabilities?.secrets ?? []) {
    if (typeof path !== "string" || path.length === 0) {
      throw resolutionError(
        "invalid-secret-path",
        `Plugin "${plugin.name}" declares an empty secret path.`,
        { plugin: plugin.name }
      );
    }
    if (seen.has(path)) {
      throw resolutionError(
        "invalid-secret-path",
        `Plugin "${plugin.name}" declares the secret path "${path}" twice.`,
        { plugin: plugin.name, path }
      );
    }
    seen.add(path);

    // A secret path the schema does not have is a credential stored in plain
    // text, because nothing matches it on the way in and nothing redacts it
    // on the way out — and it fails silently, which is the worst way for that
    // to be wrong.
    if (!schemaHasPath(plugin, path)) {
      throw resolutionError(
        "unknown-secret-path",
        `Plugin "${plugin.name}" declares the secret path "${path}", which its settings schema does not contain.`,
        { plugin: plugin.name, path }
      );
    }
  }
}

/**
 * Refuse a schema version that is not a positive integer.
 *
 * The whole of the check. Comparing it against what a database has applied
 * needs plugin migration state, which does not exist yet, so nothing here
 * stops a plugin booting ahead of its tables.
 */
function assertSchemaVersion(plugin: PluginDefinition): void {
  const version = plugin.schemaVersion;
  if (version === undefined) return;
  if (!Number.isInteger(version) || version < 1) {
    throw resolutionError(
      "invalid-schema-version",
      `Plugin "${plugin.name}" declares schemaVersion ${String(version)}; it must be a positive integer.`,
      { plugin: plugin.name, schemaVersion: version }
    );
  }
}

/**
 * Check every plugin's own manifest: the keys it declares, the hosts it names,
 * the secrets it lists, and its schema version.
 */
export function validateCapabilities(all: PluginDefinition[]): void {
  for (const plugin of plugins(all)) {
    assertKnownCapabilities(plugin);
    assertOutboundHosts(plugin);
    assertSecretPaths(plugin);
    assertSchemaVersion(plugin);
  }
}

/**
 * The object shape a schema node exposes, or null when it has none.
 *
 * Optionals, nullables and defaults wrap the type they decorate, so the shape
 * lives one or more levels in; a record has no enumerable keys at all and is
 * reported as null rather than as an empty object, which would refuse every
 * key under it.
 */
function objectShape(node: unknown): Record<string, unknown> | null {
  let current = node;
  // Bounded rather than `while (true)`: a malformed schema must not spin.
  for (let depth = 0; depth < 10; depth += 1) {
    const shape = (current as { shape?: unknown }).shape;
    if (shape !== null && typeof shape === "object") {
      return shape as Record<string, unknown>;
    }
    const def = (current as { _zod?: { def?: { innerType?: unknown } } })._zod
      ?.def;
    if (def?.innerType === undefined) return null;
    current = def.innerType;
  }
  return null;
}

/**
 * The schema a record's VALUES carry, or null when this is not a record.
 *
 * Unwrapped the same way {@link objectShape} unwraps, because a record is just
 * as likely to be optional or defaulted as an object is.
 */
function recordValueSchema(node: unknown): unknown {
  let current = node;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = (
      current as {
        _zod?: { def?: { innerType?: unknown; valueType?: unknown } };
      }
    )._zod?.def;
    if (def?.valueType !== undefined) return def.valueType;
    if (def?.innerType === undefined) return null;
    current = def.innerType;
  }
  return null;
}

/**
 * Whether a plugin's declared settings schema contains a path.
 *
 * Every CONCRETE segment is resolved, not just the first. Checking only the
 * head accepted `providers.google.clientSecrett` on the strength of
 * `providers` existing — and a secret path that matches nothing is not an
 * inert typo: `mapSecrets` then never finds the real `clientSecret`, so that
 * credential is stored in plain text and returned unredacted by
 * `getRedacted()`. The silent failure this check exists to prevent is
 * precisely the one a head-only check waves through.
 *
 * A `*` and a record key both match any NAME, which says nothing about what
 * lies beneath them: `providers.*.clientSecrett` is the same typo one level
 * down, and stopping at the wildcard waved it through exactly as stopping at
 * the head did. So a wildcard descends into the record's value schema and the
 * remaining concrete segments are checked against it.
 *
 * Acceptance is reserved for what genuinely cannot be enumerated — a shape
 * that is neither an object nor a record — because refusing there would
 * reject declarations this feature exists to support.
 */
function schemaHasPath(plugin: PluginDefinition, path: string): boolean {
  const schema = plugin.contributes?.settings;
  // Nothing to check against: a plugin may declare secrets before it declares
  // a schema, and resolution is not the place to demand an ordering.
  if (!schema) return true;

  let current: unknown = schema;
  for (const segment of path.split(".")) {
    const shape = objectShape(current);
    if (shape !== null) {
      // A `*` against an OBJECT matches whichever keys it has, so nothing
      // below can be pinned to one of them.
      if (segment === "*") return true;
      if (!Object.hasOwn(shape, segment)) return false;
      current = shape[segment];
      continue;
    }

    // Any key is valid on a record — that is what a record means — so the
    // segment itself is accepted and the suffix is judged against the values.
    const valueSchema = recordValueSchema(current);
    if (valueSchema === null) return true;
    current = valueSchema;
  }
  return true;
}

/** Which plugin provides each capability name, and at what version. */
export function resolveProvides(
  all: PluginDefinition[]
): Map<string, { plugin: string; version: string }> {
  const provided = new Map<string, { plugin: string; version: string }>();
  for (const plugin of plugins(all)) {
    for (const capability of plugin.provides ?? []) {
      provided.set(capability, {
        plugin: plugin.name,
        version: plugin.version,
      });
    }
  }
  return provided;
}

/**
 * Check that everything a plugin requires is provided, at a compatible version.
 *
 * The range is matched against the PROVIDING PLUGIN's version, not against a
 * version of the capability itself: a capability is a shape its provider
 * publishes, so the provider's version is the only thing that can change it.
 */
export function validateRequires(all: PluginDefinition[]): void {
  const provided = resolveProvides(all);

  for (const plugin of plugins(all)) {
    for (const [capability, range] of Object.entries(plugin.requires ?? {})) {
      const provider = provided.get(capability);
      if (!provider) {
        throw resolutionError(
          "missing-capability",
          `Plugin "${plugin.name}" requires the capability "${capability}", which no enabled plugin provides.`,
          { plugin: plugin.name, capability, range }
        );
      }
      if (!satisfiesRange(provider.version, range)) {
        throw resolutionError(
          "capability-version-incompatible",
          `Plugin "${plugin.name}" requires "${capability}" ${range}, but "${provider.plugin}" provides it at ${provider.version}.`,
          {
            plugin: plugin.name,
            capability,
            range,
            provider: provider.plugin,
            providerVersion: provider.version,
          }
        );
      }
    }
  }
}
