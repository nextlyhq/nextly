/**
 * The admin places a plugin list holds: core's, and the ones its enabled
 * plugins declare, checked when the app starts.
 *
 * A place that exists only as a string in one plugin's code cannot be found by
 * the plugin that wants to add to it, and two plugins can choose the same name
 * without either noticing. Declaring them, and refusing to start on a bad
 * name, makes both visible at boot rather than as a contribution that quietly
 * renders nowhere.
 *
 * No copy of them is kept. A reader computes them from the plugin list the
 * app committed, where it reads them, so there is no second record to fall
 * out of step with that list when a load is refused or reloaded.
 *
 * @module plugins/admin-places-registry
 * @experimental
 */
import {
  ADMIN_CONTRIBUTION_KINDS,
  type AdminContributionKind,
  adminPlaceNamespaceOf,
  CORE_ADMIN_PLACES,
  isWellFormedAdminPlaceName,
  reservedAdminPlaceSegmentOf,
} from "./admin-places";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";

/** One admin place, and the plugin that declared it; core's have no owner. */
export interface DeclaredAdminPlace {
  name: string;
  /** The declaring plugin's name; absent for core's places. */
  owner?: string;
  description?: string;
  /** The kinds of contribution the place takes. */
  accepts: readonly AdminContributionKind[];
}

/** What a plugin's place takes when it does not say: blocks alone. */
const DEFAULT_PLUGIN_PLACE_ACCEPTS: readonly AdminContributionKind[] = [
  "block",
];

/** Core's places, as every set of declared places begins. */
function corePlaces(): Map<string, DeclaredAdminPlace> {
  return new Map(
    Object.entries(CORE_ADMIN_PLACES).map(
      ([name, place]) => [name, { name, accepts: place.accepts }] as const
    )
  );
}

/**
 * The kinds a plugin's place takes, as it declared them, refusing a value
 * that is not a list of kinds. Read as plain JavaScript hands it over.
 */
function declaredAccepts(
  accepts: unknown,
  pluginName: string,
  name: string
): readonly AdminContributionKind[] {
  if (accepts === undefined) return DEFAULT_PLUGIN_PLACE_ACCEPTS;
  if (
    !Array.isArray(accepts) ||
    accepts.length === 0 ||
    !accepts.every(kind =>
      (ADMIN_CONTRIBUTION_KINDS as readonly unknown[]).includes(kind)
    )
  ) {
    throw resolutionError(
      "admin-place-malformed",
      `Plugin "${pluginName}" declares the admin place "${name}" with an \`accepts\` that is not a list of one or more contribution kinds: ${ADMIN_CONTRIBUTION_KINDS.join(", ")}.`,
      { plugin: pluginName, place: name, declared: "accepts" }
    );
  }
  return [...new Set(accepts as AdminContributionKind[])];
}

/**
 * A declared place name as a refusal quotes it: the string itself, or what
 * kind of value stood in its place. Never a serialization of the value, which
 * a bigint or a circular object would make throw before the refusal exists.
 */
function describeGiven(name: unknown): string {
  return typeof name === "string" ? `"${name}"` : `given as ${typeof name}`;
}

/**
 * Whether this plugin may declare this place at all.
 *
 * Every refusal together, because they answer one question, who owns the
 * name. The spelling first, since a malformed name can match any rule by
 * accident. Then core's: a plugin whose own slug is a segment core reserves
 * can declare nothing, and saying so names the actual problem, the slug,
 * rather than each place in turn. Then a name under a reserved segment, which
 * is core's whichever plugin's prefix it does or does not carry. Then the
 * plugin's own namespace, and last another owner.
 */
function assertPlaceDeclarable(
  places: ReadonlyMap<string, DeclaredAdminPlace>,
  name: unknown,
  pluginName: string,
  slug: string
): asserts name is string {
  // Not a string at all from a plugin written in plain JavaScript, which the
  // spelling check would otherwise read as the word "undefined".
  if (typeof name !== "string" || !isWellFormedAdminPlaceName(name)) {
    throw resolutionError(
      "admin-place-malformed",
      `Plugin "${pluginName}" declares the admin place ${describeGiven(name)}, which is not a place name: lower-case letters, digits and single dashes, in segments joined by dots, the first being the plugin's slug.`,
      { plugin: pluginName, place: name }
    );
  }

  if (reservedAdminPlaceSegmentOf(slug) === slug) {
    throw resolutionError(
      "admin-place-reserved-slug",
      `Plugin "${pluginName}" declares the admin place "${name}", but its slug "${slug}" is a segment core reserves for its own places, so it can declare none. Rename the plugin to give it a slug of its own.`,
      { plugin: pluginName, place: name, slug }
    );
  }

  const reservedSegment = reservedAdminPlaceSegmentOf(name);
  if (reservedSegment !== undefined) {
    throw resolutionError(
      "admin-place-reserved",
      `Plugin "${pluginName}" declares the admin place "${name}", under "${reservedSegment}", which core reserves for its own places.`,
      { plugin: pluginName, place: name, reservedSegment }
    );
  }

  if (!isInPluginNamespace(pluginName, name)) {
    throw resolutionError(
      "admin-place-outside-namespace",
      `Plugin "${pluginName}" declares the admin place "${name}", which must start with "${slug}.".`,
      { plugin: pluginName, place: name, expectedPrefix: `${slug}.` }
    );
  }

  const existing = places.get(name);
  if (existing) {
    // Both owners named: with one, whoever reads it has to go looking for the
    // other, and the other is half the problem.
    throw resolutionError(
      "admin-place-collision",
      `Plugins "${existing.owner}" and "${pluginName}" both declare the admin place "${name}".`,
      { place: name, owners: [existing.owner, pluginName] }
    );
  }
}

/**
 * @experimental Core's places and every enabled plugin's, refusing a place
 * outside its plugin's namespace, under a segment core reserves, malformed,
 * or declared twice.
 *
 * A disabled plugin's places are skipped, as its hook points are: it renders
 * nothing, so refusing them would let something nobody runs stop the app from
 * starting. Its places then do not exist, and a contribution naming one is
 * refused by {@link assertPlacesExist}.
 */
export function collectAdminPlaces(
  plugins: readonly PluginDefinition[]
): Map<string, DeclaredAdminPlace> {
  const places = corePlaces();

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const slug = pluginAdminSlug(plugin.name);

    const declared: unknown = plugin.contributes?.admin?.places;
    if (declared === undefined) continue;
    // Not a list at all from a plugin written in plain JavaScript, which
    // iterating would refuse with a bare TypeError naming neither.
    if (!Array.isArray(declared)) {
      throw resolutionError(
        "admin-place-malformed",
        `Plugin "${plugin.name}" declares \`contributes.admin.places\` as something other than a list of places.`,
        {
          plugin: plugin.name,
          place: undefined,
          declared: "contributes.admin.places",
        }
      );
    }
    for (const place of declared as readonly unknown[]) {
      // Read from what was given, which a plugin in plain JavaScript may have
      // written as a bare string.
      const given = place as {
        name?: unknown;
        description?: unknown;
        accepts?: unknown;
      } | null;
      const name = given?.name;
      assertPlaceDeclarable(places, name, plugin.name, slug);
      const description = given?.description;
      places.set(name, {
        name,
        owner: plugin.name,
        accepts: declaredAccepts(given?.accepts, plugin.name, name),
        ...(typeof description === "string" && description !== ""
          ? { description }
          : {}),
      });
    }
  }

  return places;
}

/** One contribution's place, and what to call the contribution in a refusal. */
export interface AdminPlaceReference {
  /** The contributing plugin's name. */
  plugin: string;
  place: string;
  /** The contribution, as a refusal names it: `block "totals"`. */
  what: string;
}

/**
 * @experimental Refuse a contribution that names a place `places` does not
 * hold, naming the plugin, the contribution and the place.
 *
 * One check for every kind of contribution, so each kind refuses an unknown
 * place the same way. A place in a plugin's namespace that no enabled plugin
 * declares names the namespace it belongs to: the plugin that owns it is
 * disabled, absent, or the name is misspelled, and a plugin that adds to
 * another's place should declare it in `dependsOn`.
 */
export function assertPlacesExist(
  places: ReadonlyMap<string, DeclaredAdminPlace>,
  references: Iterable<AdminPlaceReference>
): void {
  for (const { plugin, place, what } of references) {
    if (places.has(place)) continue;

    const owningPrefix = adminPlaceNamespaceOf(place);
    if (
      owningPrefix === place ||
      reservedAdminPlaceSegmentOf(place) !== undefined
    ) {
      throw resolutionError(
        "admin-place-unknown",
        `Plugin "${plugin}" adds ${what} to the admin place "${place}", which is not one of core's places.`,
        { plugin, contribution: what, place }
      );
    }

    throw resolutionError(
      "admin-place-unknown",
      `Plugin "${plugin}" adds ${what} to the admin place "${place}", which no enabled plugin declares. It belongs to the plugin whose admin slug is "${owningPrefix}": enable that plugin and declare it in the \`dependsOn\` of "${plugin}", or correct the name.`,
      { plugin, contribution: what, place, owningPrefix }
    );
  }
}
