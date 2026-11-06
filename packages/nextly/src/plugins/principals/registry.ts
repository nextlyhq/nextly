/**
 * The kinds of signed-in person the running plugins register.
 *
 * Collected and checked once, when the plugin list is resolved, so a kind
 * that cannot work stops the application from starting rather than surfacing
 * as a route that refuses everyone. Published, like the declared hook points,
 * because recognition runs long after resolution and has only the kind's
 * name to go on.
 *
 * @module plugins/principals/registry
 */
import {
  AUDIT_ACTOR_KIND_LENGTH,
  AUDIT_ACTOR_PRINCIPAL_KIND_LENGTH,
  AUDIT_TARGET_PRINCIPAL_KIND_LENGTH,
} from "../../schemas/audit/widths";
import { EMAIL_DELIVERY_PRINCIPAL_KIND_LENGTH } from "../../schemas/email-deliveries/widths";
import type { PluginDefinition } from "../plugin-context";
import { pluginAdminSlug } from "../plugin-slug";
import { resolutionError } from "../resolution-error";

import type {
  PrincipalAttributeType,
  PrincipalKindContribution,
} from "./types";

/** One registered kind, and the plugin that registered it. */
export interface RegisteredPrincipalKind {
  /** `<plugin>:<name>`, the one name every entry point asks by. */
  readonly kind: string;
  /** The registering plugin's name, as declared. */
  readonly plugin: string;
  /** The name the plugin gave it, without the plugin's prefix. */
  readonly name: string;
  /**
   * The declared attributes, copied when the kind was collected, so a plugin
   * that changes its definition object afterwards changes nothing that
   * recognition checks an answer against.
   */
  readonly attributes: Readonly<Record<string, PrincipalAttributeType>>;
  /** The definition itself, called as a method so a class-based one keeps its `this`. */
  readonly definition: PrincipalKindContribution;
}

/**
 * A kind's own name: a lowercase letter, then up to 31 lowercase letters,
 * digits or dashes. Short and plain, because it is half of a name that lands
 * in audit rows and email records.
 */
const KIND_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * An attribute's name: a letter, then letters, digits or underscores. Rules
 * read attributes by property, so a name like `__proto__` would reach the
 * object's prototype rather than a value.
 */
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The longest full kind name (`<plugin slug>:<name>`) core accepts: the
 * narrowest column an audit row or an email delivery record stores one in.
 *
 * PostgreSQL and MySQL keep a kind in bounded varchars, and SQLite in text,
 * which holds anything, so the bounded declarations decide. A longer name
 * fails every audit write naming such a person, and audit writes are
 * fail-safe, so the failure would be a log line and the row would never
 * exist. The widths the columns' declarations are written with rather than
 * restated, so a column narrowed later tightens the bound instead of
 * silently disagreeing with it.
 */
export const PRINCIPAL_KIND_MAX_LENGTH = Math.min(
  AUDIT_ACTOR_KIND_LENGTH,
  AUDIT_ACTOR_PRINCIPAL_KIND_LENGTH,
  AUDIT_TARGET_PRINCIPAL_KIND_LENGTH,
  EMAIL_DELIVERY_PRINCIPAL_KIND_LENGTH
);

const ATTRIBUTE_TYPES: ReadonlySet<string> = new Set<PrincipalAttributeType>([
  "boolean",
  "string",
  "number",
]);

/** The full name core gives a plugin's kind: `<plugin slug>:<name>`. */
export function principalKindName(pluginName: string, name: string): string {
  return `${pluginAdminSlug(pluginName)}:${name}`;
}

/**
 * The kinds this process resolved.
 *
 * Module-level for the reason the declared hook points are: resolution runs
 * once, and every request asks the same question of its result afterwards.
 */
let registeredKinds: ReadonlyMap<string, RegisteredPrincipalKind> = new Map();

/**
 * Where publication goes while a dev reload holds it: the reload's own stage,
 * or nowhere when no reload is running.
 */
let stage: { kinds?: ReadonlyMap<string, RegisteredPrincipalKind> } | null =
  null;

export function publishPrincipalKinds(
  kinds: ReadonlyMap<string, RegisteredPrincipalKind>
): void {
  if (stage !== null) {
    stage.kinds = kinds;
    return;
  }
  registeredKinds = kinds;
}

/**
 * Hold publication for the length of a dev reload.
 *
 * Reading the reloaded config publishes its kinds, long before the reload
 * knows whether it will land, and requests keep being served meanwhile. Held,
 * those kinds wait on the stage: routes go on recognising people through the
 * kinds in force until `commit` installs the new ones, and `abandon` drops
 * them, so no request ever reaches a resolver from a config the process has
 * not accepted. Each settles once; whichever comes second does nothing.
 */
export function stagePrincipalKinds(): {
  commit: () => void;
  abandon: () => void;
} {
  const held: { kinds?: ReadonlyMap<string, RegisteredPrincipalKind> } = {};
  stage = held;
  let settled = false;
  const settle = (install: boolean): void => {
    if (settled) return;
    settled = true;
    if (stage === held) stage = null;
    if (install && held.kinds !== undefined) registeredKinds = held.kinds;
  };
  return { commit: () => settle(true), abandon: () => settle(false) };
}

/** The registered kind with this full name, or `undefined`. */
export function getPrincipalKind(
  kind: string
): RegisteredPrincipalKind | undefined {
  return registeredKinds.get(kind);
}

/**
 * The declared attributes, checked and copied, or the reason they cannot be
 * used.
 *
 * Checked here rather than trusted to the type: a JavaScript plugin has no
 * type, and an attribute declared as `"date"` would otherwise make every
 * answer fail recognition at runtime, with nothing at boot to say why.
 */
function declaredAttributes(
  value: unknown
): Record<string, PrincipalAttributeType> | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "attributes must be an object naming each attribute's type";
  }
  const attributes: Record<string, PrincipalAttributeType> = {};
  for (const [name, type] of Object.entries(value)) {
    if (!ATTRIBUTE_NAME.test(name)) {
      return `attribute name ${JSON.stringify(name)} must start with a letter and hold only letters, digits and underscores, at most 64 characters`;
    }
    if (typeof type !== "string" || !ATTRIBUTE_TYPES.has(type)) {
      return `attribute ${JSON.stringify(name)} must be "boolean", "string" or "number", not ${JSON.stringify(type)}`;
    }
    attributes[name] = type as PrincipalAttributeType;
  }
  return attributes;
}

/**
 * The full name a plugin's kind gets, or why its name cannot be used: not of
 * the kind-name form, or, joined to the plugin's slug, too long to store.
 */
function fullKindName(
  pluginName: string,
  name: unknown
): { kind: string } | string {
  if (typeof name !== "string" || !KIND_NAME.test(name)) {
    return `name ${JSON.stringify(name)} must be a lowercase letter followed by at most 31 lowercase letters, digits or dashes`;
  }
  const kind = principalKindName(pluginName, name);
  if (kind.length > PRINCIPAL_KIND_MAX_LENGTH) {
    return `the full name ${JSON.stringify(kind)} is longer than the ${PRINCIPAL_KIND_MAX_LENGTH} characters an audit row stores a kind in`;
  }
  return { kind };
}

/** Why a plugin's kind cannot be registered, or the kind to register. */
function checkedKind(
  plugin: PluginDefinition,
  definition: PrincipalKindContribution
): RegisteredPrincipalKind | string {
  const named = fullKindName(plugin.name, definition?.name);
  if (typeof named === "string") return named;
  const { kind } = named;
  if (typeof definition.resolve !== "function") {
    return "resolve must be a function";
  }
  if (
    definition.lookup !== undefined &&
    typeof definition.lookup !== "function"
  ) {
    return "lookup must be a function when given";
  }
  const attributes = declaredAttributes(definition.attributes);
  if (typeof attributes === "string") return attributes;
  return {
    kind,
    plugin: plugin.name,
    name: definition.name,
    attributes: Object.freeze(attributes),
    definition,
  };
}

/**
 * Collect every enabled plugin's kinds, refusing one that cannot work or
 * whose full name another already holds.
 *
 * Disabled plugins are skipped, as their hook points are: a plugin that is off
 * recognises nobody, and refusing its declaration would let something nobody
 * runs stop the application from starting.
 */
export function collectPrincipalKinds(
  plugins: readonly PluginDefinition[]
): Map<string, RegisteredPrincipalKind> {
  const kinds = new Map<string, RegisteredPrincipalKind>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const definition of plugin.contributes?.principals ?? []) {
      const checked = checkedKind(plugin, definition);
      if (typeof checked === "string") {
        throw resolutionError(
          "principal-kind-invalid",
          `Plugin "${plugin.name}" registers a kind of signed-in person that cannot be used: ${checked}.`,
          { plugin: plugin.name, problem: checked }
        );
      }
      const existing = kinds.get(checked.kind);
      if (existing) {
        // Both owners named, as for a hook point: two plugins whose names
        // reduce to one slug collide here without either declaring the other.
        throw resolutionError(
          "principal-kind-collision",
          `Plugins "${existing.plugin}" and "${plugin.name}" both register the kind of signed-in person "${checked.kind}".`,
          {
            principalKind: checked.kind,
            owners: [existing.plugin, plugin.name],
          }
        );
      }
      kinds.set(checked.kind, checked);
    }
  }
  return kinds;
}
