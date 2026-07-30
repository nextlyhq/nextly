/**
 * The Schema Builder's version-history switch, as the registry stores it.
 *
 * Every path that persists the switch goes through here so they cannot drift:
 * the builder's create and update handlers, the standalone schema routes, and
 * the `ui-schema.json` metadata upserts.
 *
 * @module domains/versions/builder-versions
 */

import type { ResolvedVersionsConfig } from "../../schemas/versions/types";

import { resolveVersionsConfig } from "./resolve-config";

/**
 * Resolve the switch into the config the registry column holds.
 *
 * Two decisions are encoded here.
 *
 * The switch means history only. `resolveVersionsConfig(true)` turns drafts and
 * autosave on, which is the code-first default but not what this control says:
 * it records saves so they can be restored, and the help text tells the user it
 * does not add drafts. Storing a drafts-enabled config would make that a lie as
 * soon as drafts are enforced.
 *
 * `status` is deliberately not consulted. It aliases to a versioned config for
 * code-first back-compat, which would leave the switch unable to turn
 * versioning off on any entity that has Draft/Published enabled.
 */
/**
 * Coerce an untrusted retention value from a loosely-typed request body into
 * the `number | false | undefined` the resolver takes. `false` is unlimited; a
 * non-negative integer is a keep-count; anything else (absent, or malformed)
 * becomes undefined so the default (50) applies rather than a rejected request,
 * matching how these routes coerce their other optional switches.
 */
export function coerceBuilderMaxPerDoc(
  value: unknown
): number | false | undefined {
  if (value === false) return false;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}

export function resolveBuilderVersions(
  enabled: boolean | undefined,
  // Retention: how many durable versions to keep per document. `false` =
  // unlimited; a number = keep that many; undefined = the default (50), so a
  // caller that only knows the on/off switch keeps today's behavior. Ignored
  // when the switch is off.
  maxPerDoc?: number | false
): ResolvedVersionsConfig | null {
  if (enabled !== true) return null;
  return resolveVersionsConfig({
    drafts: false,
    ...(maxPerDoc !== undefined ? { maxPerDoc } : {}),
  });
}
