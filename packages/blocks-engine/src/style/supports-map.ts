/**
 * The bridge between a block's declared `supports` and the style properties it
 * may therefore set.
 *
 * A catalog group and a `supports` key are the same thing named twice, so the
 * registry's built-in support vocabulary is DERIVED from the catalog rather
 * than restated beside it: adding a group, or a sub-flag, extends what blocks
 * may declare in the same commit, with no second list to forget.
 */
import type { NodeStyles } from "../document";
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
    // The flags array is always present, empty included: registration only
    // checks nested keys when a support declares flags, so omitting it would
    // let `{ typography: { fontSize: true } }` register and then enable
    // nothing. Declared empty, that same object form is refused outright.
    return {
      key: group.key,
      label: group.label,
      flags: [...styleFlagsInGroup(group.key)],
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

/** Every property the catalog knows: the ones a `supports` declaration decides. */
const CATALOG_PROPERTIES: ReadonlySet<string> = new Set(
  STYLE_CATALOG.map(entry => entry.property)
);

/**
 * The values of a style envelope a block may keep, given what it opts into,
 * and how many it may not: a catalog property its `supports` doesn't allow
 * is left out at every state and device, one counted per value, and a state
 * or device left empty goes with it. An entry the catalog doesn't know is
 * kept, since no `supports` decides it. The kept values are copies.
 *
 * The one answer for a block given another block's styles: "Turn into" keeps
 * what the new type supports, and pasting a style keeps what each target
 * supports and says how many settings didn't apply.
 *
 * @experimental
 */
export function supportedStylesOf(
  styles: NodeStyles | undefined,
  supports: Record<string, boolean | Record<string, unknown>> | undefined
): { readonly styles: NodeStyles | undefined; readonly skipped: number } {
  if (styles === undefined) return { styles: undefined, skipped: 0 };
  const allowed = new Set(
    stylePropertiesForSupports(supports).map(entry => entry.property)
  );
  const kept: Record<string, Record<string, Record<string, unknown>>> = {};
  let skipped = 0;
  for (const [state, byDevice] of Object.entries(styles)) {
    const keptDevices: Record<string, Record<string, unknown>> = {};
    for (const [device, values] of Object.entries(byDevice ?? {})) {
      const taken = keptValues(values, allowed);
      skipped += taken.skipped;
      if (taken.kept !== undefined) keptDevices[device] = taken.kept;
    }
    if (Object.keys(keptDevices).length > 0) kept[state] = keptDevices;
  }
  return {
    styles: Object.keys(kept).length === 0 ? undefined : kept,
    skipped,
  };
}

/** One state and device's values a block may keep, copied, and how many it may not. */
function keptValues(
  values: Readonly<Record<string, unknown>> | undefined,
  allowed: ReadonlySet<string>
): { kept: Record<string, unknown> | undefined; skipped: number } {
  const kept: Record<string, unknown> = {};
  let skipped = 0;
  for (const [property, value] of Object.entries(values ?? {})) {
    if (CATALOG_PROPERTIES.has(property) && !allowed.has(property)) {
      skipped += 1;
    } else {
      kept[property] = structuredClone(value);
    }
  }
  return {
    kept: Object.keys(kept).length === 0 ? undefined : kept,
    skipped,
  };
}
