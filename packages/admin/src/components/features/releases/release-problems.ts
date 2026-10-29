/**
 * What a release's checks say about each of its documents, in words.
 *
 * The server reports a problem as a code with a few facts beside it. These
 * are the sentences the release page says for each, and the one way out it
 * offers: open the document to fix it, or take it out of the release. Kept as
 * plain functions so each wording is one a test can hold, and the page only
 * lays them out.
 *
 * A problem whose code this file has not met is still shown, in its code's
 * own words, so a check another feature registers is never silently dropped
 * from the page that has to tell the reader about it.
 *
 * @module components/features/releases/release-problems
 */
import type {
  ReleaseBlockerReason,
  ReleaseMemberAction,
  ReleaseReadiness,
  ReleaseReadinessFinding,
} from "@admin/types/releases";

import { BLOCKER_REASON } from "./release-blockers";

/** What the reader can do about a problem from the release page. */
export type ProblemRemedy = "open" | "remove" | null;

/** One problem, said for the document it is on. */
export interface ProblemWords {
  /** The sentence, starting with a capital and without a full stop. */
  text: string;
  remedy: ProblemRemedy;
  /** For a document that is also in another release: that release's id. */
  otherReleaseId?: string;
}

/** How the page names what the facts of a problem point at. */
export interface ProblemContext {
  /** This release's id, to tell which of two releases wins. */
  releaseId: string;
  /** A collection's singular name, from its slug. */
  singularOf: (scopeSlug: string) => string;
  /** Another release's title, when the page has read it. */
  releaseTitleOf: (releaseId: string) => string | undefined;
}

/** "1 link", "3 links". */
function links(count: number): string {
  return `${count} ${count === 1 ? "link" : "links"}`;
}

/** The fields a finding names, as a list a sentence can end with. */
function fieldList(finding: ReleaseReadinessFinding): string[] {
  const fields = finding.detail?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field): field is string => typeof field === "string");
}

/** "excerpt", "excerpt and slug", "excerpt, slug and title". */
function joined(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A detail value as a string, when it is one. */
function detailText(
  finding: ReleaseReadinessFinding,
  key: string
): string | undefined {
  const value = finding.detail?.[key];
  return typeof value === "string" ? value : undefined;
}

/** A detail count, at least one: a finding stands for one problem or more. */
function detailCount(finding: ReleaseReadinessFinding): number {
  const count = Number(detailText(finding, "count") ?? 1);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/** A code no sentence here knows, read as words: "NOT_APPROVED" is "Not approved". */
function codeAsWords(code: string): string {
  const words = code.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "the person who added it", from the blocker reasons the drain stops on. */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether a code is one of the reasons the run itself stops on. */
function isBlockerReason(code: string): code is ReleaseBlockerReason {
  return Object.prototype.hasOwnProperty.call(BLOCKER_REASON, code);
}

/** What going live or coming down needs the person who added it to be able to do. */
const ACTION_VERB: Record<ReleaseMemberAction, string> = {
  publish: "publish",
  unpublish: "unpublish",
};

/** A field finding's sentence: one for a single field, another for several. */
function countedFields(
  fields: readonly string[],
  one: (field: string | undefined) => string,
  many: (count: number, list: string) => string
): string {
  return fields.length > 1
    ? many(fields.length, joined(fields))
    : one(fields[0]);
}

/**
 * The words for each hard problem the core checks report, by code. A table
 * rather than one switch, so each wording reads on its own and a code is
 * added by adding a line.
 */
const HARD_WORDS: Record<
  string,
  (finding: ReleaseReadinessFinding) => ProblemWords
> = {
  REQUIRED_FIELD_MISSING: finding => ({
    text: countedFields(
      fieldList(finding),
      field => `Missing a required field${field ? `: ${field}` : ""}`,
      (count, list) => `Missing ${count} required fields: ${list}`
    ),
    remedy: "open",
  }),
  FIELD_INVALID: finding => ({
    text: countedFields(
      fieldList(finding),
      field => `${field ? `${field} is` : "A field is"} not valid`,
      (count, list) => `${count} fields are not valid: ${list}`
    ),
    remedy: "open",
  }),
  FIELD_NOT_PERMITTED: finding => {
    const fields = fieldList(finding);
    return {
      text: `The person who added it may no longer change ${fields.length > 0 ? joined(fields) : "one of its fields"}`,
      remedy: "remove",
    };
  },
  AUTHOR_MAY_NOT_ACT: finding => ({
    text: `The person who added it may no longer ${ACTION_VERB[finding.action]} it`,
    remedy: "remove",
  }),
  DOCUMENT_GONE: () => ({
    text: "This document no longer exists",
    remedy: "remove",
  }),
  NO_LIFECYCLE: () => ({
    text: "Its collection has no drafts, so a release cannot move it",
    remedy: "remove",
  }),
  COMPANION_WITHOUT_LIFECYCLE: () => ({
    text: "Its translations have no draft status, so a release cannot move them",
    remedy: "remove",
  }),
  DRAFT_HELD_IN_LOCALE: finding => {
    const locales = finding.detail?.locales;
    const named = Array.isArray(locales) ? joined(locales) : "";
    return {
      text: `Unreleased changes are waiting in ${named || "another language"}`,
      remedy: "open",
    };
  },
};

/** A problem that stops the release, in words. */
function hardWords(finding: ReleaseReadinessFinding): ProblemWords {
  const words = HARD_WORDS[finding.code];
  if (words) return words(finding);
  if (isBlockerReason(finding.code)) {
    return {
      text: capitalised(BLOCKER_REASON[finding.code].summary),
      remedy: "remove",
    };
  }
  return { text: codeAsWords(finding.code), remedy: null };
}

/** Which of two releases holding one document decides where it ends up. */
function otherReleaseWords(
  finding: ReleaseReadinessFinding,
  context: ProblemContext
): ProblemWords {
  const otherId = detailText(finding, "releaseId");
  const winner = detailText(finding, "winningReleaseId");
  const title = otherId ? context.releaseTitleOf(otherId) : undefined;
  const named = title ? `“${title}”` : "another scheduled release";
  let verdict = "whichever runs later wins";
  if (winner !== undefined && winner === otherId) {
    verdict = "that one runs later and wins";
  } else if (winner !== undefined && winner === context.releaseId) {
    verdict = "this release runs later and wins";
  }
  return {
    text: `Also in ${named}: ${verdict}`,
    remedy: null,
    ...(otherId ? { otherReleaseId: otherId } : {}),
  };
}

/** A link from this document that will not be live when it goes live. */
function unpublishedLinkWords(
  finding: ReleaseReadinessFinding,
  context: ProblemContext
): ProblemWords {
  const fields = fieldList(finding);
  const where = fields.length > 0 ? ` (${joined(fields)})` : "";
  const cause = detailText(finding, "cause");
  if (cause === "deleted") {
    const count = detailCount(finding);
    return {
      text: `${capitalised(links(count))} to deleted documents${where}`,
      remedy: "open",
    };
  }
  const slug = detailText(finding, "scopeSlug");
  const target = slug ? context.singularOf(slug).toLowerCase() : "document";
  return {
    text:
      cause === "comes-down"
        ? `Links to a ${target} that comes down before this goes live${where}`
        : `Links to a ${target} that will not be published${where}`,
    remedy: null,
  };
}

/** A note that does not stop the release, in words. */
function softWords(
  finding: ReleaseReadinessFinding,
  context: ProblemContext
): ProblemWords {
  switch (finding.code) {
    case "IN_OTHER_RELEASE":
      return otherReleaseWords(finding, context);
    case "UNPUBLISHED_LINK":
      return unpublishedLinkWords(finding, context);
    case "UNPUBLISHED_LINKS_HIDDEN":
      return {
        text: `${capitalised(links(detailCount(finding)))} to documents you can't view will not be live`,
        remedy: null,
      };
    case "UNPUBLISHED_LINK_IN_HIDDEN_FIELD":
      return {
        text: `${capitalised(links(detailCount(finding)))} in fields you can't view will not be live`,
        remedy: null,
      };
    default:
      return { text: codeAsWords(finding.code), remedy: null };
  }
}

/** One document's problems, hard ones first, each said once. */
export interface MemberProblems {
  hard: ProblemWords[];
  soft: ProblemWords[];
}

const NO_PROBLEMS: MemberProblems = { hard: [], soft: [] };

/** The same sentence twice is one problem to the reader. */
function distinct(words: ProblemWords[]): ProblemWords[] {
  const seen = new Set<string>();
  return words.filter(word => {
    if (seen.has(word.text)) return false;
    seen.add(word.text);
    return true;
  });
}

/**
 * Each document's problems, by its member id, in the order the server gave
 * them: hard before soft, each group in the documents' order.
 */
export function problemsByMember(
  readiness: Pick<ReleaseReadiness, "hard" | "soft"> | undefined,
  context: ProblemContext
): (memberId: string) => MemberProblems {
  if (!readiness) return () => NO_PROBLEMS;
  const byMember = new Map<string, MemberProblems>();
  const entry = (memberId: string): MemberProblems => {
    let held = byMember.get(memberId);
    if (!held) {
      held = { hard: [], soft: [] };
      byMember.set(memberId, held);
    }
    return held;
  };
  for (const finding of readiness.hard) {
    entry(finding.memberId).hard.push(hardWords(finding));
  }
  for (const finding of readiness.soft) {
    entry(finding.memberId).soft.push(softWords(finding, context));
  }
  for (const held of byMember.values()) {
    held.hard = distinct(held.hard);
    held.soft = distinct(held.soft);
  }
  return memberId => byMember.get(memberId) ?? NO_PROBLEMS;
}

/** The other releases the soft notes name, each once, to read their titles. */
export function otherReleaseIds(
  readiness: Pick<ReleaseReadiness, "soft"> | undefined
): string[] {
  const ids = new Set<string>();
  for (const finding of readiness?.soft ?? []) {
    if (finding.code !== "IN_OTHER_RELEASE") continue;
    const id = detailText(finding, "releaseId");
    if (id) ids.add(id);
  }
  return [...ids];
}
