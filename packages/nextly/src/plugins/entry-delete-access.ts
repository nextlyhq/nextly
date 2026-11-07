/**
 * A plugin's question "may this person delete this entry", answered without
 * deleting it.
 *
 * A plugin that does work on a person's behalf before a delete (converting a
 * component's copies into plain blocks before the component goes, say) must
 * know first that the delete itself would be allowed, or it changes content
 * for a delete that is then refused. The type-level question a route asks
 * (`ctx.caller.can(..., { anyEntry: true })`) answers yes for a rule that
 * lets the person delete only some entries, so it cannot be that check.
 *
 * {@link mayDeleteEntry} asks the delete's own gate, the very function the
 * collection delete asks before its hooks run (`deleteGateOf` in the mutation
 * service): the person's grant, and a rule's row filter matched against this
 * entry, in every language it holds. No hook runs, nothing is written, and no
 * transaction is opened. An entry that does not exist answers as one the
 * person may not delete, so the answer says nothing about which ids exist.
 *
 * @module plugins/entry-delete-access
 * @experimental
 */
import { z } from "zod";

import { getService } from "../di";
import { NextlyError } from "../errors";
import type { CollectionsHandler } from "../services/collections-handler";

import type { PluginRouteIdentity } from "./routes/route-types";

/** @experimental The entry a delete check names. */
export interface PluginDeleteCheck {
  /** The collection's slug, as registered (a host's rename resolved). */
  readonly collection: string;
  readonly id: string;
}

/** A person, as `ctx.caller.identity()` resolved them, and nothing else. */
const PERSON = z.looseObject({
  user: z.looseObject({ id: z.string().min(1) }),
  overrideAccess: z.undefined().optional(),
});

/** One entry of one collection. */
const ENTRY = z.strictObject({
  collection: z.string().min(1).max(255),
  id: z.string().min(1).max(255),
});

/**
 * @experimental Whether `identity` may delete the entry, judged by the
 * delete's own gate (its grant, and a rule's row filter for this entry, in
 * every language the entry holds), with no hook run and nothing written.
 * `false` for an entry that does not exist. Refused for anything but a
 * route's caller as `ctx.caller.identity()` resolved them: the system may
 * delete anything, and needs no answer.
 */
export async function mayDeleteEntry(
  identity: PluginRouteIdentity,
  entry: PluginDeleteCheck
): Promise<boolean> {
  if (!PERSON.safeParse(identity).success) {
    throw NextlyError.invalidInput({ message: IDENTITY_REFUSAL });
  }
  const named = ENTRY.safeParse(entry);
  if (!named.success) {
    throw NextlyError.invalidInput({ message: ENTRY_REFUSAL });
  }
  const handler: CollectionsHandler = getService("collectionsHandler");
  return handler.canDeleteEntry({
    collectionName: named.data.collection,
    entryId: named.data.id,
    user: identity.user,
    ...(identity.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: identity.authenticatedScope }),
  });
}

const IDENTITY_REFUSAL =
  "A delete check is made as a route's caller, as `ctx.caller.identity()` resolved them.";

const ENTRY_REFUSAL =
  "A delete check names one entry: a collection and an entry id.";
