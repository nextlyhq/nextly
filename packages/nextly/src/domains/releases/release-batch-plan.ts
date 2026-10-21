/**
 * What an action that puts several documents into a release at once will
 * write, worked out from what the caller asked before anything is read.
 *
 * Two actions do that: adding several documents to a release in one step,
 * and scheduling a document in one step (on its own, with an existing
 * release, or in a new one), which may also take the linked documents the
 * add offered. Both are all-or-nothing, so everything a request can be
 * refused for on its own face is refused here, before a document is read or
 * a row is written: an empty batch, one larger than a release may hold, a
 * document named twice, a path that is not one of the three, and linked
 * documents offered with a document that is coming down.
 *
 * Pure, so its rules are tested without a database.
 *
 * @module domains/releases/release-batch-plan
 * @experimental
 */
import { NextlyError } from "../../errors";
import {
  RELEASE_MEMBER_LIMIT,
  type ReleaseKind,
  type ReleaseMemberAction,
} from "../../schemas/releases/types";

/**
 * A document as a batch names it: which one, and what the release does to
 * it.
 *
 * @experimental
 */
export interface BatchMember {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  locale?: string | null;
  action: ReleaseMemberAction;
}

/**
 * A linked document the caller accepted, going live with the document it is
 * linked from. It names no action: a linked document is offered only to go
 * live, so that is what it does.
 *
 * @experimental
 */
export type LinkedDocument = Omit<BatchMember, "action">;

/**
 * How a document scheduled in one step goes out.
 *
 * - `own`: on its own at `at`, in a release of its own named `title`. A
 *   single-document release, or an ordinary one when linked documents go
 *   with it, since a single-document release holds one.
 * - `existing`: with an existing ordinary release that is a draft or
 *   scheduled, at that release's time.
 * - `new`: in a new release named `title`, a draft for its time to be set.
 *
 * @experimental
 */
export type DocumentScheduleTarget =
  | { into: "own"; title: string; at: Date; timezone: string }
  | { into: "existing"; releaseId: string }
  | { into: "new"; title: string; description?: string | null };

/**
 * A document to schedule in one step, with the linked documents accepted
 * with it, and the way it goes out.
 *
 * @experimental
 */
export type ScheduleDocumentInput = {
  document: BatchMember;
  linked?: readonly LinkedDocument[];
} & DocumentScheduleTarget;

/** The ways a document scheduled in one step can go out. */
export const DOCUMENT_SCHEDULE_PATHS = ["own", "existing", "new"] as const;

/**
 * What scheduling a document will write: its documents, the document first,
 * and the release they go into, either an existing one or one to create
 * (and, on its own, to schedule).
 *
 * @experimental
 */
export interface DocumentSchedulePlan {
  /** Each with its language as stored: `null`, the whole document. */
  members: Array<BatchMember & { locale: string | null }>;
  release:
    | { existing: string }
    | {
        create: {
          title: string;
          description: string | null;
          kind: ReleaseKind;
        };
        schedule?: { at: Date; timezone: string };
      };
}

/**
 * The key two names of one document share. A Single has one document, so
 * it is named by its slug whatever id the caller sent; the id is resolved to
 * the row's own later, and two names of one Single must not both pass here.
 */
function documentKey(member: BatchMember): string {
  return JSON.stringify(
    member.scopeKind === "single"
      ? [member.scopeKind, member.scopeSlug]
      : [member.scopeKind, member.scopeSlug, member.entryId]
  );
}

/**
 * The batch as it will be written, in the order given, or the refusal.
 *
 * Refused rather than trimmed or merged: a batch is one decision, and
 * dropping the part of it that cannot land would add something other than
 * what the caller chose. More documents than a release may hold can never
 * fit, so that is said before anything is read, and how many fit in the
 * release as it stands is said under its lock, at the write.
 *
 * @experimental
 */
export function planMemberBatch<M extends BatchMember>(
  members: readonly M[]
): M[] {
  // Checked as well as typed: the Direct API is reachable from JavaScript,
  // where `members: undefined` would otherwise fail as a TypeError further in.
  if (!Array.isArray(members) || members.length === 0) {
    throw NextlyError.invalidInput({
      message: "`members` must list at least one document.",
      logContext: { reason: "empty-member-batch" },
    });
  }
  if (members.length > RELEASE_MEMBER_LIMIT) {
    throw NextlyError.invalidInput({
      message: `A release holds at most ${RELEASE_MEMBER_LIMIT} documents, so at most ${RELEASE_MEMBER_LIMIT} can be added at once; ${members.length} were given.`,
      logContext: {
        reason: "member-batch-too-large",
        given: members.length,
        limit: RELEASE_MEMBER_LIMIT,
      },
    });
  }
  const seen = new Map<string, number>();
  for (const [index, member] of members.entries()) {
    if (member === null || typeof member !== "object") {
      throw NextlyError.invalidInput({
        message: `\`members[${index}]\` must be a document.`,
        logContext: { reason: "member-batch-entry-not-object", index },
      });
    }
    const key = documentKey(member);
    const first = seen.get(key);
    if (first !== undefined) {
      // Named by position, which is what the caller sent: a document named
      // twice is a client defect, and merging the two would pick one of two
      // actions the caller may have meant differently.
      throw NextlyError.invalidInput({
        message: `\`members[${index}]\` names the same document as \`members[${first}]\`.`,
        logContext: { reason: "member-batch-duplicate", index, first },
      });
    }
    seen.set(key, index);
  }
  return [...members];
}

/**
 * The plan for scheduling a document in one step, or the refusal.
 *
 * The document comes first and the linked documents after it, each going
 * live, so the release lists them in the order the person chose them. On
 * its own, the document's release is a single-document one unless linked
 * documents go with it, when it is an ordinary release holding all of them:
 * a single-document release holds exactly one.
 *
 * @experimental
 */
export function planDocumentSchedule(
  input: ScheduleDocumentInput
): DocumentSchedulePlan {
  if (input === null || typeof input !== "object") {
    throw NextlyError.invalidInput({
      message: "Give the document to schedule and how it goes out.",
      logContext: { reason: "schedule-document-not-object" },
    });
  }
  const into: unknown = input.into;
  if (
    typeof into !== "string" ||
    !(DOCUMENT_SCHEDULE_PATHS as readonly string[]).includes(into)
  ) {
    throw NextlyError.invalidInput({
      message: `\`into\` must be one of: ${DOCUMENT_SCHEDULE_PATHS.join(", ")}.`,
      logContext: { reason: "invalid-schedule-document-path" },
    });
  }
  const linked = linkedDocumentsOf(input);
  const members = planMemberBatch<BatchMember>([
    input.document,
    ...linked.map(document => ({ ...document, action: "publish" as const })),
  ]).map(member => ({ ...member, locale: member.locale ?? null }));
  if (input.into === "existing") {
    if (typeof input.releaseId !== "string" || input.releaseId.length === 0) {
      throw NextlyError.invalidInput({
        message: "`releaseId` names the release the document goes out with.",
        logContext: { reason: "schedule-document-without-release" },
      });
    }
    return { members, release: { existing: input.releaseId } };
  }
  const title = requireTitle(input.title);
  if (input.into === "new") {
    return {
      members,
      release: {
        create: {
          title,
          description: descriptionOf(input.description),
          kind: "release",
        },
      },
    };
  }
  return {
    members,
    release: {
      create: {
        title,
        description: null,
        kind: linked.length > 0 ? "release" : "single",
      },
      schedule: { at: input.at, timezone: input.timezone },
    },
  };
}

/**
 * The linked documents accepted, or none. Only with a document going live:
 * a document coming down is never offered its links, since what it pointed
 * at stops mattering once it is not live itself.
 */
function linkedDocumentsOf(
  input: ScheduleDocumentInput
): readonly LinkedDocument[] {
  const linked: unknown = input.linked;
  if (linked === undefined) return [];
  if (!Array.isArray(linked)) {
    throw NextlyError.invalidInput({
      message: "`linked` must be a list of documents.",
      logContext: { reason: "linked-not-a-list" },
    });
  }
  if (linked.length > 0 && input.document?.action !== "publish") {
    throw NextlyError.invalidInput({
      message:
        "Linked documents go live with the document they are linked from, so they can only be added with a document going live.",
      logContext: { reason: "linked-with-document-coming-down" },
    });
  }
  return linked as readonly LinkedDocument[];
}

/** A release's name as given: text, not empty. Its length is the service's. */
function requireTitle(title: unknown): string {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw NextlyError.invalidInput({
      message: "`title` names the release, and must not be empty.",
      logContext: { reason: "schedule-document-without-title" },
    });
  }
  return title;
}

/** A description as given: text, `null` or absent, which is `null`. */
function descriptionOf(description: unknown): string | null {
  if (description === undefined || description === null) return null;
  if (typeof description !== "string") {
    throw NextlyError.invalidInput({
      message: "`description` must be a string or null.",
      logContext: { reason: "invalid-description" },
    });
  }
  return description;
}
