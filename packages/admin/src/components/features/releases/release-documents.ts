/**
 * How a release's page arranges its documents: grouped by the collection or
 * Single they are in, in the order the release first took one from each, and
 * listed by title within each group in the order they were added.
 *
 * The documents the reader may not read join their collection's group as a
 * count, never as rows, so a group never reads as smaller than it is; a
 * collection the reader can see nothing of is a group holding the count
 * alone.
 *
 * Pure, so the arrangement is one a test can hold.
 *
 * @module components/features/releases/release-documents
 */
import type {
  HiddenReleaseMembers,
  HiddenReleaseProblems,
  ReleaseDocumentInfo,
  ReleaseMember,
  ReleaseMemberAction,
  ReleaseScopeNames,
} from "@admin/types/releases";

import { describeHidden } from "./release-hidden";

/** One group of the documents list. */
export interface ReleaseDocumentGroup {
  key: string;
  scopeKind: "collection" | "single" | "page";
  scopeSlug: string;
  /** The group's heading: the collection's plural, or the Single's name. */
  heading: string;
  /** The documents the reader may read, in the order they were added. */
  members: ReleaseMember[];
  /** "2 documents you can't view · Posts", or `null` when none are hidden. */
  hiddenLine: string | null;
  /** How many of the hidden documents have a hard problem. */
  hiddenNeedFix: number;
  /** How many documents the group holds, the hidden ones included. */
  total: number;
}

/** The inputs a grouping reads. */
export interface ReleaseDocumentGroupInputs {
  members: readonly ReleaseMember[];
  hidden?: readonly HiddenReleaseMembers[];
  hiddenProblems?: readonly HiddenReleaseProblems[];
  scopeNamesOf: (scopeSlug: string) => ReleaseScopeNames | undefined;
}

function scopeKey(scopeKind: string, scopeSlug: string): string {
  return `${scopeKind}:${scopeSlug}`;
}

/** A slug read as a heading while its collection's names are unknown. */
function slugHeading(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The release's documents, grouped as its page lists them. */
export function groupReleaseDocuments({
  members,
  hidden = [],
  hiddenProblems = [],
  scopeNamesOf,
}: ReleaseDocumentGroupInputs): ReleaseDocumentGroup[] {
  const groups = new Map<string, ReleaseDocumentGroup>();
  const groupFor = (
    scopeKind: ReleaseDocumentGroup["scopeKind"],
    scopeSlug: string,
    fallbackHeading?: string
  ): ReleaseDocumentGroup => {
    const key = scopeKey(scopeKind, scopeSlug);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        scopeKind,
        scopeSlug,
        heading:
          scopeNamesOf(scopeSlug)?.plural ??
          fallbackHeading ??
          slugHeading(scopeSlug),
        members: [],
        hiddenLine: null,
        hiddenNeedFix: 0,
        total: 0,
      };
      groups.set(key, group);
    }
    return group;
  };

  for (const member of members) {
    const group = groupFor(member.scopeKind, member.scopeSlug);
    group.members.push(member);
    group.total += 1;
  }
  for (const entry of hidden) {
    const group = groupFor(
      entry.scopeKind,
      entry.scopeSlug,
      entry.labels?.plural
    );
    group.hiddenLine = describeHidden([entry]);
    group.total += entry.count;
  }
  for (const entry of hiddenProblems) {
    const group = groups.get(scopeKey(entry.scopeKind, entry.scopeSlug));
    if (group) group.hiddenNeedFix += entry.hard;
  }
  return [...groups.values()];
}

/** How a document is named on the page, and whether it can be opened. */
export interface DocumentLabel {
  text: string;
  /** Said as a fact about the document rather than its name. */
  muted: boolean;
}

/**
 * What a document row is called: its title, "Untitled" for one with nothing
 * that names it, "Deleted document" for one the read no longer finds, and its
 * collection's singular while the read has not answered.
 */
export function documentLabel(
  info: ReleaseDocumentInfo | undefined,
  state: { pending: boolean; failed: boolean; singular: string }
): DocumentLabel {
  if (info) {
    return info.title
      ? { text: info.title, muted: false }
      : { text: "Untitled", muted: true };
  }
  if (state.pending) return { text: "Loading…", muted: true };
  if (state.failed) {
    return { text: `${state.singular} (name unavailable)`, muted: true };
  }
  return { text: "Deleted document", muted: true };
}

/**
 * Where a document stands now, in a few words: "Draft, never published",
 * "Published", "Unpublished". `null` where its collection keeps no status.
 */
export function documentStatusLine(
  info: ReleaseDocumentInfo | undefined
): string | null {
  if (!info?.status) return null;
  if (info.status === "published") return "Published";
  return info.everPublished === false
    ? "Draft, never published"
    : "Draft, not published now";
}

/** What a document does when the release runs, as its row says it. */
export const MEMBER_ACTION_LABEL: Record<ReleaseMemberAction, string> = {
  publish: "Goes live",
  unpublish: "Comes down",
};
