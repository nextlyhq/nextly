/**
 * The reader the workspace metadata's contributions and filters are offered
 * to, built from the request's caller with the answers the rest of the
 * server already gives: the permissions it holds, by the gate every widget is
 * judged with, and what it may filter on, by the list read's own chain.
 *
 * @module plugins/contribution-audience
 * @experimental
 */
import type { ReadAccessCaller } from "../auth/code-access";
import { readableEntities } from "../auth/entity-read-access";
import { container } from "../di/container";
import { holdsWidgetPermission } from "../domains/widgets/gate";
import { permissionVerdicts } from "../domains/widgets/visibility";
import { getNextlyLogger } from "../observability/logger";
import type { CollectionsHandler } from "../services/collections-handler";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import {
  contributionGates,
  readerFilterVerdict,
  type ContributionAudience,
} from "./admin-contributions-offer";
import type { PluginDefinition } from "./plugin-context";

/**
 * @experimental The reader of the login page: nobody has signed in, so they
 * hold no permission and may filter on nothing. The login page's
 * contributions can carry neither a permission nor a rule, so this leaves
 * none of them out; it exists so no other place can be offered to it.
 */
export const NOBODY: ContributionAudience = Object.freeze({
  holds: () => false,
  mayFilter: () => Promise.resolve(false),
  collections: Object.freeze([]),
});

/**
 * Every collection the admin lists, by slug, or none when the registry could
 * not be read: a failed read is not an install without collections, and
 * offering on collections that could not be judged would offer unjudged.
 */
async function listedCollections(): Promise<string[]> {
  try {
    // The slugs alone, from the registry cache: asked on every admin request.
    const registry = container.get<{
      getAllSlugs: () => Promise<string[]>;
    }>("collectionRegistryService");
    return await registry.getAllSlugs();
  } catch (error) {
    getNextlyLogger().error({
      kind: "admin-contribution-collections-unavailable",
      err: error instanceof Error ? error.stack : String(error),
    });
    return [];
  }
}

/**
 * The handler that serves collection reads. Looked up when the verdict is
 * asked, inside its promise, so a container without it is a failure the
 * verdict reads as no, not a payload that cannot be built.
 */
function collectionsHandler(): CollectionsHandler {
  return container.get<CollectionsHandler>("collectionsHandler");
}

/**
 * @experimental The signed-in reader of this request, for the offer.
 *
 * Its permissions are resolved once, for every gate a contribution names, by
 * the same verdicts the widget gate decides from, and a gate that could not
 * be decided denies. The collections it is offered anything on are the ones
 * it may read, by the decision every entity read takes, since a list it may
 * not read refuses before it judges a field. What it may filter on is then
 * asked of the list read's own chain with the caller the read would be judged
 * as, once per collection and `where` for the whole payload.
 */
export async function contributionAudienceFor(
  plugins: readonly PluginDefinition[],
  caller: ReadCaller,
  accessCaller: ReadAccessCaller
): Promise<ContributionAudience> {
  const gates = contributionGates(plugins);
  const verdicts = await permissionVerdicts(gates, accessCaller);
  const listed = await listedCollections();
  const readable = await readableEntities(listed, accessCaller);
  const judged = readerFilterVerdict(
    async (collection, where) =>
      collectionsHandler().queryReadableProblems({
        collectionName: collection,
        where,
        overrideAccess: false,
        user: caller.user,
        authenticatedScope: caller.authenticatedScope,
      }),
    (collection, error) =>
      getNextlyLogger().warn({
        kind: "admin-contribution-offer-undecided",
        collection,
        err: error instanceof Error ? error.stack : String(error),
      })
  );
  return {
    holds: gate => holdsWidgetPermission(gate, verdicts),
    // A collection the reader may not read is refused before any field is.
    mayFilter: async (collection, where) =>
      readable.has(collection) && (await judged(collection, where)),
    collections: listed.filter(slug => readable.has(slug)),
  };
}
