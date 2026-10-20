/**
 * Links that will not be live when a document goes live.
 *
 * A document going live in a release may point at other documents through its
 * relationship and upload fields: an author, a category, related posts. When
 * one of those will not be published at the release's moment, or no longer
 * exists, the document goes live linking to something a visitor cannot open.
 * That is a note, never a reason to stop the release, so it is a SOFT source:
 * scheduling, Publish now and the drain only ever ask the hard ones.
 *
 * "Will not be live at the moment" is projected, not read off the target's
 * status now: every pending release that publishes or unpublishes the target
 * up to the moment counts, this release included, by the rule the read path
 * and the drain decide with: the winner by {@link resolveReleaseEffect}, and
 * no effect when its author cannot act ({@link winnerAuthorCanAct}). So a
 * target another release publishes first is not reported, one due to come
 * down before the moment is, though it is live today, and one whose winning
 * publish nobody can perform still is.
 *
 * Which links count:
 * - relationship and upload fields, one level deep: the document's own fields
 *   at any nesting, components and dynamic zones included, but not the links
 *   of the documents it links to;
 * - a target in a collection without a draft/published lifecycle is live
 *   whenever it exists; one in the media library, which is no collection, is
 *   never reported;
 * - not links inside rich text: the editor stores those as URLs rather than
 *   references to documents, so there is no document to check.
 *
 * A finding names its target by id, or for a deleted target only the field.
 * Who may be told that is the reader's question, not the release's: the
 * service narrows the findings for each reader ({@link narrowLinkFindings}).
 *
 * @module domains/releases/readiness/unpublished-links
 * @experimental
 */
import {
  documentRefKey,
  type ReleaseMemberRow,
  type ReleaseRow,
} from "../releases-repository";
import {
  resolveReleaseEffect,
  winnerAuthorCanAct,
  type DueMember,
} from "../resolve-release-effect";

import {
  defineReleaseCheckSource,
  type ReleaseCheckContext,
  type ReleaseCheckFinding,
  type ReleaseCheckScope,
  type ReleaseCheckSource,
} from "./check-sources";
import type { ReadinessFinding } from "./evaluate-readiness";

/** The key this source is registered under. */
export const UNPUBLISHED_LINKS_SOURCE_KEY = "core.unpublished-links";

/**
 * What the source reports: a link a reader may be told about, how many a
 * reader may not, and a link in a field the reader may not view.
 *
 * @experimental
 */
export const UNPUBLISHED_LINK_CODES = [
  "UNPUBLISHED_LINK",
  "UNPUBLISHED_LINKS_HIDDEN",
  "UNPUBLISHED_LINK_IN_HIDDEN_FIELD",
] as const;
export type UnpublishedLinkCode = (typeof UNPUBLISHED_LINK_CODES)[number];

/**
 * One document another document links to, through the field at `field` (a
 * path of field names, such as `meta.editor`).
 *
 * @experimental
 */
export interface DocumentLink {
  field: string;
  collection: string;
  entryId: string;
}

/**
 * Why a linked document will not be live at the moment: it is a draft and
 * nothing publishes it by then, a release takes it down by then, or it no
 * longer exists.
 *
 * @experimental
 */
export type UnpublishedLinkCause = "draft" | "comes-down" | "deleted";

/**
 * What the source asks of the content outside the releases domain.
 *
 * @experimental
 */
export interface ReleaseLinkReads {
  /**
   * For each of these documents of one scope, what it links to as it would
   * go live, read as stored. Keyed by entry id; a document that is not there
   * is absent.
   */
  linksOf(
    scope: ReleaseCheckScope,
    entryIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly DocumentLink[]>>;
  /**
   * For each of these documents of one collection that exists, whether it is
   * live now: stored as published, or in a collection without a lifecycle. A
   * document that is not there is absent. `null` for a slug that is not a
   * collection, about whose documents nothing can be said.
   */
  publishedOf(
    collection: string,
    entryIds: readonly string[]
  ): Promise<ReadonlyMap<string, boolean> | null>;
}

/**
 * Ids per read. Each id binds one parameter and SQLite's default limit is
 * 999, the lowest of the supported dialects, so a release's links are asked
 * for in runs of this many rather than in one statement the driver refuses.
 */
const LINK_ID_CHUNK = 400;

/** `items` split into runs of {@link LINK_ID_CHUNK}. */
function chunked<T>(items: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += LINK_ID_CHUNK) {
    runs.push(items.slice(start, start + LINK_ID_CHUNK));
  }
  return runs;
}

/**
 * The instant the release's documents go live, as far as their links are
 * concerned: its scheduled instant while that is still ahead, and otherwise
 * now. A draft or stopped release has no instant it will run at, so its links
 * are judged as if it ran now; a release past its instant runs on the drain's
 * next pass, which is now as well.
 */
export function linkMoment(release: ReleaseRow, now: Date): Date {
  const at = release.scheduledAt;
  if (release.state === "scheduled" && at !== null && at > now) return at;
  return now;
}

/**
 * Whether a linked document is live at `moment`, and why not when it is not.
 *
 * The latest membership due by the moment decides, by the rule the read path
 * and the drain apply, and only when its author can still act (`live` holds
 * the authors who can); otherwise the document stays as it is stored now.
 */
export function linkTargetState(input: {
  published: boolean;
  memberships: readonly DueMember[];
  moment: Date;
  live: ReadonlySet<string>;
}): "live" | Exclude<UnpublishedLinkCause, "deleted"> {
  const decision = resolveReleaseEffect({
    members: [...input.memberships],
    now: input.moment,
  });
  const winner = input.memberships.find(
    member => member.memberId === decision.memberId
  );
  if (
    decision.effect !== "none" &&
    winnerAuthorCanAct(winner?.createdBy, input.live)
  ) {
    return decision.effect === "publish" ? "live" : "comes-down";
  }
  return input.published ? "live" : "draft";
}

/** A target as one key: its collection and id. */
function targetKey(collection: string, entryId: string): string {
  return `${encodeURIComponent(collection)}:${encodeURIComponent(entryId)}`;
}

/** Members grouped by the scope their documents live in. */
function byScope(
  members: readonly ReleaseMemberRow[]
): Map<string, ReleaseMemberRow[]> {
  const groups = new Map<string, ReleaseMemberRow[]>();
  for (const member of members) {
    const key = `${member.scopeKind}:${member.scopeSlug}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  return groups;
}

/**
 * What each member going live links to, read a scope and a run at a time.
 *
 * A collection whose translations lack their per-language status cannot be
 * read at all, and `core.companion-status` already reports each of its
 * documents as a hard problem; its links are not asked for, so that one
 * broken collection does not make the whole readiness read fail.
 */
async function linksOfMembers(
  reads: ReleaseLinkReads,
  ctx: ReleaseCheckContext,
  members: readonly ReleaseMemberRow[]
): Promise<Map<string, readonly DocumentLink[]>> {
  const found = new Map<string, readonly DocumentLink[]>();
  for (const group of byScope(members).values()) {
    if (await ctx.reads.companionLacksLifecycle(group[0])) continue;
    for (const run of chunked(group)) {
      const links = await reads.linksOf(
        run[0],
        run.map(member => member.entryId)
      );
      for (const member of run) {
        found.set(member.id, links.get(member.entryId) ?? []);
      }
    }
  }
  return found;
}

/**
 * The memberships deciding each target by the moment, keyed by
 * {@link targetKey}: every scheduled release's, and `own`, this release's
 * members the scheduled read cannot report, as due at the moment.
 */
async function membershipsOf(
  ctx: ReleaseCheckContext,
  own: readonly ReleaseMemberRow[],
  targets: ReadonlyArray<{ collection: string; entryId: string }>,
  moment: Date
): Promise<Map<string, DueMember[]>> {
  const decided = new Map<string, DueMember[]>();
  const add = (key: string, member: DueMember): void => {
    const held = decided.get(key) ?? [];
    if (!held.some(other => other.memberId === member.memberId)) {
      held.push(member);
    }
    decided.set(key, held);
  };
  for (const run of chunked(targets)) {
    const refs = run.map(target => ({
      scopeKind: "collection" as const,
      scopeSlug: target.collection,
      entryId: target.entryId,
      locale: null,
    }));
    const scheduled = await ctx.reads.scheduledMemberships(refs);
    for (const [index, ref] of refs.entries()) {
      const key = targetKey(run[index].collection, run[index].entryId);
      for (const member of scheduled.get(documentRefKey(ref)) ?? []) {
        add(key, member);
      }
    }
  }
  for (const member of own) {
    if (member.scopeKind !== "collection" || member.locale !== null) continue;
    add(targetKey(member.scopeSlug, member.entryId), {
      memberId: member.id,
      releaseId: member.releaseId,
      action: member.action,
      scheduledAt: moment,
      createdAt: member.createdAt,
      createdBy: member.createdBy,
    });
  }
  return decided;
}

/**
 * The authors among `memberships`' winners who can still act, asked once for
 * them all, in runs the parameter limit admits.
 */
async function liveWinnerAuthors(
  ctx: ReleaseCheckContext,
  memberships: ReadonlyMap<string, readonly DueMember[]>,
  moment: Date
): Promise<ReadonlySet<string>> {
  const authors = new Set<string>();
  for (const members of memberships.values()) {
    const decision = resolveReleaseEffect({
      members: [...members],
      now: moment,
    });
    const author = members.find(
      m => m.memberId === decision.memberId
    )?.createdBy;
    if (typeof author === "string" && author !== "") authors.add(author);
  }
  const live = new Set<string>();
  for (const run of chunked([...authors])) {
    for (const id of await ctx.reads.liveAuthors(run)) live.add(id);
  }
  return live;
}

/**
 * Whether each target is live now, keyed by target: absent for one that no
 * longer exists, and every target of a slug that is not a collection left out
 * of `judged`, since nothing can be said of it.
 */
async function publishedNow(
  reads: ReleaseLinkReads,
  targets: ReadonlyArray<{ collection: string; entryId: string }>
): Promise<{ published: Map<string, boolean>; judged: Set<string> }> {
  const byCollection = new Map<string, string[]>();
  for (const target of targets) {
    byCollection.set(target.collection, [
      ...(byCollection.get(target.collection) ?? []),
      target.entryId,
    ]);
  }
  const published = new Map<string, boolean>();
  const judged = new Set<string>();
  for (const [collection, ids] of byCollection) {
    for (const run of chunked(ids)) {
      const answer = await reads.publishedOf(collection, run);
      if (answer === null) continue;
      judged.add(collection);
      for (const [id, isPublished] of answer) {
        published.set(targetKey(collection, id), isPublished);
      }
    }
  }
  return { published, judged };
}

/**
 * The source, reading content through `deps.reads` and this release's
 * members through `deps.membersOf`.
 *
 * Every read is batched: links once per scope, and statuses, memberships and
 * authors once per run of targets, so a release of two hundred documents
 * costs a handful of queries, not one per link.
 *
 * @experimental
 */
export function unpublishedLinksSource(deps: {
  reads: ReleaseLinkReads;
  membersOf(releaseId: string): Promise<readonly ReleaseMemberRow[]>;
}): ReleaseCheckSource<UnpublishedLinkCode> {
  return defineReleaseCheckSource({
    key: UNPUBLISHED_LINKS_SOURCE_KEY,
    severity: "soft",
    codes: UNPUBLISHED_LINK_CODES,
    async check(batch, ctx) {
      // A document coming down is never offered its links: what it pointed at
      // stops mattering once it is not live itself.
      const going = batch.filter(member => member.action === "publish");
      if (going.length === 0) return [];
      const links = await linksOfMembers(deps.reads, ctx, going);
      const targets = uniqueTargets([...links.values()].flat());
      if (targets.length === 0) return [];

      const moment = linkMoment(ctx.release, ctx.now);
      const { published, judged } = await publishedNow(deps.reads, targets);
      // This release's own members decide its targets as much as any other
      // release's: a linked document going live in the same release is live.
      // A scheduled release's stored members are among the scheduled ones
      // already; the batch is added either way, since a member being added is
      // not stored yet.
      const own =
        ctx.release.state === "scheduled"
          ? batch
          : [...(await deps.membersOf(ctx.release.id)), ...batch];
      const memberships = await membershipsOf(ctx, own, targets, moment);
      const live = await liveWinnerAuthors(ctx, memberships, moment);

      return going.flatMap(member =>
        findingsFor(member, links.get(member.id) ?? [], link => {
          if (!judged.has(link.collection)) return "live";
          const key = targetKey(link.collection, link.entryId);
          const isPublished = published.get(key);
          if (isPublished === undefined) return "deleted";
          return linkTargetState({
            published: isPublished,
            memberships: memberships.get(key) ?? [],
            moment,
            live,
          });
        })
      );
    },
  });
}

/** Each target once, in the order first met. */
function uniqueTargets(
  links: readonly DocumentLink[]
): Array<{ collection: string; entryId: string }> {
  return byTarget(links).map(({ link }) => ({
    collection: link.collection,
    entryId: link.entryId,
  }));
}

/**
 * This member's findings: one per target that will not be live, naming every
 * field that links to it, in the order the targets are first met; then one
 * per field holding links to deleted documents, with how many, naming no
 * target, since a deleted document has nothing left to name it by.
 */
function findingsFor(
  member: ReleaseMemberRow,
  links: readonly DocumentLink[],
  stateOf: (link: DocumentLink) => "live" | UnpublishedLinkCause
): ReleaseCheckFinding<UnpublishedLinkCode>[] {
  const findings: ReleaseCheckFinding<UnpublishedLinkCode>[] = [];
  const deleted = new Map<string, number>();
  for (const { link, fields } of byTarget(links)) {
    const state = stateOf(link);
    if (state === "live") continue;
    if (state === "deleted") {
      for (const field of fields) {
        deleted.set(field, (deleted.get(field) ?? 0) + 1);
      }
      continue;
    }
    findings.push({
      memberId: member.id,
      code: "UNPUBLISHED_LINK",
      detail: {
        scopeKind: "collection",
        scopeSlug: link.collection,
        entryId: link.entryId,
        fields,
        cause: state,
      },
    });
  }
  for (const [field, count] of deleted) {
    findings.push({
      memberId: member.id,
      code: "UNPUBLISHED_LINK",
      detail: { fields: [field], cause: "deleted", count: String(count) },
    });
  }
  return findings;
}

/**
 * Each target once, in the order first met, with every field that links to
 * it, each field once.
 */
function byTarget(
  links: readonly DocumentLink[]
): Array<{ link: DocumentLink; fields: string[] }> {
  const targets = new Map<string, { link: DocumentLink; fields: string[] }>();
  for (const link of links) {
    const key = targetKey(link.collection, link.entryId);
    const held = targets.get(key);
    if (held === undefined) targets.set(key, { link, fields: [link.field] });
    else if (!held.fields.includes(link.field)) held.fields.push(link.field);
  }
  return [...targets.values()];
}

/**
 * The document a link finding names, or `null` for a finding that names none:
 * any other finding, and a link to a deleted document.
 *
 * @experimental
 */
export function linkTargetOf(
  finding: ReadinessFinding
): { collection: string; entryId: string } | null {
  if (!isLinkFinding(finding)) return null;
  const collection = finding.detail?.scopeSlug;
  const entryId = finding.detail?.entryId;
  if (typeof collection !== "string" || typeof entryId !== "string") {
    return null;
  }
  return { collection, entryId };
}

/** Whether a finding is one of this source's link findings. */
function isLinkFinding(finding: ReadinessFinding): boolean {
  return (
    finding.source === UNPUBLISHED_LINKS_SOURCE_KEY &&
    finding.code === "UNPUBLISHED_LINK"
  );
}

/**
 * What a reader may be told, as {@link narrowLinkFindings} asks it.
 *
 * @experimental
 */
export interface LinkReaderVerdicts {
  /** Whether the reader may read the document the link is FROM. */
  sourceReadable(finding: ReadinessFinding): boolean;
  /**
   * The field paths of that document's links the reader is shown, or `null`
   * when every field is.
   */
  visibleFields(finding: ReadinessFinding): ReadonlySet<string> | null;
  /** Whether the reader may read the document the link is TO. */
  targetReadable(target: { collection: string; entryId: string }): boolean;
}

/**
 * `findings` as a reader may be told them:
 * - a link from a document the reader may not read, or to one they may not
 *   read, is counted in one `UNPUBLISHED_LINKS_HIDDEN` per member in its
 *   place, naming nothing;
 * - a link in a field the reader may not view is replaced by an
 *   `UNPUBLISHED_LINK_IN_HIDDEN_FIELD` naming neither the field nor the target,
 *   so it still counts;
 * - a link to a deleted document names no target, so only its field is
 *   judged;
 * - the fields a kept finding names are those the reader is shown.
 *
 * Every other finding passes through untouched, in its order.
 *
 * @experimental
 */
export function narrowLinkFindings(
  findings: readonly ReadinessFinding[],
  verdicts: LinkReaderVerdicts
): ReadinessFinding[] {
  const shown: ReadinessFinding[] = [];
  let hidden: { finding: ReadinessFinding; count: number } | null = null;
  const flush = (): void => {
    if (hidden === null) return;
    shown.push(
      bare(hidden.finding, "UNPUBLISHED_LINKS_HIDDEN", {
        count: String(hidden.count),
      })
    );
    hidden = null;
  };
  for (const finding of findings) {
    // A member's link findings are contiguous, so its count is placed where
    // its links were, before the next member's findings.
    if (hidden !== null && hidden.finding.memberId !== finding.memberId) {
      flush();
    }
    const judged = isLinkFinding(finding)
      ? judgedForReader(finding, verdicts)
      : finding;
    if (judged === null) {
      hidden =
        hidden === null
          ? { finding, count: 1 }
          : { finding: hidden.finding, count: hidden.count + 1 };
      continue;
    }
    shown.push(judged);
  }
  flush();
  return shown;
}

/**
 * One link finding as the reader may see it, or `null` when it is only to be
 * counted.
 */
function judgedForReader(
  finding: ReadinessFinding,
  verdicts: LinkReaderVerdicts
): ReadinessFinding | null {
  if (!verdicts.sourceReadable(finding)) return null;
  const fields = finding.detail?.fields;
  const named = Array.isArray(fields) ? fields : [];
  const visible = verdicts.visibleFields(finding);
  const shownFields =
    visible === null ? named : named.filter(field => visible.has(field));
  if (shownFields.length === 0) {
    return bare(finding, "UNPUBLISHED_LINK_IN_HIDDEN_FIELD", undefined);
  }
  const target = linkTargetOf(finding);
  if (target !== null && !verdicts.targetReadable(target)) return null;
  return { ...finding, detail: { ...finding.detail, fields: shownFields } };
}

/** A finding about the same member, with only `code` and `detail` of its own. */
function bare(
  finding: ReadinessFinding,
  code: UnpublishedLinkCode,
  detail: ReadinessFinding["detail"]
): ReadinessFinding {
  return {
    memberId: finding.memberId,
    code,
    ...(detail === undefined ? {} : { detail }),
    source: finding.source,
    action: finding.action,
    scopeKind: finding.scopeKind,
    scopeSlug: finding.scopeSlug,
    entryId: finding.entryId,
  };
}

/**
 * One linked document that will not be live when the document it is linked
 * from goes live, as the response to an add names it.
 *
 * @experimental
 */
export interface UnpublishedLink {
  scopeKind: "collection";
  scopeSlug: string;
  entryId: string;
  /** Every field of the added document that links to it. */
  fields: string[];
  cause: Exclude<UnpublishedLinkCause, "deleted">;
}

/**
 * The links an added document has that will not be live at its release's
 * moment, as the caller may be told them.
 *
 * @experimental
 */
export interface UnpublishedLinksReport {
  /** The linked documents the caller may read. */
  links: UnpublishedLink[];
  /** Links to, or from, documents the caller may not read. */
  hiddenCount: number;
  /** Links in fields the caller may not view. */
  inHiddenFields: number;
  /** Fields linking to documents that no longer exist, and how many each. */
  deletedLinks: Array<{ field: string; count: number }>;
}

/**
 * The report for one member, derived from its narrowed findings, so an add
 * answers exactly what the release's readiness would say of the document.
 *
 * @experimental
 */
export function unpublishedLinksReport(
  findings: readonly ReadinessFinding[]
): UnpublishedLinksReport {
  const report: UnpublishedLinksReport = {
    links: [],
    hiddenCount: 0,
    inHiddenFields: 0,
    deletedLinks: [],
  };
  for (const finding of findings) {
    if (finding.source === UNPUBLISHED_LINKS_SOURCE_KEY) {
      addToReport(report, finding);
    }
  }
  return report;
}

/** One of this source's findings, added to the report it belongs in. */
function addToReport(
  report: UnpublishedLinksReport,
  finding: ReadinessFinding
): void {
  const detail = finding.detail ?? {};
  if (finding.code === "UNPUBLISHED_LINKS_HIDDEN") {
    report.hiddenCount += countOf(detail);
  } else if (finding.code === "UNPUBLISHED_LINK_IN_HIDDEN_FIELD") {
    report.inHiddenFields += 1;
  } else if (detail.cause === "deleted") {
    const count = countOf(detail);
    report.deletedLinks.push(
      ...fieldsOf(detail).map(field => ({ field, count }))
    );
  } else {
    const link = namedLink(finding);
    if (link !== null) report.links.push(link);
  }
}

type FindingDetail = NonNullable<ReadinessFinding["detail"]>;

/** A finding's `count`, as a number. */
function countOf(detail: FindingDetail): number {
  return Number(detail.count ?? 0);
}

/** The fields a finding names. */
function fieldsOf(detail: FindingDetail): string[] {
  return Array.isArray(detail.fields) ? [...detail.fields] : [];
}

/** A link finding as the linked document it names, or `null`. */
function namedLink(finding: ReadinessFinding): UnpublishedLink | null {
  const target = linkTargetOf(finding);
  if (target === null) return null;
  const detail = finding.detail ?? {};
  return {
    scopeKind: "collection",
    scopeSlug: target.collection,
    entryId: target.entryId,
    fields: fieldsOf(detail),
    cause: detail.cause === "comes-down" ? "comes-down" : "draft",
  };
}
