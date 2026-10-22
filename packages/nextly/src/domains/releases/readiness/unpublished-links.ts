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
  idBatches,
  IDS_PER_LOOKUP,
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
 * path of field names, such as `meta.editor`, for a reader to read).
 *
 * `fieldKey` names the very field the value sits in, within the document it
 * was read from: two fields with the same path, such as `author` in two kinds
 * of block, have different keys. A reader's access to a field is judged by
 * this key, never by the path, so one field cannot answer for another.
 *
 * @experimental
 */
export interface DocumentLink {
  field: string;
  fieldKey: string;
  collection: string;
  entryId: string;
}

/**
 * What one document links to, with the document the links were read from.
 * The document is the reads' own, and is handed back as it is to judge what
 * a reader may see of those links, so both come from one reading of it.
 *
 * @experimental
 */
export interface ScannedLinks {
  links: readonly DocumentLink[];
  snapshot: unknown;
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
  ): Promise<ReadonlyMap<string, ScannedLinks>>;
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
 * `items` split into runs of the repository's lookup size, the number of ids
 * one statement binds within the lowest parameter limit of the supported
 * dialects. For a list of ids themselves, `idBatches`.
 */
function chunked<T>(items: readonly T[]): T[][] {
  const runs: T[][] = [];
  for (let start = 0; start < items.length; start += IDS_PER_LOOKUP) {
    runs.push(items.slice(start, start + IDS_PER_LOOKUP));
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
  members: readonly ReleaseMemberRow[],
  onScanned: (member: ReleaseMemberRow, scanned: ScannedLinks) => void
): Promise<Map<string, readonly DocumentLink[]>> {
  const found = new Map<string, readonly DocumentLink[]>();
  for (const group of byScope(members).values()) {
    if (await ctx.reads.companionLacksLifecycle(group[0])) continue;
    for (const run of chunked(group)) {
      const scanned = await reads.linksOf(
        run[0],
        run.map(member => member.entryId)
      );
      for (const member of run) {
        const read = scanned.get(member.entryId);
        found.set(member.id, read?.links ?? []);
        if (read !== undefined) onScanned(member, read);
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
  for (const run of idBatches([...authors])) {
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
    for (const run of idBatches(ids)) {
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
  /**
   * Told each member's links and the document they were read from, so what
   * a reader may see of them is judged on that same reading.
   */
  onScanned?: (member: ReleaseMemberRow, scanned: ScannedLinks) => void;
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
      const links = await linksOfMembers(
        deps.reads,
        ctx,
        going,
        deps.onScanned ?? (() => undefined)
      );
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
          // Nothing can be said of a target that is no collection, such as
          // the media library: it is not a link this check judges at all.
          if (!judged.has(link.collection)) return null;
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
 * This member's findings: one per target it links to, naming the target and
 * every field that links to it, in the order the targets are first met.
 *
 * A finding is made for a target that IS live too (`cause: "live"`), and for
 * a deleted one with its identity. Neither reaches a reader as such: a live
 * link is dropped and deleted ones are counted per field without a target
 * ({@link narrowLinkFindings}, {@link withoutFieldKeys}). They are made so a
 * reader who may not read a target is told the same about every link to it,
 * whatever its state: one count.
 *
 * Each names its fields twice: `fields`, the paths a reader reads, and
 * `fieldKeys` with `fieldNames`, each field's own key and path side by side,
 * for judging what a reader may see. The keys are taken off before any
 * reader is shown a finding.
 */
function findingsFor(
  member: ReleaseMemberRow,
  links: readonly DocumentLink[],
  stateOf: (link: DocumentLink) => LinkState | null
): ReleaseCheckFinding<UnpublishedLinkCode>[] {
  return byTarget(links).flatMap(({ link, fields }) => {
    const state = stateOf(link);
    if (state === null) return [];
    return [
      {
        memberId: member.id,
        code: "UNPUBLISHED_LINK" as const,
        detail: {
          scopeKind: "collection",
          scopeSlug: link.collection,
          entryId: link.entryId,
          ...fieldsDetail(fields),
          cause: state,
        },
      },
    ];
  });
}

/** What a linked document is at the moment: live, or why it is not. */
type LinkState = "live" | UnpublishedLinkCause;

/** The fields a finding names, as paths and as keys beside their paths. */
function fieldsDetail(fields: readonly DocumentLink[]): {
  fields: string[];
  fieldKeys: string[];
  fieldNames: string[];
} {
  return {
    fields: [...new Set(fields.map(field => field.field))],
    fieldKeys: fields.map(field => field.fieldKey),
    fieldNames: fields.map(field => field.field),
  };
}

/**
 * Each target once, in the order first met, with every field that links to
 * it, each field once.
 */
function byTarget(
  links: readonly DocumentLink[]
): Array<{ link: DocumentLink; fields: DocumentLink[] }> {
  const targets = new Map<
    string,
    { link: DocumentLink; fields: DocumentLink[] }
  >();
  for (const link of links) {
    const key = targetKey(link.collection, link.entryId);
    const held = targets.get(key);
    if (held === undefined) targets.set(key, { link, fields: [link] });
    else if (!held.fields.some(field => field.fieldKey === link.fieldKey)) {
      held.fields.push(link);
    }
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
   * The keys of that document's link fields the reader may view, or `null`
   * when every field is.
   */
  visibleFields(finding: ReadinessFinding): ReadonlySet<string> | null;
  /** Whether the reader may read the document the link is TO. */
  targetReadable(target: { collection: string; entryId: string }): boolean;
}

/** How many links a link finding stands for: a deleted one may stand for several. */
function weightOf(finding: ReadinessFinding): number {
  const count = Number(finding.detail?.count ?? 1);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

/**
 * `findings` as a reader may be told them, each link judged in this order:
 * 1. from a document the reader may not read: counted, or dropped when it is
 *    live (that document's own problems are the members' to count);
 * 2. to a document the reader may not read: counted, whatever it is (live, a
 *    draft, coming down or deleted), so nothing about that document can be
 *    told from the answer, not even whether it exists;
 * 3. live: dropped, as there is nothing to note;
 * 4. in a field the reader may not view: an `UNPUBLISHED_LINK_IN_HIDDEN_FIELD`
 *    naming neither the field nor the target, so it still counts;
 * 5. otherwise shown, naming only the fields the reader may view, each judged
 *    by its own key, never by its path; links to deleted documents are then
 *    shown per field, with how many, naming no target.
 *
 * Counted links are summed in one `UNPUBLISHED_LINKS_HIDDEN` per member, in
 * its links' place. Every other finding passes through untouched, in its
 * order, and no finding leaves with the keys or targets it was judged by.
 *
 * @experimental
 */
export function narrowLinkFindings(
  findings: readonly ReadinessFinding[],
  verdicts: LinkReaderVerdicts
): ReadinessFinding[] {
  const shown: ReadinessFinding[] = [];
  // The member whose links are being counted, and how many so far.
  const held: { finding: ReadinessFinding | null; count: number } = {
    finding: null,
    count: 0,
  };
  const flush = (): void => {
    if (held.finding === null) return;
    shown.push(
      bare(held.finding, "UNPUBLISHED_LINKS_HIDDEN", {
        count: String(held.count),
      })
    );
    held.finding = null;
    held.count = 0;
  };
  for (const finding of findings) {
    // A member's link findings are contiguous, so its count is placed where
    // its links were, before the next member's findings.
    if (held.finding !== null && held.finding.memberId !== finding.memberId) {
      flush();
    }
    const judged = isLinkFinding(finding)
      ? judgedForReader(finding, verdicts)
      : finding;
    if (judged === "counted") {
      held.finding ??= finding;
      held.count += weightOf(finding);
    } else if (judged !== "dropped") {
      shown.push(judged);
    }
  }
  flush();
  return byField(shown);
}

/**
 * `findings` as a reader who may read everything is shown them: live links
 * dropped, deleted ones per field, and no keys.
 *
 * @experimental
 */
export function withoutFieldKeys(
  findings: readonly ReadinessFinding[]
): ReadinessFinding[] {
  return byField(
    findings.flatMap(finding => {
      if (!isLinkFinding(finding)) return [finding];
      if (finding.detail?.cause === "live") return [];
      return [shownAs(finding, null)];
    })
  );
}

/**
 * One link finding as the reader may see it: the finding to show, or
 * whether it is only counted or dropped.
 */
function judgedForReader(
  finding: ReadinessFinding,
  verdicts: LinkReaderVerdicts
): ReadinessFinding | "counted" | "dropped" {
  const live = finding.detail?.cause === "live";
  if (!verdicts.sourceReadable(finding)) return live ? "dropped" : "counted";
  // Before anything is said of what the target is: a document the reader may
  // not read is one count, live or not, there or not.
  const target = linkTargetOf(finding);
  if (target === null || !verdicts.targetReadable(target)) return "counted";
  if (live) return "dropped";
  const shown = shownAs(finding, verdicts.visibleFields(finding));
  if (shown.detail?.fields?.length === 0) {
    return bare(finding, "UNPUBLISHED_LINK_IN_HIDDEN_FIELD", {
      count: String(weightOf(finding)),
    });
  }
  return shown;
}

/**
 * Findings that stand for several links, each gathered into one with how
 * many, in the place of the first: links to deleted documents per member and
 * field, naming no target (a deleted document has nothing left to name it
 * by), a link counted in every field it is linked from; and links in fields
 * the reader may not view, per member.
 */
function byField(findings: readonly ReadinessFinding[]): ReadinessFinding[] {
  const out: ReadinessFinding[] = [];
  const gathered = new Map<string, ReadinessFinding>();
  const gather = (key: string, first: () => ReadinessFinding, add: number) => {
    const held = gathered.get(key);
    if (held !== undefined) {
      held.detail = {
        ...held.detail,
        count: String(weightOf(held) + add),
      };
      return;
    }
    const made = first();
    gathered.set(key, made);
    out.push(made);
  };
  for (const finding of findings) {
    const kind = gatheringOf(finding);
    if (kind === null) {
      out.push(finding);
    } else if (kind === "hidden field") {
      gather(
        JSON.stringify([finding.memberId, kind]),
        () =>
          bare(finding, "UNPUBLISHED_LINK_IN_HIDDEN_FIELD", {
            count: String(weightOf(finding)),
          }),
        weightOf(finding)
      );
    } else {
      for (const field of fieldsNamed(finding)) {
        gather(
          JSON.stringify([finding.memberId, kind, field]),
          () =>
            bare(finding, "UNPUBLISHED_LINK", {
              fields: [field],
              cause: "deleted",
              count: String(weightOf(finding)),
            }),
          weightOf(finding)
        );
      }
    }
  }
  return out;
}

/** Which gathering a finding joins, or `null` for one that stands alone. */
function gatheringOf(
  finding: ReadinessFinding
): "hidden field" | "deleted" | null {
  if (finding.source !== UNPUBLISHED_LINKS_SOURCE_KEY) return null;
  if (finding.code === "UNPUBLISHED_LINK_IN_HIDDEN_FIELD") {
    return "hidden field";
  }
  if (finding.code !== "UNPUBLISHED_LINK") return null;
  return finding.detail?.cause === "deleted" ? "deleted" : null;
}

/** The field paths a link finding names. */
function fieldsNamed(finding: ReadinessFinding): string[] {
  const fields = finding.detail?.fields;
  return Array.isArray(fields) ? [...fields] : [];
}

/**
 * A link finding naming only the fields whose keys are in `visible` (every
 * field when `null`), without the keys.
 */
function shownAs(
  finding: ReadinessFinding,
  visible: ReadonlySet<string> | null
): ReadinessFinding {
  const { fieldKeys, fieldNames, ...rest } = finding.detail ?? {};
  const keys = Array.isArray(fieldKeys) ? fieldKeys : [];
  const names = Array.isArray(fieldNames) ? fieldNames : [];
  const fields = [
    ...new Set(
      keys.flatMap((key, index) =>
        visible === null || visible.has(key) ? [names[index] ?? ""] : []
      )
    ),
  ].filter(name => name !== "");
  return { ...finding, detail: { ...rest, fields } };
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
    report.inHiddenFields += countOf(detail) || 1;
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
