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
export function resolveBuilderVersions(
  enabled: boolean | undefined
): ResolvedVersionsConfig | null {
  return enabled === true ? resolveVersionsConfig({ drafts: false }) : null;
}
