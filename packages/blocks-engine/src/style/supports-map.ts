/**
 * The bridge between a block's declared `supports` and the style properties it
 * may therefore set.
 *
 * A catalog group and a `supports` key are the same thing named twice, so the
 * registry's built-in support vocabulary is DERIVED from the catalog rather
 * than restated beside it: adding a group, or a sub-flag, extends what blocks
 * may declare in the same commit, with no second list to forget.
 */
import type { SupportDefinition } from "../registry";

import { STYLE_CATALOG, styleFlagsInGroup } from "./catalog";
import { STYLE_GROUP_DEFS } from "./catalog-types";
import type { StyleGroup, StyleProperty } from "./catalog-types";

/**
 * The support definitions every app has before any extension: one per catalog
 * group, carrying the sub-flags that group's properties declare.
 */
export function styleSupportDefinitions(): SupportDefinition[] {
  return STYLE_GROUP_DEFS.map(group => {
    const flags = styleFlagsInGroup(group.key);
    return {
      key: group.key,
      label: group.label,
      ...(flags.length === 0 ? {} : { flags: [...flags] }),
    };
  });
}

/**
 * The style properties a block may set, given what it opts into.
 *
 * `true` enables a whole group. An object enables only the properties whose
 * flag it names, so `{ border: { radius: true } }` yields corner rounding and
 * no border lines. Properties in a group that declare no flag are reachable
 * only through `true`, which is how a group states that it offers nothing finer
 * than all-or-nothing.
 */
export function stylePropertiesForSupports(
  supports: Record<string, boolean | Record<string, unknown>> | undefined
): readonly StyleProperty[] {
  if (supports === undefined) return [];
  return STYLE_CATALOG.filter(entry => {
    const declared = supports[entry.group];
    if (declared === true) return true;
    if (typeof declared !== "object" || declared === null) return false;
    return entry.flag !== undefined && declared[entry.flag] === true;
  });
}

/** Whether a `supports` declaration permits one named style property. */
export function supportsAllowStyleProperty(
  supports: Record<string, boolean | Record<string, unknown>> | undefined,
  property: string
): boolean {
  return stylePropertiesForSupports(supports).some(
    entry => entry.property === property
  );
}

/** The catalog groups, for callers that need the vocabulary without the rows. */
export function styleGroupKeys(): readonly StyleGroup[] {
  return STYLE_GROUP_DEFS.map(group => group.key);
}
