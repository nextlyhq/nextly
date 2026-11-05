/**
 * Whether a caller may make a built-in write (update, publish, unpublish, delete) to one document,
 * judged as that write itself would be judged: by the collection's own gate, through the same
 * questions an update in one language asks (`canUpdateEntry`, in that language) and a release asks
 * before it writes (`entriesWithinWriteFilter`). So the permission, the
 * collection's code-defined `access` rule and any filter it answers for this document all apply,
 * and a workflow step that needs only the right to edit or publish is held to exactly what an
 * edit or a publish of the document is held to.
 *
 * It reads on the pool, so a step asks it before its transaction opens.
 *
 * @module domains/workflows/entry-gate
 */
import {
  registeredWriteLanguagesFor,
  withRuleLanguage,
} from "../../auth/access/rule-language";
import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { container } from "../../di/container";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { FilteredWrite } from "../collections/services/collection-access-service";

import type { ReviewDocument } from "./review-state-repository";

const ENTRY_WRITES: ReadonlySet<string> = new Set<FilteredWrite>([
  "update",
  "publish",
  "unpublish",
  "delete",
]);

/** Whether `action` is a built-in write the collection's own gate decides. */
export function isEntryWrite(action: string): action is FilteredWrite {
  return ENTRY_WRITES.has(action);
}

/** Who asks the gate: a person, a key acting for its maker, or trusted code. */
export type EntryGateCaller =
  | { kind: "user"; userId: string }
  | { kind: "key"; userId: string; scope: AuthenticatedScope }
  | { kind: "system" };

/** The gate's view of who asks: the user, and a key's own scope where it is a key. */
function askedAs(caller: Exclude<EntryGateCaller, { kind: "system" }>): {
  user: { id: string };
  authenticatedScope?: AuthenticatedScope;
} {
  return caller.kind === "key"
    ? { user: { id: caller.userId }, authenticatedScope: caller.scope }
    : { user: { id: caller.userId } };
}

/**
 * Whether an update of `document` in the language `part` is allowed, judged as an update in that
 * language is: its rules told that one language (`registeredWriteLanguagesFor`), and a filter on a
 * translated field matched in it (`canUpdateEntry`'s `locale`), as the update write sets them.
 */
function updateAllowedIn(
  document: ReviewDocument,
  part: string,
  asked: ReturnType<typeof askedAs>
): Promise<boolean> {
  return withRuleLanguage(registeredWriteLanguagesFor(part), () =>
    container.get<CollectionsHandler>("collectionsHandler").canUpdateEntry({
      collectionName: document.scopeSlug,
      entryId: document.entryId,
      ...asked,
      locale: part,
    })
  );
}

/**
 * Whether `caller` may make the write `action` to one part of `document`, as the write would be
 * judged. An update of a language part is judged in that language, as an update in it is; the
 * shared part, and a lifecycle write, as a write to the whole document is, in every language.
 * Trusted code is allowed, as an `overrideAccess` write is. A Single's document is refused: its
 * gate is not asked here yet, and a refusal is the safe answer until it is.
 */
export async function entryWriteAllowed(
  document: ReviewDocument,
  part: string | null,
  action: FilteredWrite,
  caller: EntryGateCaller
): Promise<boolean> {
  if (caller.kind === "system") return true;
  if (document.scopeKind !== "collection") return false;
  const asked = askedAs(caller);
  if (action === "update" && part !== null) {
    return updateAllowedIn(document, part, asked);
  }
  const judged = await container
    .get<CollectionsHandler>("collectionsHandler")
    .entriesWithinWriteFilter({
      collectionName: document.scopeSlug,
      action,
      entryIds: [document.entryId],
      ...asked,
    });
  return "within" in judged && judged.within.has(document.entryId);
}
