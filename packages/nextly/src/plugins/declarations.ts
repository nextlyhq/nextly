/**
 * Reading what plugins statically declared for one another.
 *
 * `contributes.declarations` is deliberately typed `unknown` in core, because
 * core does not know what any of it means. This is the one place that walks it,
 * so a consuming plugin gets its entries already paired with the plugin that
 * wrote them instead of every consumer re-deriving that from the plugin list.
 *
 * Provenance travels with the value for the same reason it does on a contributed
 * block: when two plugins declare something that collides, the error has to name
 * both, and a value separated from its author cannot.
 *
 * @module plugins/declarations
 */

import type { PluginDefinition } from "./plugin-context";

/** One plugin's declaration for a consumer, with the plugin that made it. */
export interface PluginDeclaration {
  /** The declaring plugin's name, for attribution in errors. */
  source: string;
  /** Whatever that plugin declared. The consumer decides what shape is valid. */
  value: unknown;
}

/**
 * Every declaration addressed to `consumer`, in plugin order.
 *
 * Disabled plugins are skipped: `enabled: false` withholds behavior, and a
 * declaration is behavior the consumer would otherwise act on. Plugins that
 * declare nothing for this consumer contribute no entry rather than an empty
 * one, so a consumer can treat "no entries" as "nobody declared".
 *
 * Reads the plugin list alone, so it works identically at boot and at generation
 * time — which is the property the whole channel exists for.
 */
export function collectDeclarations(
  plugins: readonly PluginDefinition[],
  consumer: string
): PluginDeclaration[] {
  const found: PluginDeclaration[] = [];
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const declared = plugin.contributes?.declarations;
    if (!isPlainRecord(declared)) continue;
    // `in` rather than a truthiness test: a plugin may deliberately declare a
    // falsy value, and only the consumer knows whether that means anything.
    if (!(consumer in declared)) continue;
    found.push({ source: plugin.name, value: declared[consumer] });
  }
  return found;
}

/**
 * Whether a value is a plain object usable as a keyed record.
 *
 * An array passes `typeof === "object"` and would then be indexed by the
 * consumer name, yielding `undefined` for every consumer while looking like a
 * valid declaration block. Rejecting it here makes a misdeclared array visible
 * as "nothing declared" rather than as a silently empty lookup.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
