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
import { z } from "zod";

import { nextlyPluginSettings as mysqlPluginSettings } from "../schemas/plugin-settings/mysql";

import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { outboundEntry } from "./runtime/address-rules";
import { isValidRange, satisfiesRange } from "./semver-range";

/**
 * The SHAPE of a manifest, strict at every level.
 *
 * Checked before anything reads it, because each semantic check below assumes
 * the shape: `outbound: "api.stripe.com"` as a string was iterated by
 * character and reported the host "a", and a misspelled nested key —
 * `net: { outBound }`, `db: { rawSQL }` — was simply not read, so the plugin
 * booted without the `ctx.fetch` it declared. A key the manifest does not
 * define is a typo, at any depth.
 */
const MANIFEST_SHAPE = z.object({
  capabilities: z
    .strictObject({
      net: z.strictObject({ outbound: z.array(z.string()) }).optional(),
      db: z.strictObject({ rawSql: z.boolean().optional() }).optional(),
      secrets: z.array(z.string().min(1)).optional(),
      auth: z.strictObject({ login: z.boolean().optional() }).optional(),
    })
    .optional(),
  provides: z.array(z.string().min(1)).optional(),
  requires: z
    .record(
      z.string().min(1),
      // Non-empty first: semver reads "" as "*", which would accept any
      // provider version for a range nobody wrote.
      z.string().min(1).refine(isValidRange, { message: "not a semver range" })
    )
    .optional(),
  schemaVersion: z.number().int().positive().optional(),
});

/** Refuse a manifest whose shape is not the one the runtime reads. */
function assertManifestShape(plugin: PluginDefinition): void {
  const parsed = MANIFEST_SHAPE.safeParse({
    capabilities: plugin.capabilities,
    provides: plugin.provides,
    requires: plugin.requires,
    schemaVersion: plugin.schemaVersion,
  });
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const at = issue.path.join(".");
  // The two refusals that had their own reasons before the shape was checked
  // whole keep them, so an operator's log search still finds them.
  if (at === "capabilities" && issue.code === "unrecognized_keys") {
    const key = issue.keys[0];
    throw resolutionError(
      "unknown-capability",
      `Plugin "${plugin.name}" declares an unknown capability "${key}".`,
      { plugin: plugin.name, capability: key }
    );
  }
  if (at === "schemaVersion") {
    throw resolutionError(
      "invalid-schema-version",
      `Plugin "${plugin.name}" declares schemaVersion ${String(plugin.schemaVersion)}; it must be a positive integer.`,
      { plugin: plugin.name, schemaVersion: plugin.schemaVersion }
    );
  }
  throw resolutionError(
    "invalid-manifest",
    `Plugin "${plugin.name}" declares an invalid manifest at "${at}": ${issue.message}.`,
    { plugin: plugin.name, path: at, issue: issue.message }
  );
}

/** A dotted-quad, which the hostname pattern would otherwise accept. */
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A hostname, or one leading `*.` wildcard.
 *
 * IP literals are refused deliberately. An allowlist is a statement about WHO
 * a plugin talks to, and an address is not who anybody is — it changes hands,
 * and `ctx.fetch` resolves names to addresses itself precisely so the answer
 * cannot be swapped underneath the check.
 */
const OUTBOUND_HOST =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The one name with no dot that a manifest may still declare.
 *
 * The pattern above requires a dot, so `capabilities.net.outbound:
 * ["localhost"]` failed BOOT — which made the documented development-only
 * loopback exception unreachable through a real manifest: no plugin could
 * declare the host it needs to reach a fake provider in its own tests.
 *
 * Accepting the name here is not what permits the connection. `ctx.fetch`
 * still resolves it and refuses a loopback address outside development, so
 * production is unchanged by this.
 */
const LOOPBACK_HOST = "localhost";

function plugins(all: PluginDefinition[]): PluginDefinition[] {
  // A disabled plugin contributes nothing, so it neither provides a capability
  // another plugin could require nor has a manifest worth enforcing.
  return all.filter(plugin => plugin.enabled !== false);
}

/**
 * Refuse an outbound entry that is not a hostname, optionally with a port.
 *
 * Split by the same parser `ctx.fetch` matches with, so an entry the manifest
 * accepts is one the runtime reads the same way.
 */
function assertOutboundHosts(plugin: PluginDefinition): void {
  for (const entry of plugin.capabilities?.net?.outbound ?? []) {
    if (!isOutboundEntry(entry)) {
      throw resolutionError(
        "invalid-outbound-host",
        `Plugin "${plugin.name}" declares an outbound host that is not a hostname with an optional port: "${entry}".`,
        { plugin: plugin.name, host: entry }
      );
    }
  }
}

/** Whether an outbound entry is a hostname, optionally with a valid port. */
function isOutboundEntry(entry: string): boolean {
  const { pattern: host, port } = outboundEntry(entry);
  // An IP literal is a valid hostname as far as the pattern is concerned —
  // every label is digits — so it is refused explicitly. An allowlist is a
  // statement about WHO a plugin talks to, and an address is not who anybody
  // is.
  if (IP_LITERAL.test(host)) return false;
  if (host !== LOOPBACK_HOST && !OUTBOUND_HOST.test(host)) return false;
  return port === undefined || (port >= 1 && port <= 65_535);
}

/**
 * Refuse a secret path that is empty, repeated, absent from the schema, or
 * names a group rather than a value.
 */
function assertSecretPaths(plugin: PluginDefinition): void {
  const secrets = plugin.capabilities?.secrets ?? [];
  // Secrets name settings, so they mean nothing without a settings schema:
  // nothing would ever be stored for them to encrypt.
  if (secrets.length > 0 && !plugin.contributes?.settings) {
    throw resolutionError(
      "secrets-without-settings",
      `Plugin "${plugin.name}" declares secret paths but no settings schema (contributes.settings) for them to name.`,
      { plugin: plugin.name }
    );
  }
  const seen = new Set<string>();
  for (const path of secrets) {
    assertSecretPath(plugin, path, seen);
    seen.add(path);
  }
}

/** Refuse one secret path that is empty, repeated, unknown, or a group. */
function assertSecretPath(
  plugin: PluginDefinition,
  path: string,
  seen: ReadonlySet<string>
): void {
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
  // A secret path the schema does not have is a credential stored in plain
  // text, because nothing matches it on the way in and nothing redacts it on
  // the way out — and it fails silently, which is the worst way for that to
  // be wrong.
  if (!schemaHasPath(plugin, path)) {
    throw resolutionError(
      "unknown-secret-path",
      `Plugin "${plugin.name}" declares the secret path "${path}", which its settings schema does not contain.`,
      { plugin: plugin.name, path }
    );
  }
  // A secret is a credential, which is a string. A path naming a group
  // booted, and then every save failed with "A secret setting must be a
  // string" — found by the operator, not the author.
  if (pathEndsInGroup(plugin.contributes?.settings, path)) {
    throw resolutionError(
      "secret-path-names-group",
      `Plugin "${plugin.name}" declares the secret path "${path}", which names a group of settings rather than one value; name the value inside it.`,
      { plugin: plugin.name, path }
    );
  }
}

/**
 * Whether a path, followed through object shapes, records and arrays, ends at
 * an object, record or array — a group rather than a value.
 *
 * Answers only where the walk is certain. A union, a pipe or a lazy schema on
 * the way answers false, leaving those to the existence check above and to
 * the write-time refusal of a non-string secret.
 */
function pathEndsInGroup(schema: unknown, path: string): boolean {
  if (!schema) return false;
  let current: unknown = schema;
  for (const segment of path.split(".")) {
    current = groupMember(current, segment);
    if (current === null) return false;
  }
  return isGroupSchema(current);
}

/**
 * The schema a segment reaches inside a node: a named key of an object, or
 * the entries of a record or array for `*`. Null where the walk is not
 * certain, which makes the caller answer "not a group".
 */
function groupMember(node: unknown, segment: string): unknown {
  const shape = objectShape(node);
  if (shape !== null) {
    return segment !== "*" && Object.hasOwn(shape, segment)
      ? shape[segment]
      : null;
  }
  if (segment !== "*") return null;
  return recordValueSchema(node) ?? arrayElementSchema(node);
}

/** Whether a schema node is an object, record or array. */
function isGroupSchema(node: unknown): boolean {
  return (
    objectShape(node) !== null ||
    recordValueSchema(node) !== null ||
    arrayElementSchema(node) !== null
  );
}

/**
 * The identifier widths the settings storage declares, read from the MySQL
 * table — the bounded one of the three dialects, and therefore the ceiling a
 * portable manifest has to fit. Read as plain column properties rather than
 * restated, so a widened column loosens the refusal with it.
 */
const SETTINGS_OWNER_MAX = (() => {
  const length = (mysqlPluginSettings.owner as { length?: number }).length;
  return typeof length === "number" ? length : Number.MAX_SAFE_INTEGER;
})();
const SETTINGS_KEY_MAX = (() => {
  const length = (mysqlPluginSettings.key as { length?: number }).length;
  return typeof length === "number" ? length : Number.MAX_SAFE_INTEGER;
})();

/**
 * Refuse settings identifiers the storage cannot hold.
 *
 * The owner column carries the plugin's name and the key column a top-level
 * schema key, both bounded on MySQL: a longer one booted normally on every
 * dialect and failed its first `ctx.settings.set()` under MySQL's strict
 * mode — or truncated into a collision under permissive modes. A bound the
 * narrowest dialect enforces is a property of the storage, not of MySQL, so
 * the refusal holds on all three.
 */
function assertSettingsIdentifiers(plugin: PluginDefinition): void {
  const schema = plugin.contributes?.settings;
  if (!schema) return;
  if (plugin.name.length > SETTINGS_OWNER_MAX) {
    throw resolutionError(
      "plugin-name-too-long-for-settings",
      `Plugin "${plugin.name}" stores settings, and its name is longer than the ${SETTINGS_OWNER_MAX} characters the settings storage holds.`,
      { plugin: plugin.name, maxLength: SETTINGS_OWNER_MAX }
    );
  }
  for (const key of Object.keys(schema.shape)) {
    if (key.length > SETTINGS_KEY_MAX) {
      throw resolutionError(
        "settings-key-too-long",
        `Plugin "${plugin.name}" declares the settings key "${key}", which is longer than the ${SETTINGS_KEY_MAX} characters the settings storage holds.`,
        { plugin: plugin.name, key, maxLength: SETTINGS_KEY_MAX }
      );
    }
  }
}

/**
 * Check every plugin's own manifest: its shape (schema version included), the
 * hosts it names, the secrets it lists, and its settings identifiers.
 */
export function validateCapabilities(all: PluginDefinition[]): void {
  for (const plugin of plugins(all)) {
    assertManifestShape(plugin);
    assertOutboundHosts(plugin);
    assertSecretPaths(plugin);
    assertSettingsIdentifiers(plugin);
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
 * The schema an ARRAY's elements carry, or null when this is not an array.
 *
 * Unwrapped like its siblings, because an array is no less likely to arrive
 * optional or defaulted than an object is.
 */
function arrayElementSchema(node: unknown): unknown {
  let current = node;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = (
      current as {
        _zod?: { def?: { element?: unknown; innerType?: unknown } };
      }
    )._zod?.def;
    if (def?.element !== undefined) return def.element;
    if (def?.innerType === undefined) return null;
    current = def.innerType;
  }
  return null;
}

/**
 * Zod type names whose instances cannot have anything BENEATH them, so a path
 * still holding segments at one of them names a place that does not exist.
 *
 * Anything absent from this set — a union, a pipe, a lazy schema, `unknown` —
 * keeps the "cannot enumerate, accept" answer below, because refusing a
 * declaration this feature exists to support is the worse error. Membership is
 * about what CAN be proven: a string is provably a leaf; what a lazy schema
 * produces is provably nothing until it is asked.
 */
const LEAF_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "int",
  "boolean",
  "bigint",
  "date",
  "symbol",
  "null",
  "undefined",
  "literal",
  "nan",
  "file",
  "blob",
]);

/**
 * Whether a schema node is a LEAF that no further segment can descend into.
 *
 * Unwraps the same wrappers the probes above unwrap before reading the type
 * name, so an optional string is a leaf exactly where a required one is.
 */
function isLeafSchema(node: unknown): boolean {
  let current = node;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = (
      current as {
        _zod?: { def?: { innerType?: unknown; type?: unknown } };
      }
    )._zod?.def;
    if (def?.innerType !== undefined) {
      current = def.innerType;
      continue;
    }
    return typeof def?.type === "string" && LEAF_SCHEMA_TYPES.has(def.type);
  }
  return false;
}

/**
 * The alternatives a union offers, or null when this is not a union.
 *
 * Unwrapped like its siblings, because a union is no less likely to arrive
 * optional or defaulted than an object is. Discriminated unions carry the
 * same `options` array in their definition, so both spellings answer here.
 */
function unionOptions(node: unknown): unknown[] | null {
  let current = node;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = (
      current as {
        _zod?: { def?: { innerType?: unknown; options?: unknown } };
      }
    )._zod?.def;
    if (Array.isArray(def?.options)) return def.options;
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
  // Unreachable through `assertSecretPaths`, which refuses secrets without a
  // schema first; kept so the walk below never reads an absent schema.
  if (!schema) return true;
  return schemaHasPathFrom(schema, path);
}

/**
 * What a segment meets at a schema node that is neither object nor array nor
 * record: descend into the record's values, or a final yes/no.
 *
 * A DISJOINT return rather than a boolean, because the record case has to
 * hand the loop its next node — a `null | unknown` shape would read as
 * "refuse" the moment a record's value schema is itself null.
 */
type NonObjectStep = { descend: unknown } | { match: boolean };

/**
 * Resolve one segment against a node that is not a plain object shape.
 *
 * An array holds its elements under a def of their own, which none of the
 * other probes read: `recordValueSchema` answers null for one, and accepting
 * on that let `providers.*.clientSecrett` pass over a list — the same typo
 * the object walk refuses, waved through because the list spelled its
 * children differently. A `*` means each element, so the rest of the path is
 * checked against the element schema; a NAME matches no element, because
 * none of them has one.
 *
 * A leaf with segments left is a typo of the same kind the object walk
 * refuses: `clientSecret.typo` over `clientSecret: z.string()` names a place
 * inside a string, which does not exist — and accepting it left `mapSecrets`
 * matching nothing, so the real credential was stored in plain text and
 * returned unredacted.
 *
 * A union's alternatives ARE enumerable — each is a schema a value may take —
 * so the remaining path is checked against every option and held only when
 * one of them contains it. Treating unions as opaque let `credentials.clientSecrett`
 * pass over a union whose every variant spells `clientSecret`, the same silent
 * credential exposure the other probes close.
 *
 * What remains is genuinely not enumerable — a pipe, a lazy schema or
 * `unknown` — and refusing there would reject declarations this feature
 * exists to support.
 */
function nonObjectStep(
  node: unknown,
  segment: string,
  rest: string
): NonObjectStep {
  const elementSchema = arrayElementSchema(node);
  if (elementSchema !== null) {
    if (segment !== "*") return { match: false };
    if (rest === "") return { match: true };
    return { match: schemaHasPathFrom(elementSchema, rest) };
  }
  const valueSchema = recordValueSchema(node);
  if (valueSchema !== null) return { descend: valueSchema };
  const options = unionOptions(node);
  if (options !== null) {
    const suffix = rest === "" ? segment : `${segment}.${rest}`;
    return { match: options.some(option => schemaHasPathFrom(option, suffix)) };
  }
  if (isLeafSchema(node)) return { match: false };
  return { match: true };
}

/**
 * The same walk, entered partway down rather than at a plugin's root.
 *
 * Split out so the wildcard branches above can ask the question of each value
 * in turn; `schemaHasPath` takes a plugin because that is what its callers
 * hold, and re-deriving the traversal here would be a second implementation
 * of it.
 */
function schemaHasPathFrom(node: unknown, path: string): boolean {
  let current: unknown = node;
  const segments = path.split(".");
  for (let at = 0; at < segments.length; at += 1) {
    const segment = segments[at];
    const rest =
      at + 1 < segments.length ? segments.slice(at + 1).join(".") : "";
    const shape = objectShape(current);
    if (shape === null) {
      const step = nonObjectStep(current, segment, rest);
      if ("descend" in step) {
        current = step.descend;
        continue;
      }
      return step.match;
    }
    if (segment === "*") {
      if (rest === "") return true;
      return Object.values(shape).some(value => schemaHasPathFrom(value, rest));
    }
    if (!Object.hasOwn(shape, segment)) return false;
    current = shape[segment];
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
      const existing = provided.get(capability);
      if (existing) {
        // REFUSED rather than overwritten. Replacing the first provider made
        // the winner depend on the order the plugins happen to sit in the
        // config array, so a consumer's version requirement passed or failed
        // for a reason no manifest records — and nothing downstream can tell
        // which implementation it actually got. Both names, because with one
        // the reader has to go and find the other.
        throw resolutionError(
          "capability-provided-twice",
          `Plugins "${existing.plugin}" and "${plugin.name}" both provide the capability "${capability}".`,
          { capability, providers: [existing.plugin, plugin.name] }
        );
      }
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
