/**
 * Whether this author may create a pattern, read once per editor.
 *
 * Read EAGERLY, when the editor mounts, because the control it describes is
 * drawn then. The library read cannot carry this: it happens when the insert
 * panel opens, and the Save as pattern verb exists on the toolbar, the context
 * menu and the command palette before any panel does.
 *
 * ## Why it is allowed to be wrong
 *
 * A gate on a stale answer offers a control whose save is then refused, which
 * is exactly the behaviour this replaces and no worse than it. The write is
 * authorized on its own. So the read is optimistic in the direction that keeps
 * a working feature reachable, and the freshness below is about being right
 * usually rather than about being safe.
 *
 * @module admin/pattern-capability-client
 */
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

// The CONTRACT, not the route: `capability-route` reaches the collection
// registry through server-only modules, and importing it here for one path
// constant would take the admin bundle down at load.
import {
  CAPABILITY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  type PatternCapabilityResponse,
} from "../library-contract";

/**
 * Whether the save-as-pattern verb should be offered.
 *
 * `true` WHILE THE READ IS IN FLIGHT, and that default is deliberate. The
 * alternative — closed until proven open — dims the verb on every editor mount
 * for every author, including the many who may save, and a control that flickers
 * from disabled to enabled is worse than one that is briefly optimistic. The
 * cost of being wrong here is the late refusal that already happens today; the
 * cost of being wrong the other way is a feature that looks broken.
 *
 * The same reasoning as `useCan`'s is deliberately INVERTED, and the difference
 * is which way each fails: a closed-by-default gate on a navigation item hides a
 * page until permissions load, and the page is still there afterwards. Here the
 * refusal carries the only explanation an author gets.
 */
export function useMayCreatePattern(): boolean {
  const read = usePluginRoute<PatternCapabilityResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: CAPABILITY_ROUTE_PATH,
    // Fresh on every mount, matching `useCurrentUserPermissions` in the admin
    // and `usePatternLibrary` beside this. A role change lands through screens
    // that know nothing about this route, so under the admin's five-minute
    // default an author whose grant was just added would keep being refused a
    // verb they now hold.
    staleTime: 0,
  });
  return read.data?.mayCreate ?? true;
}
