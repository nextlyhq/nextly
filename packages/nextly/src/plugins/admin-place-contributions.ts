/**
 * The contributions plugins add to admin places, checked once and handed to
 * the admin in order.
 *
 * One reduction for both: the boot check refuses a malformed, misplaced,
 * duplicated or unorderable contribution, and the admin metadata is built from
 * the same call, so the admin is given exactly the contributions that passed,
 * each place's lists already ordered.
 *
 * @module plugins/admin-place-contributions
 * @experimental
 */
import type {
  AdminContribution,
  AdminContributionAction,
} from "./admin-contributions";
import { collectionsScopeProblem } from "./admin-filters";
import {
  ADMIN_CONTRIBUTION_KINDS,
  type AdminContributionKind,
  coreAdminPlaceBuiltIns,
  coreAdminPlaceNotReplaceable,
  isWellFormedAdminPlaceName,
} from "./admin-places";
import {
  assertPlacesExist,
  collectAdminPlaces,
  type DeclaredAdminPlace,
} from "./admin-places-registry";
import { orderContributions, type OrderedEntry } from "./contribution-order";
import type { PluginDefinition } from "./plugin-context";
import { isInPluginNamespace, pluginAdminSlug } from "./plugin-slug";
import { resolutionError } from "./resolution-error";
import { routePathIsLiteral } from "./routes/route-pattern";
import type { PluginRoute } from "./routes/route-types";
import { rowPredicateProblems } from "./row-predicate";

/** @experimental A contribution that passed, and the plugin that declared it. */
export type ContributedAdminContribution = AdminContribution & {
  plugin: string;
};

/** @experimental Each place's lists, by kind, in order. */
export type OrderedAdminContributions = Map<
  string,
  Map<AdminContributionKind, OrderedEntry[]>
>;

/** The keys every contribution may carry. */
const BASE_KEYS = [
  "id",
  "kind",
  "place",
  "order",
  "before",
  "after",
  "replaces",
  "requiredPermission",
  "visibleWhen",
  "collections",
];

/** The keys of each kind's own. */
const KIND_KEYS: Record<AdminContributionKind, readonly string[]> = {
  block: ["component"],
  tab: ["label", "component"],
  sidebarSection: ["label", "component"],
  column: ["label", "field", "component"],
  rowAction: ["label", "action"],
  bulkAction: ["label", "action"],
};

/**
 * The places that are about one collection entry, or show a collection's
 * rows: where a contribution may be narrowed to collections, and where a rule
 * has an entry to judge.
 */
const COLLECTION_PLACES = new Set(["collection.list", "collection.edit"]);

/** Kinds that act on rows, whose rule judges each row. */
const ROW_KINDS = new Set<AdminContributionKind>(["rowAction", "bulkAction"]);

/**
 * The methods an action's route may answer: a write's, since an action acts
 * on rows, and a write is what the admin sends with its CSRF token.
 */
const ROUTE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** A field's name, or a dotted path into a group. */
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** What makes an action unusable, or `undefined`. */
function actionProblem(
  action: unknown,
  plugin: PluginDefinition
): string | undefined {
  if (!isRecord(action)) return "its `action` is not an action";
  const keys = Object.keys(action);
  if (keys.length !== 1 || !["open", "run"].includes(keys[0])) {
    return "its `action` must be exactly one of `open` (a component) or `run` (a route)";
  }
  if ("open" in action) {
    return isText(action.open)
      ? undefined
      : "its `action.open` names no component";
  }
  return runProblem(action.run, plugin);
}

/** The keys a `run` takes. */
const RUN_KEYS = new Set(["method", "path", "mount"]);

/**
 * What makes a `run` unusable, or `undefined`: it must name exactly one of
 * the plugin's own routes, by method, path and mount, since a namespaced and
 * a root-mounted route may share a method and a path.
 */
function runProblem(
  run: unknown,
  plugin: PluginDefinition
): string | undefined {
  if (
    !isRecord(run) ||
    Object.keys(run).some(key => !RUN_KEYS.has(key)) ||
    typeof run.method !== "string" ||
    !ROUTE_METHODS.has(run.method) ||
    typeof run.path !== "string" ||
    (run.mount !== undefined && run.mount !== "plugin" && run.mount !== "root")
  ) {
    return "its `action.run` is not a route's `method`, `path` and optional `mount`";
  }
  // A path with `:name` parts has nothing to fill them from: the request
  // names its rows in its body, not in its address.
  if (!routePathIsLiteral(run.path)) {
    return `its \`action.run\` names ${run.method} ${run.path}, a route whose path takes parameters an action cannot fill`;
  }
  const route = runRoute(plugin, run as AdminContributionRun);
  if (route === undefined) {
    return `its \`action.run\` names ${run.method} ${run.path} (${run.mount ?? "plugin"} mount), which is not one of this plugin's routes`;
  }
  // A route for a plugin's own kind of signed-in person reads no staff
  // session, so an admin could never run it; a public route authenticates
  // nobody, so an action's permission and its rule on each row, judged as
  // the caller, would have no caller to judge.
  if (route.principal !== undefined) {
    return `its \`action.run\` names ${run.method} ${run.path}, a route for a signed-in person rather than staff`;
  }
  return route.public === true
    ? `its \`action.run\` names ${run.method} ${run.path}, a public route, which has no signed-in caller to judge the action for`
    : undefined;
}

/** What a `run` names: a route by method, path and mount. */
type AdminContributionRun = Extract<
  AdminContributionAction,
  { run: unknown }
>["run"];

/**
 * @experimental The plugin route a `run` names, by method, path and mount (the
 * plugin's own when it gives none), or `undefined`. One lookup for the start
 * check and for the permission a reader must hold to be sent the action.
 */
export function runRoute(
  plugin: PluginDefinition,
  run: AdminContributionRun
): PluginRoute | undefined {
  const mount = run.mount ?? "plugin";
  return (plugin.contributes?.routes ?? []).find(
    route =>
      route.method === run.method &&
      route.path === run.path &&
      (route.mount ?? "plugin") === mount
  );
}

/** What makes a kind's own fields unusable, or `undefined`. */
function kindProblem(
  kind: AdminContributionKind,
  declared: Record<string, unknown>,
  plugin: PluginDefinition
): string | undefined {
  if (kind !== "block" && !isText(declared.label)) return "it has no label";
  if (kind === "column") {
    const hasField = declared.field !== undefined;
    if (hasField === (declared.component !== undefined)) {
      return "a column shows exactly one of a `field` or a `component`";
    }
    if (hasField) {
      return typeof declared.field === "string" &&
        FIELD_PATH.test(declared.field)
        ? undefined
        : "its `field` is not a field's name or a dotted path";
    }
  }
  if (ROW_KINDS.has(kind)) return actionProblem(declared.action, plugin);
  return isText(declared.component) ? undefined : "it names no component";
}

/** What makes the placement and audience fields unusable, or `undefined`. */
function placementProblem(
  declared: Record<string, unknown>,
  kind: AdminContributionKind
): string | undefined {
  const { order, before, after, replaces, requiredPermission, place } =
    declared;
  if (
    order !== undefined &&
    (typeof order !== "number" || !Number.isFinite(order))
  ) {
    return "its `order` is not a number";
  }
  for (const [key, value] of [
    ["before", before],
    ["after", after],
    ["replaces", replaces],
  ] as const) {
    if (value !== undefined && !isText(value)) {
      return `its \`${key}\` names nothing`;
    }
  }
  if (requiredPermission !== undefined) {
    if (
      !isText(requiredPermission) &&
      typeof requiredPermission !== "function"
    ) {
      return "its `requiredPermission` is neither a permission nor a function of the plugin's names";
    }
    if (place === "login") {
      return "it asks for a permission on the login page, where nobody has signed in";
    }
  }
  return audienceProblem(declared, kind);
}

/** What makes `visibleWhen` or `collections` unusable here, or `undefined`. */
function audienceProblem(
  declared: Record<string, unknown>,
  kind: AdminContributionKind
): string | undefined {
  const place = declared.place as string;
  if (declared.collections !== undefined) {
    if (!COLLECTION_PLACES.has(place)) {
      return `it names \`collections\` at "${place}", which is not about a collection`;
    }
    const problem = collectionsScopeProblem(declared.collections);
    if (problem) return problem;
  }
  if (declared.visibleWhen === undefined) return undefined;
  const hasEntry =
    place === "collection.edit" ||
    (place === "collection.list" && ROW_KINDS.has(kind));
  if (!hasEntry) {
    return `its \`visibleWhen\` has no entry to judge at "${place}" for a ${kind}`;
  }
  const problems = rowPredicateProblems(declared.visibleWhen);
  return problems.length > 0
    ? `its \`visibleWhen\` is malformed: ${problems.join("; ")}`
    : undefined;
}

/** What makes a declared contribution unusable, in a sentence, or `undefined`. */
function contributionProblem(
  declared: Record<string, unknown>,
  plugin: PluginDefinition
): string | undefined {
  const kind = declared.kind;
  if (
    typeof kind !== "string" ||
    !(ADMIN_CONTRIBUTION_KINDS as readonly string[]).includes(kind)
  ) {
    return `its \`kind\` is not one of ${ADMIN_CONTRIBUTION_KINDS.join(", ")}`;
  }
  const known = new Set([
    ...BASE_KEYS,
    ...KIND_KEYS[kind as AdminContributionKind],
  ]);
  const stray = Object.keys(declared).find(key => !known.has(key));
  if (stray !== undefined) {
    return `it has the key \`${stray}\`, which a ${kind} does not take`;
  }
  if (typeof declared.place !== "string") return "it names no place";
  return (
    kindProblem(kind as AdminContributionKind, declared, plugin) ??
    placementProblem(declared, kind as AdminContributionKind)
  );
}

/** The plugin's declared contributions as a list, refusing anything else. */
function declaredContributions(plugin: PluginDefinition): readonly unknown[] {
  const declared: unknown = plugin.contributes?.admin?.contributions;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw resolutionError(
      "admin-contribution-invalid",
      `Plugin "${plugin.name}" declares \`contributes.admin.contributions\` as something other than a list.`,
      { plugin: plugin.name, contribution: undefined }
    );
  }
  return declared;
}

/**
 * A declared contribution checked whole: an object, its id a name in the
 * plugin's own namespace, and the rest usable.
 */
function checkedContribution(
  plugin: PluginDefinition,
  declared: unknown,
  places: ReadonlyMap<string, DeclaredAdminPlace>
): AdminContribution {
  if (!isRecord(declared)) {
    throw resolutionError(
      "admin-contribution-invalid",
      `Plugin "${plugin.name}" declares a contribution that is not an object.`,
      { plugin: plugin.name, contribution: undefined }
    );
  }
  const id = declared.id;
  if (typeof id !== "string" || !isWellFormedAdminPlaceName(id)) {
    throw resolutionError(
      "admin-contribution-invalid",
      `Plugin "${plugin.name}" declares a contribution with the id ${typeof id === "string" ? `"${id}"` : `given as ${typeof id}`}, which is not a name: lower-case letters, digits and single dashes, in segments joined by dots, the first being the plugin's slug.`,
      {
        plugin: plugin.name,
        contribution: typeof id === "string" ? id : undefined,
      }
    );
  }
  if (!isInPluginNamespace(plugin.name, id)) {
    const slug = pluginAdminSlug(plugin.name);
    throw resolutionError(
      "admin-contribution-outside-namespace",
      `Plugin "${plugin.name}" declares the contribution "${id}", which must start with "${slug}.".`,
      { plugin: plugin.name, contribution: id, expectedPrefix: `${slug}.` }
    );
  }
  // The place before the fields, since what a contribution may say depends on
  // where it is: a misspelled place would otherwise be refused for a field
  // that place does not allow.
  if (typeof declared.place === "string") {
    assertPlacesExist(places, [
      {
        plugin: plugin.name,
        place: declared.place,
        what: `${String(declared.kind)} "${id}"`,
      },
    ]);
  }
  const problem = contributionProblem(declared, plugin);
  if (problem) {
    throw resolutionError(
      "admin-contribution-invalid",
      `Plugin "${plugin.name}" declares the contribution "${id}", but ${problem}.`,
      { plugin: plugin.name, contribution: id }
    );
  }
  return declared as unknown as AdminContribution;
}

/** Refuse a contribution at a place that does not take its kind. */
function assertKindAccepted(
  contribution: ContributedAdminContribution,
  places: ReadonlyMap<string, DeclaredAdminPlace>
): void {
  const accepts = places.get(contribution.place)?.accepts ?? [];
  if (accepts.includes(contribution.kind)) return;
  throw resolutionError(
    "admin-contribution-kind-not-accepted",
    `Plugin "${contribution.plugin}" adds the ${contribution.kind} "${contribution.id}" to the admin place "${contribution.place}", which takes ${accepts.length > 0 ? accepts.join(", ") : "nothing"}.`,
    {
      plugin: contribution.plugin,
      contribution: contribution.id,
      place: contribution.place,
      kind: contribution.kind,
      accepts: [...accepts],
    }
  );
}

/** Each place's contributions of each kind, in order, with its built-ins. */
function orderedByPlace(
  contributions: readonly ContributedAdminContribution[]
): OrderedAdminContributions {
  const groups = new Map<
    string,
    Map<AdminContributionKind, ContributedAdminContribution[]>
  >();
  for (const contribution of contributions) {
    const kinds = groups.get(contribution.place) ?? new Map();
    groups.set(contribution.place, kinds);
    kinds.set(contribution.kind, [
      ...(kinds.get(contribution.kind) ?? []),
      contribution,
    ]);
  }
  const ordered: OrderedAdminContributions = new Map();
  for (const [place, kinds] of groups) {
    const lists = new Map<AdminContributionKind, OrderedEntry[]>();
    for (const [kind, items] of kinds) {
      lists.set(
        kind,
        orderContributions(
          items,
          coreAdminPlaceBuiltIns(place, kind),
          { place, kind },
          coreAdminPlaceNotReplaceable(place, kind)
        )
      );
    }
    ordered.set(place, lists);
  }
  return ordered;
}

/**
 * @experimental Every enabled plugin's admin contributions, and each place's
 * lists in order, refusing a contribution that is malformed, outside its
 * plugin's namespace, declared twice, at a place that does not exist or does
 * not take its kind, or that cannot be ordered, naming the plugin and the
 * contribution.
 *
 * A disabled plugin's contributions are skipped: it is not running, so
 * nothing it declares is drawn.
 */
export function contributedAdminContributions(
  plugins: readonly PluginDefinition[]
): {
  contributions: ContributedAdminContribution[];
  ordered: OrderedAdminContributions;
} {
  const places = collectAdminPlaces(plugins);
  const contributions: ContributedAdminContribution[] = [];
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const declared of declaredContributions(plugin)) {
      const contribution = {
        ...checkedContribution(plugin, declared, places),
        plugin: plugin.name,
      };
      const owner = owners.get(contribution.id);
      if (owner !== undefined) {
        throw resolutionError(
          "admin-contribution-duplicate",
          owner === plugin.name
            ? `Plugin "${plugin.name}" declares the contribution "${contribution.id}" twice.`
            : `Plugins "${owner}" and "${plugin.name}" both declare the contribution "${contribution.id}".`,
          {
            plugin: plugin.name,
            contribution: contribution.id,
            owners: [owner, plugin.name],
          }
        );
      }
      owners.set(contribution.id, plugin.name);
      contributions.push(contribution);
    }
  }
  for (const contribution of contributions) {
    assertKindAccepted(contribution, places);
  }
  return { contributions, ordered: orderedByPlace(contributions) };
}
