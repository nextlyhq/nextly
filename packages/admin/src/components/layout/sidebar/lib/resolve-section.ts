import type { ActiveNavSection } from "@admin/constants/nav-sections";
import { resolveRoute } from "@admin/lib/routing";
import type {
  CarriedRouteSection,
  RouteSectionContext,
} from "@admin/types/route-section";

/**
 * Re-exported so the sidebar's callers have one import site for the decision
 * and its inputs. The definitions live in `types/route-section` because the
 * ROUTE registry names them too, and a registry importing a sidebar
 * component's types would invert the dependency.
 */
export type {
  RouteSectionContext as ActiveSectionContext,
  StandalonePluginSummary,
} from "@admin/types/route-section";

/**
 * Evaluate the section a route declared.
 *
 * A name is returned as-is; a resolver is called with the runtime facts it
 * asked for. There is no arm that inspects the pathname, which is the point:
 * the sidebar renders a decision the route already made rather than making its
 * own from the URL.
 */
export function evaluateRouteSection(
  declared: CarriedRouteSection,
  context: RouteSectionContext
): ActiveNavSection {
  return typeof declared === "function" ? declared(context) : declared;
}

/**
 * Which rail entry is active for the current location.
 *
 * Resolves the route first, then evaluates whatever section that route
 * declared. `undefined` means no route matched at all — a genuine 404 — and is
 * distinct from a route that matched but named no section, which the route
 * type makes unrepresentable.
 */
export function resolveActiveSection(
  context: RouteSectionContext
): ActiveNavSection | undefined {
  const declared = resolveRoute(context.pathname, "").section;
  if (!declared) return undefined;
  return evaluateRouteSection(declared, context);
}
