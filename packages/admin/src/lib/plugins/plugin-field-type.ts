/**
 * Which editor a plugin contributes for a field type, and whether that answer
 * is knowable yet.
 *
 * The plugin list arrives from the session-gated half of `/admin-meta`, so it
 * has three states and only one of them supports a conclusion:
 *
 * - it has not answered yet;
 * - it never answered, so absence proves nothing;
 * - it answered, and this type is either in it or genuinely is not.
 *
 * `useBranding()` collapses all three into one value. It returns `{}` when
 * nothing has arrived, so `branding.plugins ?? []` is an empty list whether the
 * project has no plugins, the request is in flight, or the request failed —
 * and every caller that reads it is one line away from reporting "no plugin
 * contributes this type" as a fact about the project.
 *
 * That failure is not hypothetical and it is not cosmetic. Both surfaces that
 * looked a type up this way rendered a red error naming the field's type when
 * the request had merely failed, so a correctly-installed plugin read as a
 * broken configuration — and because a reload retries and usually succeeds, it
 * presented as an intermittent bug in the plugin rather than as a failed fetch.
 *
 * **A discriminated union rather than a documented rule.** `types/branding.ts`
 * already tells callers to consult `useBrandingStatus()` before concluding
 * anything from a plugin being missing, and both callers did not. A rule with
 * nothing enforcing it is not a control: here the component is unreachable
 * without narrowing `status` first, so the two states that cannot support a
 * conclusion have to be handled to get at the one that can.
 *
 * @module lib/plugins/plugin-field-type
 */

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";

/**
 * What is known about a field type's contributed editor.
 *
 * `ready` carries `component: undefined` for a type no installed plugin
 * contributes, which is the ONLY state in which "unknown field type" is a true
 * statement. The other two members exist so that sentence cannot be reached
 * from a list that never arrived.
 */
export type PluginFieldTypeLookup =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly component: string | undefined };

/**
 * The editor component path a plugin contributes for `type`.
 *
 * Not memoised. The lookup is a scan of a handful of plugins for one string,
 * and a `useMemo` keyed on `branding.plugins` would rerun on every identity
 * change of that array anyway — so it would add a dependency to keep correct
 * in exchange for nothing measurable.
 */
export function usePluginFieldType(type: string): PluginFieldTypeLookup {
  const branding = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();

  // Pending first. A request that is still in flight has not failed, and
  // reporting it as unavailable would show a permanent error for the moment
  // every load passes through.
  if (isPending) return { status: "loading" };
  if (isUnavailable) return { status: "unavailable" };

  return {
    status: "ready",
    component: (branding.plugins ?? [])
      .flatMap(plugin => plugin.fieldTypes ?? [])
      .find(contributed => contributed.type === type)?.component,
  };
}
