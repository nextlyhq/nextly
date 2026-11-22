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
import { getService } from "../../di/service-access";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { FilteredWrite } from "../collections/services/collection-access-service";
import { singleDocumentEditable } from "../singles/services/single-document-access";
import { checkSingleAccess } from "../singles/services/single-query-service";
import type { UserContext } from "../singles/types";

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
 * Whether `caller` may make the write `action` to the Single `slug`'s document, as the Single's own
 * gate judges it: an update in the part's language as an update in it is (the stored row must
 * exist, as for any edit of it), and a lifecycle write as one of the whole document is. A Single
 * has no delete of its document.
 */
async function singleWriteAllowed(
  slug: string,
  part: string | null,
  action: FilteredWrite,
  caller: Exclude<EntryGateCaller, { kind: "system" }>
): Promise<boolean> {
  const user: UserContext = { id: caller.userId };
  const actor = caller.kind === "key" ? caller.scope : undefined;
  if (action === "update") {
    return singleDocumentEditable(slug, {
      user,
      ...(actor === undefined ? {} : { actor }),
      routeAuthorized: false,
      ...(part === null ? {} : { locale: part }),
    });
  }
  if (action === "delete") return false;
  const denied = await checkSingleAccess({
    slug,
    operation: action,
    user,
    overrideAccess: false,
    routeAuthorized: false,
    rbacAccessControlService: getService("rbacAccessControlService"),
    ...(actor === undefined ? {} : { authenticatedScope: actor }),
    logger: getService("logger"),
  });
  return denied === null;
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
 * Trusted code is allowed, as an `overrideAccess` write is. A Single's document is judged by the
 * Single's own gate, as its update, publish and unpublish are; a Single is never deleted.
 */
export async function entryWriteAllowed(
  document: ReviewDocument,
  part: string | null,
  action: FilteredWrite,
  caller: EntryGateCaller
): Promise<boolean> {
  if (caller.kind === "system") return true;
  if (document.scopeKind === "single") {
    return singleWriteAllowed(document.scopeSlug, part, action, caller);
  }
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
