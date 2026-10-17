/**
 * Running a release's check sources over its members.
 *
 * The ONE place findings are produced. The readiness a reader is shown, the
 * refusal to schedule or publish now, the refusal to add to a scheduled
 * release and the blocking reasons are all this, over different members or
 * sources, so none of them can come to disagree with another.
 *
 * @module domains/releases/readiness/evaluate-readiness
 * @experimental
 */
import { NextlyError } from "../../../errors";
import type { ReleaseMemberAction } from "../../../schemas/releases/types";
import type { ReleaseMemberRow, ReleaseRow } from "../releases-repository";

import {
  READINESS_BATCH_SIZE,
  type ReleaseCheckFinding,
  type ReleaseCheckReads,
  type ReleaseCheckSource,
} from "./check-sources";

/**
 * One finding as a reader is shown it: what was found, by which source, and
 * which document it is about.
 *
 * @experimental
 */
export interface ReadinessFinding<Code extends string = string>
  extends ReleaseCheckFinding<Code> {
  /** The key of the source that reported it. */
  source: string;
  action: ReleaseMemberAction;
  scopeKind: ReleaseMemberRow["scopeKind"];
  scopeSlug: string;
  entryId: string;
}

/**
 * Every finding for a release, hard ones apart from soft ones, each in the
 * order its members were added.
 *
 * @experimental
 */
export interface ReleaseReadiness<Code extends string = string> {
  releaseId: string;
  hard: ReadinessFinding<Code>[];
  soft: ReadinessFinding<Code>[];
}

/**
 * Run `sources` over `members`, a batch of {@link READINESS_BATCH_SIZE} at a
 * time, and answer only once every batch is checked: a problem in the last
 * member of a large release is reported like one in the first.
 *
 * Ordered by member, in the order `members` is given, then by source, then as
 * the source reported them. A finding naming a member outside its batch, or a
 * code its source did not declare, is a defect in that source and is refused
 * rather than shown.
 */
export async function evaluateReadiness<Code extends string>(args: {
  release: ReleaseRow;
  members: readonly ReleaseMemberRow[];
  sources: readonly ReleaseCheckSource<Code>[];
  reads: ReleaseCheckReads;
  now: Date;
}): Promise<Omit<ReleaseReadiness<Code>, "releaseId">> {
  const ctx = { release: args.release, now: args.now, reads: args.reads };
  const found: Array<{ at: number; finding: ReadinessFinding<Code> }> = [];
  for (
    let start = 0;
    start < args.members.length;
    start += READINESS_BATCH_SIZE
  ) {
    const batch = args.members.slice(start, start + READINESS_BATCH_SIZE);
    const position = new Map(batch.map((member, i) => [member.id, start + i]));
    for (const source of args.sources) {
      for (const finding of await source.check(batch, ctx)) {
        const at = position.get(finding.memberId);
        assertOwnFinding(source, finding, at);
        const member = args.members[at];
        found.push({ at, finding: shown(source, finding, member) });
      }
    }
  }
  // Stable, so findings for one member keep the source order they were
  // produced in.
  found.sort((a, b) => a.at - b.at);
  const ordered = found.map(entry => entry.finding);
  const severityOf = new Map(args.sources.map(s => [s.key, s.severity]));
  return {
    hard: ordered.filter(f => severityOf.get(f.source) === "hard"),
    soft: ordered.filter(f => severityOf.get(f.source) === "soft"),
  };
}

/** A finding with the source and the member's document beside it. */
function shown<Code extends string>(
  source: ReleaseCheckSource<Code>,
  finding: ReleaseCheckFinding<Code>,
  member: ReleaseMemberRow
): ReadinessFinding<Code> {
  return {
    memberId: finding.memberId,
    code: finding.code,
    ...(finding.detail === undefined ? {} : { detail: finding.detail }),
    source: source.key,
    action: member.action,
    scopeKind: member.scopeKind,
    scopeSlug: member.scopeSlug,
    entryId: member.entryId,
  };
}

/**
 * Refuse a finding its source had no business reporting: about a member it
 * was not handed, or with a code it did not declare. The type forbids the
 * second, and a source written in JavaScript is not bound by the type.
 */
function assertOwnFinding<Code extends string>(
  source: ReleaseCheckSource<Code>,
  finding: ReleaseCheckFinding<Code>,
  at: number | undefined
): asserts at is number {
  if (at !== undefined && source.codes.includes(finding.code)) return;
  throw NextlyError.internal({
    logContext: {
      reason: "release-check-source-misreported",
      source: source.key,
      code: finding.code,
      memberId: finding.memberId,
    },
  });
}
