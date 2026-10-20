/**
 * Links that will not be live when a document goes live.
 *
 * A document going live in a release may point at other documents through its
 * relationship fields: an author, a category, related posts. When one of those
 * will not be published at the release's moment, the document goes live
 * linking to something a visitor cannot open. That is a note, never a reason
 * to stop the release, so it is a SOFT source: scheduling, Publish now and the
 * drain only ever ask the hard ones.
 *
 * "Will not be live at the moment" is projected, not read off the target's
 * status now: every pending release that publishes or unpublishes the target
 * up to the moment counts, this release included, by the one rule the read
 * path and the drain decide with ({@link resolveReleaseEffect}). So a target
 * another release publishes first is not reported, and one due to come down
 * before the moment is, though it is live today.
 *
 * Which links count:
 * - relationship fields, one level deep: the document's own fields, inside
 *   groups and repeaters too, but not the links of the documents it links to;
 * - only targets in a collection with a draft/published lifecycle, since a
 *   document in a collection without one is live as soon as it exists;
 * - not uploads: an upload points at the media library, which has no
 *   lifecycle, so its target is always live;
 * - not links inside rich text: the editor stores those as URLs rather than
 *   references to documents, so there is no document to check.
 *
 * A finding names its target by id. Who may be told that is the reader's
 * question, not the release's: the service narrows the findings for each
 * reader ({@link narrowLinkFindings}), so a target the reader may not read is
 * only counted.
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
 * What the source reports: a link a reader may be told about, and how many a
 * reader may not.
 *
 * @experimental
 */
export const UNPUBLISHED_LINK_CODES = [
  "UNPUBLISHED_LINK",
  "UNPUBLISHED_LINKS_HIDDEN",
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
 * nothing publishes it by then, or a release takes it down by then.
 *
 * @experimental
 */
export type UnpublishedLinkCause = "draft" | "comes-down";

/**
 * What the source asks of the content outside the releases domain.
 *
 * @experimental
 */
export interface ReleaseLinkReads {
  /**
   * For each of these documents of one scope, what it links to as it would
   * go live: its working draft where it has one, else its stored content.
   * Keyed by entry id; a document that is not there is absent.
   */
  linksOf(
    scope: ReleaseCheckScope,
    entryIds: readonly string[]
  ): Promise<ReadonlyMap<string, readonly DocumentLink[]>>;
  /**
   * For each of these documents of one collection that exists, whether its
   * stored status is published. A document that is not there is absent.
   */
  publishedOf(
    collection: string,
    entryIds: readonly string[]
  ): Promise<ReadonlyMap<string, boolean>>;
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
 * and the drain apply; with none due, the document stays as it is stored now.
 */
export function linkTargetState(input: {
  published: boolean;
  memberships: readonly DueMember[];
  moment: Date;
}): "live" | UnpublishedLinkCause {
  const decision = resolveReleaseEffect({
    members: [...input.memberships],
    now: input.moment,
  });
  if (decision.effect === "publish") return "live";
  if (decision.effect === "unpublish") return "comes-down";
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
    });
  }
  return decided;
}

/** Which of these collections declare a draft/published lifecycle. */
async function withLifecycle(
  ctx: ReleaseCheckContext,
  collections: readonly string[]
): Promise<Set<string>> {
  const declared = new Set<string>();
  for (const collection of collections) {
    const has = await ctx.reads.declaresLifecycle({
      scopeKind: "collection",
      scopeSlug: collection,
    });
    if (has) declared.add(collection);
  }
  return declared;
}

/** Whether each target that exists is published now, keyed by target. */
async function publishedNow(
  reads: ReleaseLinkReads,
  targets: ReadonlyArray<{ collection: string; entryId: string }>
): Promise<Map<string, boolean>> {
  const byCollection = new Map<string, string[]>();
  for (const target of targets) {
    byCollection.set(target.collection, [
      ...(byCollection.get(target.collection) ?? []),
      target.entryId,
    ]);
  }
  const published = new Map<string, boolean>();
  for (const [collection, ids] of byCollection) {
    for (const run of chunked(ids)) {
      for (const [id, isPublished] of await reads.publishedOf(
        collection,
        run
      )) {
        published.set(targetKey(collection, id), isPublished);
      }
    }
  }
  return published;
}

/**
 * The source, reading content through `deps.reads` and this release's
 * members through `deps.membersOf`.
 *
 * Every read is batched: links once per scope, lifecycles once per target
 * collection, statuses and memberships once per run of targets, so a release
 * of two hundred documents costs a handful of queries, not one per link.
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

      const lifecycle = await withLifecycle(ctx, [
        ...new Set([...links.values()].flat().map(link => link.collection)),
      ]);
      const targets = uniqueTargets(
        [...links.values()].flat().filter(l => lifecycle.has(l.collection))
      );
      if (targets.length === 0) return [];

      const moment = linkMoment(ctx.release, ctx.now);
      const published = await publishedNow(deps.reads, targets);
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

      return going.flatMap(member =>
        findingsFor(member, links.get(member.id) ?? [], key => {
          const isPublished = published.get(key);
          // Absent for a target that is not there, which cannot be offered,
          // and for one in a collection without a lifecycle, which is live
          // whenever it exists: neither is reported.
          if (isPublished === undefined) return "live";
          return linkTargetState({
            published: isPublished,
            memberships: memberships.get(key) ?? [],
            moment,
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
  const seen = new Map<string, { collection: string; entryId: string }>();
  for (const link of links) {
    const key = targetKey(link.collection, link.entryId);
    if (!seen.has(key)) {
      seen.set(key, { collection: link.collection, entryId: link.entryId });
    }
  }
  return [...seen.values()];
}

/**
 * One finding per target this member links to that will not be live, naming
 * every field that links to it, in the order the targets are first met.
 */
function findingsFor(
  member: ReleaseMemberRow,
  links: readonly DocumentLink[],
  stateOf: (key: string) => "live" | UnpublishedLinkCause
): ReleaseCheckFinding<UnpublishedLinkCode>[] {
  const fields = new Map<string, string[]>();
  const order: DocumentLink[] = [];
  for (const link of links) {
    const key = targetKey(link.collection, link.entryId);
    const held = fields.get(key);
    if (held === undefined) {
      fields.set(key, [link.field]);
      order.push(link);
    } else if (!held.includes(link.field)) {
      held.push(link.field);
    }
  }
  return order.flatMap(link => {
    const key = targetKey(link.collection, link.entryId);
    const state = stateOf(key);
    if (state === "live") return [];
    return [
      {
        memberId: member.id,
        code: "UNPUBLISHED_LINK" as const,
        detail: {
          scopeKind: "collection",
          scopeSlug: link.collection,
          entryId: link.entryId,
          fields: fields.get(key) ?? [link.field],
          cause: state,
        },
      },
    ];
  });
}

/**
 * The document a link finding names, or `null` for any other finding.
 *
 * @experimental
 */
export function linkTargetOf(
  finding: ReadinessFinding
): { collection: string; entryId: string } | null {
  if (finding.source !== UNPUBLISHED_LINKS_SOURCE_KEY) return null;
  if (finding.code !== "UNPUBLISHED_LINK") return null;
  const collection = finding.detail?.scopeSlug;
  const entryId = finding.detail?.entryId;
  if (typeof collection !== "string" || typeof entryId !== "string") {
    return null;
  }
  return { collection, entryId };
}

/**
 * `findings` as a reader may be told them: a link finding whose target the
 * reader may not read is dropped, and each member's dropped links are counted
 * in one `UNPUBLISHED_LINKS_HIDDEN` finding in their place, naming no target.
 *
 * `readable` holds the targets the reader may read, by `isReadable`. Every
 * other finding passes through untouched, in its order.
 *
 * @experimental
 */
export function narrowLinkFindings(
  findings: readonly ReadinessFinding[],
  isReadable: (target: { collection: string; entryId: string }) => boolean
): ReadinessFinding[] {
  const shown: ReadinessFinding[] = [];
  let hidden: { finding: ReadinessFinding; count: number } | null = null;
  const flush = (): void => {
    if (hidden === null) return;
    const { finding, count } = hidden;
    shown.push({
      memberId: finding.memberId,
      code: "UNPUBLISHED_LINKS_HIDDEN",
      detail: { count: String(count) },
      source: finding.source,
      action: finding.action,
      scopeKind: finding.scopeKind,
      scopeSlug: finding.scopeSlug,
      entryId: finding.entryId,
    });
    hidden = null;
  };
  for (const finding of findings) {
    // A member's link findings are contiguous, so its count is placed where
    // its links were, before the next member's findings.
    if (hidden !== null && hidden.finding.memberId !== finding.memberId) {
      flush();
    }
    const target = linkTargetOf(finding);
    if (target === null || isReadable(target)) {
      shown.push(finding);
      continue;
    }
    hidden =
      hidden === null
        ? { finding, count: 1 }
        : { finding: hidden.finding, count: hidden.count + 1 };
  }
  flush();
  return shown;
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
  cause: UnpublishedLinkCause;
}

/**
 * The links an added document has that will not be live at its release's
 * moment: those the caller may read, and how many more there are that the
 * caller may not.
 *
 * @experimental
 */
export interface UnpublishedLinksReport {
  links: UnpublishedLink[];
  hiddenCount: number;
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
  const links: UnpublishedLink[] = [];
  let hiddenCount = 0;
  for (const finding of findings) {
    if (finding.source !== UNPUBLISHED_LINKS_SOURCE_KEY) continue;
    if (finding.code === "UNPUBLISHED_LINKS_HIDDEN") {
      hiddenCount += Number(finding.detail?.count ?? 0);
      continue;
    }
    const target = linkTargetOf(finding);
    const fields = finding.detail?.fields;
    const cause = finding.detail?.cause;
    if (target === null) continue;
    links.push({
      scopeKind: "collection",
      scopeSlug: target.collection,
      entryId: target.entryId,
      fields: Array.isArray(fields) ? [...fields] : [],
      cause: cause === "comes-down" ? "comes-down" : "draft",
    });
  }
  return { links, hiddenCount };
}
