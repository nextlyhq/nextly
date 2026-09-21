/**
 * Validating the seams plugins publish for each other.
 *
 * A hook point that exists only as a string in one plugin's code cannot be
 * found by the plugin that wants to extend it, and two plugins can choose the
 * same name without either of them noticing — the second one's handlers simply
 * run at the first one's seam. Declaring them makes both problems visible at
 * boot rather than as behaviour nobody can explain.
 *
 * @module plugins/hook-points
 * @since 1.0.0
 */
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/** One declared seam, and which plugin published it. */
export interface DeclaredHookPoint {
  name: string;
  kind: "filter" | "action" | "decision";
  owner: string;
  description?: string;
}

/**
 * Collect every declared point, refusing a bad name or a collision.
 *
 * The prefix rule is what keeps ownership legible: a point named
 * `acme-auth.profile` belongs to the plugin whose slug is `acme-auth`, and no
 * other plugin can publish under it.
 */
export function collectHookPoints(
  plugins: PluginDefinition[]
): Map<string, DeclaredHookPoint> {
  const points = new Map<string, DeclaredHookPoint>();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const slug = pluginAdminSlug(plugin.name);

    for (const point of plugin.contributes?.hookPoints ?? []) {
      if (!point.name.startsWith(`${slug}.`)) {
        throw resolutionError(
          "hook-point-outside-prefix",
          `Plugin "${plugin.name}" declares the hook point "${point.name}", which must start with "${slug}.".`,
          { plugin: plugin.name, hookPoint: point.name, expectedPrefix: slug }
        );
      }

      const existing = points.get(point.name);
      if (existing) {
        // Naming BOTH owners: with only one named, whoever reads the failure
        // has to go looking for the other, and the other is half the problem.
        throw resolutionError(
          "hook-point-collision",
          `Plugins "${existing.owner}" and "${plugin.name}" both declare the hook point "${point.name}".`,
          {
            hookPoint: point.name,
            owners: [existing.owner, plugin.name],
          }
        );
      }

      points.set(point.name, {
        name: point.name,
        kind: point.kind,
        owner: plugin.name,
        ...(point.description ? { description: point.description } : {}),
      });
    }
  }

  return points;
}

/**
 * Check a payload against its declared schema, in development only.
 *
 * Warned once per POINT rather than per call: a mismatched payload is usually
 * every call at that seam, and a warning per call would bury the rest of the
 * log. Skipped entirely in production, where the cost is paid on every
 * invocation and the author is not there to read it.
 */
export function createPayloadChecker(
  points: Map<string, DeclaredHookPoint>,
  schemas: Map<string, { safeParse: (v: unknown) => { success: boolean } }>,
  warn: (message: string) => void
): (name: string, payload: unknown) => void {
  const warned = new Set<string>();

  return function check(name, payload) {
    if (warned.has(name)) return;
    const schema = schemas.get(name);
    if (!schema) return;
    if (schema.safeParse(payload).success) return;

    warned.add(name);
    const owner = points.get(name)?.owner ?? "unknown plugin";
    warn(
      `[nextly] A payload at hook point "${name}" (declared by ${owner}) does not match its schema.`
    );
  };
}
