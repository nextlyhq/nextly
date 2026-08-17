/**
 * Mount overrides for OpenAPI generation.
 *
 * The filesystem scan is the default source of truth for where the API is
 * mounted, but it cannot express every layout: a non-standard factory wrapper,
 * a route file the parser does not recognize, or a mount outside the app
 * router. The plugin's `mounts` option is the explicit escape hatch — declare a
 * mount, and {@link applyMountOverrides} merges it with the scan: an override
 * whose `mountPath` matches a scanned route REPLACES it; one that matches
 * nothing is ADDED. Scanned routes not mentioned are kept as-is.
 *
 * @module mount-overrides
 * @since alpha
 */
import type { RouteSource, RouteVerb, ScannedRoute, ScanResult } from "./scan";

/** An explicitly declared mount, overriding or supplementing the scan. */
export interface MountOverride {
  /** Mount path relative to the app-router root (matches {@link ScannedRoute.mountPath}). */
  mountPath: string;
  /** The surface this mount exposes. */
  source: RouteSource;
  /** HTTP verbs this mount serves (canonical order). */
  verbs: RouteVerb[];
}

/**
 * Merge explicit mount overrides into a scan result. Replace semantics are by
 * `mountPath`; last-write-wins on duplicate override paths keeps the merge
 * deterministic. The `unrecognized` list is passed through — an override does
 * not silence a scan warning.
 */
export function applyMountOverrides(
  scan: ScanResult,
  overrides?: readonly MountOverride[]
): ScanResult {
  if (!overrides || overrides.length === 0) return scan;

  const overrideByPath = new Map<string, MountOverride>();
  for (const ov of overrides) overrideByPath.set(ov.mountPath, ov);

  const routes: ScannedRoute[] = [];
  const consumed = new Set<string>();
  for (const route of scan.routes) {
    const ov = overrideByPath.get(route.mountPath);
    if (ov) {
      // Preserve the original filePath when correcting a scanned mount, so the
      // spec still points at the real file for operators.
      routes.push({
        filePath: route.filePath,
        mountPath: ov.mountPath,
        source: ov.source,
        verbs: ov.verbs,
      });
      consumed.add(route.mountPath);
    } else {
      routes.push(route);
    }
  }
  // Overrides for paths the scan never found declare a brand-new mount.
  for (const ov of overrides) {
    if (consumed.has(ov.mountPath)) continue;
    routes.push({
      mountPath: ov.mountPath,
      source: ov.source,
      verbs: ov.verbs,
    });
  }
  return { routes, unrecognized: scan.unrecognized };
}
