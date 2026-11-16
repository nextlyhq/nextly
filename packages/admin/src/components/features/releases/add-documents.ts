/**
 * What the Add documents picker decides about the documents it lists: which
 * one may be picked for the chosen action and, where one may not, the reason
 * said beside it; and, once an add has landed, which linked documents to
 * offer next.
 *
 * Pure, so each answer is one a test can hold.
 *
 * @module components/features/releases/add-documents
 */
import type {
  AddedReleaseMember,
  AddReleaseMemberPayload,
  ReleaseMemberAction,
  UnpublishedLink,
} from "@admin/types/releases";

/** One document the picker lists. */
export interface PickerDocument {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  title: string;
  /** The collection's plural name, or the Single's label. */
  scopeLabel: string;
  status: "draft" | "published" | null;
}

/** One document's key, the same for a picked row, a member and a link. */
export function documentKey(document: {
  scopeSlug: string;
  entryId: string;
}): string {
  return `${document.scopeSlug}:${document.entryId}`;
}

const VERB: Record<ReleaseMemberAction, string> = {
  publish: "publish",
  unpublish: "unpublish",
};

/**
 * Why a document may not be picked for `action`, or `null` when it may. The
 * permission is the one the server asks of the person adding it: publish to
 * go live, unpublish to come down, on the document's own collection or
 * Single. Judged again whenever the action changes.
 */
export function pickRefusal(
  document: PickerDocument,
  action: ReleaseMemberAction,
  context: {
    can: (permission: string) => boolean;
    inRelease: ReadonlySet<string>;
  }
): string | null {
  if (context.inRelease.has(documentKey(document))) {
    return "Already in this release.";
  }
  if (!context.can(`${VERB[action]}-${document.scopeSlug}`)) {
    return `You do not have permission to ${VERB[action]} ${document.scopeLabel}.`;
  }
  return null;
}

/** The picked documents as one add sends them, each with the chosen action. */
export function membersToAdd(
  picked: readonly PickerDocument[],
  action: ReleaseMemberAction
): AddReleaseMemberPayload[] {
  return picked.map(document => ({
    scopeKind: document.scopeKind,
    scopeSlug: document.scopeSlug,
    entryId: document.entryId,
    action,
  }));
}

/** The linked documents an add offers next, and what it can only count. */
export interface LinkedOffer {
  /** Each linked document once, in the order the answer named them. */
  links: UnpublishedLink[];
  /** Links to, or from, documents the reader may not read. */
  hiddenCount: number;
  /** Links in fields the reader may not view. */
  inHiddenFields: number;
  /** Links to documents that no longer exist. */
  deletedCount: number;
}

/**
 * What to offer once an add has landed: the documents the added ones link to
 * that will not be live at the release's moment, each once, leaving out any
 * already in the release. Only documents going live are offered their links;
 * one coming down needs none of them.
 */
export function linkedOffer(
  added: readonly AddedReleaseMember[],
  inRelease: ReadonlySet<string>
): LinkedOffer {
  const offer: LinkedOffer = {
    links: [],
    hiddenCount: 0,
    inHiddenFields: 0,
    deletedCount: 0,
  };
  const seen = new Set(inRelease);
  for (const member of added) seen.add(documentKey(member));
  for (const member of added) {
    if (member.action !== "publish") continue;
    const report = member.unpublishedLinks;
    offer.hiddenCount += report.hiddenCount;
    offer.inHiddenFields += report.inHiddenFields;
    for (const deleted of report.deletedLinks) {
      offer.deletedCount += deleted.count;
    }
    for (const link of report.links) {
      const key = documentKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      offer.links.push(link);
    }
  }
  return offer;
}

/** Whether an offer has anything to say, a document to add or a count. */
export function offersAnything(offer: LinkedOffer): boolean {
  return (
    offer.links.length > 0 ||
    offer.hiddenCount > 0 ||
    offer.inHiddenFields > 0 ||
    offer.deletedCount > 0
  );
}
