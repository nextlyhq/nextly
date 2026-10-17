/**
 * Where a release's checks come from: sources, each declared once and
 * registered at boot by the feature that owns it.
 *
 * ```ts
 * export const approvals = defineReleaseCheckSource({
 *   key: "workflows.approval",
 *   severity: "hard",
 *   codes: ["NOT_APPROVED"],
 *   check: async (batch, ctx) => [],
 * });
 * registerReleaseCheckSource(approvals);
 * ```
 *
 * A source answers for one batch of a release's members at a time, and
 * reports FINDINGS: a member and a code. The codes are a closed union the
 * source declares, so a client renders a code it knows rather than prose a
 * source wrote, and the type of `check` holds a source to its own codes.
 *
 * Hard findings stop a release from being scheduled or published now; soft
 * ones are notes. Which is which is the source's, declared once, so one source
 * cannot report the same code as hard on one release and soft on another.
 *
 * The registry is open and typed so features can add sources without editing
 * the service that asks them. Only core's own sources are registered for now:
 * a source runs inside scheduling, publishing now and adding to a scheduled
 * release, and a plugin's source would need its failures kept from stopping
 * those.
 *
 * @module domains/releases/readiness/check-sources
 * @experimental Core sources only for now.
 */
import { NextlyError } from "../../../errors";
import type { ReleaseMemberAction } from "../../../schemas/releases/types";
import type { ValidationIssue } from "../../../shared/lib/entry-validation";
import type { UserContext } from "../../collections/services/collection-types";
import type {
  DocumentRef,
  ReleaseMemberRow,
  ReleaseRow,
} from "../releases-repository";
import type { DueMember } from "../resolve-release-effect";

/**
 * Whether a finding stops the release (`hard`) or is a note (`soft`).
 *
 * @experimental
 */
export type ReleaseCheckSeverity = "hard" | "soft";

/** Every severity, for a runtime check of a source declared in JavaScript. */
const SEVERITIES: readonly ReleaseCheckSeverity[] = ["hard", "soft"];

/**
 * One thing a source found about one member.
 *
 * @typeParam Code - The codes the reporting source declares.
 * @experimental
 */
export interface ReleaseCheckFinding<Code extends string = string> {
  memberId: string;
  code: Code;
  /**
   * Facts a reader needs beside the code, such as which other release holds
   * the document, or which fields are missing. Identifiers and field paths,
   * never sentences: the client words them.
   */
  detail?: Readonly<Record<string, string | null | readonly string[]>>;
}

/** The scope a member's document lives in. */
export interface ReleaseCheckScope {
  scopeKind: ReleaseMemberRow["scopeKind"];
  scopeSlug: string;
}

/**
 * What a source may ask of the world outside its batch.
 *
 * Every answer is the one the release's own run would reach: the run performs
 * each member as its recorded author, through the ordinary write, so a check
 * that asked anything else could pass a member the run then refuses.
 *
 * @experimental
 */
export interface ReleaseCheckReads {
  /** Which of these user ids belong to users who exist and are active. */
  liveAuthors(ids: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * The identity the run would act as for this author, with their roles, or
   * `null` when there is nobody to act as.
   */
  actingAs(authorId: string): Promise<UserContext | null>;
  /**
   * Whether this person may perform this lifecycle action in this scope,
   * through the same access gate the run's write meets.
   */
  mayPerform(
    user: UserContext,
    scope: ReleaseCheckScope,
    action: ReleaseMemberAction
  ): Promise<boolean>;
  /**
   * Whether the scope still declares a draft/published lifecycle: the
   * condition a document had to meet to join the release, asked again.
   */
  declaresLifecycle(scope: ReleaseCheckScope): Promise<boolean>;
  /** Which of these documents still exist, as `documentRefKey` keys. */
  existing(refs: readonly DocumentRef[]): Promise<ReadonlySet<string>>;
  /**
   * What a publish of each of these documents of one scope, as this person,
   * would be refused with, judged without writing, keyed by entry id: read
   * for the scope once rather than per document. Empty for a document that
   * would pass, or that is not there.
   */
  publishProblems(
    scope: ReleaseCheckScope,
    entryIds: readonly string[],
    user: UserContext
  ): Promise<ReadonlyMap<string, readonly ValidationIssue[]>>;
  /**
   * For each of these documents of one scope, the other languages holding
   * unreleased work that would make the release's document-wide write refuse,
   * whatever its action, keyed by entry id: read for the scope once rather
   * than per document.
   */
  heldDraftLocales(
    scope: ReleaseCheckScope,
    entryIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /**
   * The scheduled releases' members for these documents, keyed by
   * `documentRefKey`, this release's own included.
   */
  scheduledMemberships(
    refs: readonly DocumentRef[]
  ): Promise<ReadonlyMap<string, readonly DueMember[]>>;
}

/**
 * What a source is told about the release it is checking.
 *
 * @experimental
 */
export interface ReleaseCheckContext {
  release: ReleaseRow;
  /** One reading of the clock for the whole check. */
  now: Date;
  reads: ReleaseCheckReads;
}

/**
 * A source of findings.
 *
 * @typeParam Code - The codes it may report. `check` can return no other.
 * @experimental
 */
export interface ReleaseCheckSource<Code extends string = string> {
  /** `<feature>.<name>` in lowercase, such as `core.author`. */
  key: string;
  severity: ReleaseCheckSeverity;
  /** Every code this source reports, in upper snake case. */
  codes: readonly Code[];
  /**
   * The findings for one batch of members, at most
   * {@link READINESS_BATCH_SIZE} of them. Only members of the batch may be
   * named.
   */
  check(
    batch: readonly ReleaseMemberRow[],
    ctx: ReleaseCheckContext
  ): Promise<readonly ReleaseCheckFinding<Code>[]>;
  /**
   * Reserved for stopping a scheduled release as soon as a hard problem
   * appears, rather than at its instant. Declared with the source so a source
   * cannot add a hard problem that stop would miss. Not read yet.
   */
  stopsEarly?: (member: ReleaseMemberRow) => boolean;
}

/**
 * How many members a source is handed at once. A release larger than this is
 * checked in several batches, and answered only once every batch is checked.
 */
export const READINESS_BATCH_SIZE = 200;

/** `<feature>.<name>`, lowercase, the namespace keeping two features apart. */
const SOURCE_KEY = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/** A code a client switches on: upper snake case. */
const FINDING_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Declare a source, refusing one whose key, severity or codes are malformed.
 *
 * Generic over the codes so `check` is typed to report only those: a finding
 * with a code the source did not declare does not compile.
 *
 * @experimental
 */
export function defineReleaseCheckSource<const Code extends string>(
  source: ReleaseCheckSource<Code>
): ReleaseCheckSource<Code> {
  const problem = sourceProblem(source);
  if (problem !== null) {
    throw NextlyError.internal({
      logContext: {
        reason: "invalid-release-check-source",
        key: source.key,
        detail: problem,
      },
    });
  }
  return source;
}

/** What is wrong with a declared source, or `null` when nothing is. */
function sourceProblem(source: ReleaseCheckSource<string>): string | null {
  if (!SOURCE_KEY.test(source.key)) {
    return `A release check source key must be "<feature>.<name>" in lowercase, such as "core.author"; got "${source.key}".`;
  }
  if (!SEVERITIES.includes(source.severity)) {
    return `Release check source "${source.key}" must be "hard" or "soft".`;
  }
  if (source.codes.length === 0) {
    return `Release check source "${source.key}" declares no codes.`;
  }
  if (new Set(source.codes).size !== source.codes.length) {
    return `Release check source "${source.key}" declares a code twice.`;
  }
  const bad = source.codes.find(code => !FINDING_CODE.test(code));
  if (bad !== undefined) {
    return `Release check source "${source.key}" has code "${bad}"; codes are upper snake case.`;
  }
  return null;
}

const sources = new Map<string, ReleaseCheckSource>();

/**
 * Make a source part of every release's checks.
 *
 * Registering a key again REPLACES it, keeping its place in the order, so a
 * development reload that re-runs every registration does not run a source
 * twice.
 *
 * @experimental Core sources only for now.
 */
export function registerReleaseCheckSource<Code extends string>(
  source: ReleaseCheckSource<Code>
): void {
  sources.set(source.key, defineReleaseCheckSource(source));
}

/** Every registered source, in the order they were first registered. */
export function releaseCheckSources(): readonly ReleaseCheckSource[] {
  return [...sources.values()];
}

/** Forget every source. For tests only. */
export function clearReleaseCheckSourcesForTests(): void {
  sources.clear();
}
