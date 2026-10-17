/**
 * Core's own release checks.
 *
 * Each asks the question the release's run would answer at its instant, as
 * the run would answer it: the run performs every member as its recorded
 * author, through the ordinary write, so these ask as that author and through
 * that write's own gate and validation.
 *
 *   core.author          hard  who the run acts as: none, gone, or a locale
 *   core.permission      hard  the author may no longer perform the action
 *   core.exists          hard  the document is gone
 *   core.held-drafts     hard  another language holds unreleased work
 *   core.required-fields hard  a document going live would fail its publish's
 *                              validation or field rules
 *   core.other-release   soft  another scheduled release holds the document
 *
 * `core.author` and `core.permission` are two sources rather than one so the
 * blocking reasons — the three `core.author` codes, which a stopped release is
 * explained by — are that one source's findings and nothing else.
 *
 * @module domains/releases/readiness/core-sources
 * @experimental
 */
import { NextlyError } from "../../../errors";
import type { ReleaseBlockerReason } from "../../../schemas/releases/types";
import type { ValidationIssue } from "../../../shared/lib/entry-validation";
import type { UserContext } from "../../collections/services/collection-types";
import { documentRefKey, type ReleaseMemberRow } from "../releases-repository";
import {
  resolveReleaseEffect,
  type DueMember,
} from "../resolve-release-effect";

import {
  defineReleaseCheckSource,
  registerReleaseCheckSource,
  releaseCheckSources,
  type ReleaseCheckContext,
  type ReleaseCheckFinding,
  type ReleaseCheckSource,
} from "./check-sources";

/**
 * Why this member cannot be run as anybody, or `null` if it can.
 *
 * The order is the drain's: a member that is BOTH locale-scoped and authorless
 * is reported as the one the drain would actually stop on, rather than
 * whichever a loop noticed first.
 */
function blockerReasonFor(
  member: ReleaseMemberRow,
  liveAuthors: ReadonlySet<string>
): ReleaseBlockerReason | null {
  if (member.locale !== null) return "LOCALE_SCOPED";
  if (member.createdBy === null) return "NO_AUTHOR";
  if (!liveAuthors.has(member.createdBy)) return "AUTHOR_GONE";
  return null;
}

/** Every author named in the batch, once. */
function authorsOf(batch: readonly ReleaseMemberRow[]): string[] {
  return [
    ...new Set(
      batch
        .map(member => member.createdBy)
        .filter((id): id is string => id !== null)
    ),
  ];
}

/**
 * The members the run could act on at all: document-wide, with an author.
 * The others are `core.author`'s to report, and are not asked about again.
 */
function runnable(
  batch: readonly ReleaseMemberRow[]
): Array<ReleaseMemberRow & { createdBy: string }> {
  return batch.filter(
    (member): member is ReleaseMemberRow & { createdBy: string } =>
      member.locale === null && member.createdBy !== null
  );
}

/** The scope a member's document lives in, as one key. */
function scopeKey(member: ReleaseMemberRow): string {
  return `${member.scopeKind}:${member.scopeSlug}`;
}

/**
 * Members grouped by a key, in the order each group is first met, each group
 * in member order. A key may be a list of parts, joined unambiguously.
 */
function groupedBy<M>(
  members: readonly M[],
  keyOf: (member: M) => string | ReadonlyArray<string | null>
): M[][] {
  const groups = new Map<string, M[]>();
  for (const member of members) {
    const key = keyOf(member);
    const flat = typeof key === "string" ? key : JSON.stringify(key);
    groups.set(flat, [...(groups.get(flat) ?? []), member]);
  }
  return [...groups.values()];
}

/**
 * The run's identity for each author, looked up once per check. `null` for an
 * author with nobody to act as, which `core.author` reports.
 */
function identities(
  ctx: ReleaseCheckContext
): (authorId: string) => Promise<UserContext | null> {
  const known = new Map<string, Promise<UserContext | null>>();
  return authorId => {
    let found = known.get(authorId);
    if (found === undefined) {
      found = ctx.reads.actingAs(authorId);
      known.set(authorId, found);
    }
    return found;
  };
}

/** Who the run acts as for each member: nobody, somebody gone, or a locale. */
export const CORE_AUTHOR_SOURCE = defineReleaseCheckSource({
  key: "core.author",
  severity: "hard",
  codes: [
    "LOCALE_SCOPED",
    "NO_AUTHOR",
    "AUTHOR_GONE",
  ] satisfies readonly ReleaseBlockerReason[],
  async check(batch, ctx) {
    const authors = authorsOf(batch);
    // Asked once for every author in the batch, so fifty documents cost one
    // lookup.
    const live =
      authors.length === 0
        ? new Set<string>()
        : await ctx.reads.liveAuthors(authors);
    return batch.flatMap(member => {
      const code = blockerReasonFor(member, live);
      return code === null ? [] : [{ memberId: member.id, code }];
    });
  },
});

/**
 * Whether each member's author may still perform its action.
 *
 * Asked once per author, scope and action rather than per member: the gate
 * answers for a scope, so a release of two hundred documents by three people
 * in one collection costs a handful of questions.
 */
export const CORE_PERMISSION_SOURCE = defineReleaseCheckSource({
  key: "core.permission",
  severity: "hard",
  codes: ["AUTHOR_MAY_NOT_ACT"],
  async check(batch, ctx) {
    const actingAs = identities(ctx);
    const findings: ReleaseCheckFinding<"AUTHOR_MAY_NOT_ACT">[] = [];
    const groups = groupedBy(runnable(batch), member => [
      member.createdBy,
      scopeKey(member),
      member.action,
    ]);
    for (const members of groups) {
      const [first] = members;
      const user = await actingAs(first.createdBy);
      if (user === null) continue;
      if (await ctx.reads.mayPerform(user, first, first.action)) continue;
      for (const member of members) {
        findings.push({ memberId: member.id, code: "AUTHOR_MAY_NOT_ACT" });
      }
    }
    return findings;
  },
});

/** Whether each member's document is still there. */
export const CORE_EXISTS_SOURCE = defineReleaseCheckSource({
  key: "core.exists",
  severity: "hard",
  codes: ["DOCUMENT_GONE"],
  async check(batch, ctx) {
    if (batch.length === 0) return [];
    const existing = await ctx.reads.existing(batch);
    return batch
      .filter(member => !existing.has(documentRefKey(member)))
      .map(member => ({ memberId: member.id, code: "DOCUMENT_GONE" as const }));
  },
});

/**
 * Whether another language holds unreleased work that the release's
 * document-wide write would be refused over, going live or coming down alike:
 * the write will not decide the fate of work nobody has released.
 */
export const CORE_HELD_DRAFTS_SOURCE = defineReleaseCheckSource({
  key: "core.held-drafts",
  severity: "hard",
  codes: ["DRAFT_HELD_IN_LOCALE"],
  async check(batch, ctx) {
    const findings: ReleaseCheckFinding<"DRAFT_HELD_IN_LOCALE">[] = [];
    // One read per scope for every member of the batch in it.
    for (const members of groupedBy(runnable(batch), scopeKey)) {
      const held = await ctx.reads.heldDraftLocales(
        members[0],
        members.map(member => member.entryId)
      );
      for (const member of members) {
        const locales = held.get(member.entryId) ?? [];
        if (locales.length === 0) continue;
        findings.push({
          memberId: member.id,
          code: "DRAFT_HELD_IN_LOCALE",
          detail: { locales: [...locales] },
        });
      }
    }
    return findings;
  },
});

/** What a refused publish's issues are reported as, in this order. */
const FIELD_FINDINGS = [
  "REQUIRED_FIELD_MISSING",
  "FIELD_NOT_PERMITTED",
  "FIELD_INVALID",
] as const;
type FieldFinding = (typeof FIELD_FINDINGS)[number];

/**
 * The finding one refused field is reported under: a missing required value,
 * which an author fixes by filling the field in; a field the author may no
 * longer write, which a pending change edits; or any other failure.
 */
function fieldFindingFor(issueCode: string): FieldFinding {
  if (issueCode === "REQUIRED") return "REQUIRED_FIELD_MISSING";
  if (issueCode === "FORBIDDEN") return "FIELD_NOT_PERMITTED";
  return "FIELD_INVALID";
}

/**
 * Whether each document going live would pass what its publish judges: the
 * validation, and the field rules a pending change meets. A document coming
 * down is not judged here.
 *
 * Judged as the author, the person the publish is made as.
 */
export const CORE_REQUIRED_FIELDS_SOURCE = defineReleaseCheckSource({
  key: "core.required-fields",
  severity: "hard",
  codes: FIELD_FINDINGS,
  async check(batch, ctx) {
    const actingAs = identities(ctx);
    const findings: ReleaseCheckFinding<FieldFinding>[] = [];
    const goingLive = runnable(batch).filter(m => m.action === "publish");
    // One read per author and scope: a publish is judged as its author, and a
    // scope's schema, rows and drafts are read once for its members.
    for (const members of groupedBy(goingLive, m => [
      m.createdBy,
      scopeKey(m),
    ])) {
      const user = await actingAs(members[0].createdBy);
      if (user === null) continue;
      const issues = await ctx.reads.publishProblems(
        members[0],
        members.map(member => member.entryId),
        user
      );
      for (const member of members) {
        findings.push(
          ...fieldFindings(member.id, issues.get(member.entryId) ?? [])
        );
      }
    }
    return findings;
  },
});

/** One member's refused fields, as findings, one per kind of refusal. */
function fieldFindings(
  memberId: string,
  issues: readonly ValidationIssue[]
): ReleaseCheckFinding<FieldFinding>[] {
  return FIELD_FINDINGS.flatMap(code => {
    const fields = issues
      .filter(issue => fieldFindingFor(issue.code) === code)
      .map(issue => issue.path);
    return fields.length === 0 ? [] : [{ memberId, code, detail: { fields } }];
  });
}

/**
 * Other scheduled releases holding each member's document, and which of the
 * two decides where the document ends up: the later at its instant, by the
 * rule the read path and the run decide with. `null` while this release has
 * no instant to compare.
 */
export const CORE_OTHER_RELEASE_SOURCE = defineReleaseCheckSource({
  key: "core.other-release",
  severity: "soft",
  codes: ["IN_OTHER_RELEASE"],
  async check(batch, ctx) {
    if (batch.length === 0) return [];
    const held = await ctx.reads.scheduledMemberships(batch);
    return batch.flatMap(member =>
      (held.get(documentRefKey(member)) ?? [])
        .filter(other => other.releaseId !== member.releaseId)
        .map(other => ({
          memberId: member.id,
          code: "IN_OTHER_RELEASE" as const,
          detail: {
            releaseId: other.releaseId,
            winningReleaseId: winnerOf(ctx, member, other),
          },
        }))
    );
  },
});

/** Which of two memberships of one document stands once both have run. */
function winnerOf(
  ctx: ReleaseCheckContext,
  member: ReleaseMemberRow,
  other: DueMember
): string | null {
  const at = ctx.release.scheduledAt;
  if (at === null) return null;
  const mine = {
    memberId: member.id,
    releaseId: member.releaseId,
    action: member.action,
    scheduledAt: at,
    createdAt: member.createdAt,
  };
  // Asked at the later of the two instants, when both are due, so the rule
  // answers which one is applied last.
  const now = new Date(Math.max(at.getTime(), other.scheduledAt.getTime()));
  return resolveReleaseEffect({ members: [mine, other], now }).releaseId;
}

/** Core's sources, in the order their findings are listed for one member. */
export const CORE_RELEASE_CHECK_SOURCES: readonly ReleaseCheckSource[] = [
  CORE_AUTHOR_SOURCE,
  CORE_PERMISSION_SOURCE,
  CORE_EXISTS_SOURCE,
  CORE_HELD_DRAFTS_SOURCE,
  CORE_REQUIRED_FIELDS_SOURCE,
  CORE_OTHER_RELEASE_SOURCE,
];

/** Register core's sources. Called by the releases feature's registration. */
export function registerCoreReleaseCheckSources(): void {
  for (const source of CORE_RELEASE_CHECK_SOURCES) {
    registerReleaseCheckSource(source);
  }
}

/**
 * The registered sources, refusing a registry missing any of core's.
 *
 * Without them a release would read as ready and schedule however broken its
 * members are, and nothing about the answer would say the checks never ran.
 */
export function registeredReleaseCheckSources(): readonly ReleaseCheckSource[] {
  const registered = releaseCheckSources();
  const keys = new Set(registered.map(source => source.key));
  const missing = CORE_RELEASE_CHECK_SOURCES.filter(s => !keys.has(s.key));
  if (missing.length > 0) {
    throw NextlyError.internal({
      logContext: {
        reason: "core-release-check-sources-unregistered",
        missing: missing.map(source => source.key),
      },
    });
  }
  return registered;
}
