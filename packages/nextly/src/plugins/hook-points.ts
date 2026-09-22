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
  /**
   * The declared payload shape, kept with the point that declared it.
   *
   * One map rather than a second keyed the same way: the checker used to take
   * points and schemas separately, which is two things to keep in step for no
   * gain — a schema can only ever belong to the point it was declared on.
   */
  payload?: { safeParse: (value: unknown) => { success: boolean } };
}

/**
 * The points this process has resolved, and the checker built from them.
 *
 * Module-level because `collectHookPoints` runs once at resolve and every
 * seam in the process asks the same question afterwards. Its result was
 * previously discarded, so a declared payload schema checked nothing and the
 * declared `kind` constrained nothing — the contribution contract promised a
 * development-time warning that could not arrive.
 */
let declaredPoints: Map<string, DeclaredHookPoint> = new Map();

export function publishHookPoints(
  points: Map<string, DeclaredHookPoint>
): void {
  declaredPoints = points;
}

export function getDeclaredHookPoints(): ReadonlyMap<
  string,
  DeclaredHookPoint
> {
  return declaredPoints;
}

/**
 * Collect every declared point, refusing a bad name or a collision.
 *
 * The prefix rule is what keeps ownership legible: a point named
 * `acme-auth.profile` belongs to the plugin whose slug is `acme-auth`, and no
 * other plugin can publish under it.
 */
/**
 * Whether this plugin may declare this name at all.
 *
 * Both refusals, together, because they answer one question — who owns the
 * name — and separating them from the loop leaves it reading as what it
 * builds rather than as the rules it enforces on the way.
 */
function assertPointDeclarable(
  points: ReadonlyMap<string, DeclaredHookPoint>,
  name: string,
  pluginName: string,
  slug: string
): void {
  if (!name.startsWith(`${slug}.`)) {
    throw resolutionError(
      "hook-point-outside-prefix",
      `Plugin "${pluginName}" declares the hook point "${name}", which must start with "${slug}.".`,
      { plugin: pluginName, hookPoint: name, expectedPrefix: slug }
    );
  }

  const existing = points.get(name);
  if (existing) {
    // Naming BOTH owners: with only one named, whoever reads the failure has
    // to go looking for the other, and the other is half the problem.
    throw resolutionError(
      "hook-point-collision",
      `Plugins "${existing.owner}" and "${pluginName}" both declare the hook point "${name}".`,
      { hookPoint: name, owners: [existing.owner, pluginName] }
    );
  }
}

export function collectHookPoints(
  plugins: PluginDefinition[]
): Map<string, DeclaredHookPoint> {
  const points = new Map<string, DeclaredHookPoint>();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const slug = pluginAdminSlug(plugin.name);

    for (const point of plugin.contributes?.hookPoints ?? []) {
      assertPointDeclarable(points, point.name, plugin.name, slug);

      points.set(point.name, {
        name: point.name,
        kind: point.kind,
        owner: plugin.name,
        ...(point.description ? { description: point.description } : {}),
        ...(point.payload ? { payload: point.payload } : {}),
      });
    }
  }

  return points;
}

/**
 * Check a call against what the point DECLARED — its payload and its kind.
 *
 * Both halves, because a declaration that constrains only the payload leaves
 * the more consequential half unenforced: a point declared as a `decision`
 * executed through `apply` has its veto error-isolated and skipped rather than
 * failing closed, so the security semantics the declaration promises are not
 * the ones the call gets. The kind is the whole reason a decision point is not
 * an ordinary filter.
 *
 * The two halves are enforced DIFFERENTLY, by what a miss costs. A kind
 * mismatch is refused on every call, because it turns a veto into a permit;
 * it is a map lookup and a comparison, so running it always costs nothing. A
 * payload mismatch is warned once per point, because a schema parse on every
 * invocation is not free and a wrong payload does not, by itself, change who
 * is allowed to do what.
 */
export function createPayloadChecker(
  points: ReadonlyMap<string, DeclaredHookPoint>,
  warn: (message: string) => void
): (name: string, payload: unknown, via?: DeclaredHookPoint["kind"]) => void {
  const warned = new Set<string>();

  return function check(name, payload, via) {
    const point = points.get(name);
    // Undeclared points are ordinary: a plugin may use a seam it never
    // declared, and resolution is not the place to forbid that.
    if (!point) return;

    // REFUSED rather than warned, and never skipped for cost. A point declared
    // a `decision` and executed through `apply` runs on the ordinary filter
    // executor, which error-isolates a throwing handler and keeps the previous
    // value — so a veto becomes a permit and the call fails OPEN. A warning
    // leaves that outcome exactly as it was, and in production nobody is there
    // to read it. The check is a map lookup and a string compare, so it costs
    // nothing to run on every call; the payload check below is a schema parse,
    // which is why that one stays advisory.
    if (via !== undefined && point.kind !== via) {
      throw resolutionError(
        "hook-point-kind-mismatch",
        `Hook point "${name}" (declared by ${point.owner}) is a ${point.kind}, ` +
          `but it was executed as a ${via}. A decision executed as a filter ` +
          `cannot veto, so the call would fail open.`,
        { point: name, declared: point.kind, executedAs: via }
      );
    }

    if (warned.has(name)) return;
    const schema = point.payload;
    if (!schema) return;
    if (schema.safeParse(payload).success) return;

    warned.add(name);
    warn(
      `[nextly] A payload at hook point "${name}" (declared by ${point.owner}) does not match its schema.`
    );
  };
}
