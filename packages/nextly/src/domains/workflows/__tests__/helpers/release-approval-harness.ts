/**
 * The install the release approval tests run against, and the releases, approvals and reads they
 * arrange.
 *
 * Pages (one part) and Posts (translated, with a shared field) on `editorial`, and the Single
 * Banner on it too, in English and Spanish. Each table carries this harness's own prefix, so files
 * sharing these slugs never share a table. A release's parts are judged by the publish gate's own
 * per-part decision, the one a publish meets.
 *
 * Releases are arranged through the repository, as the releases suites arrange them, so an
 * instant already past can be set and a member added whatever the checks would say of it.
 */
import { grantTo } from "../../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../../config";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { NOTICES_TABLE } from "../../../../schemas/notices/table-name";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionRegistryService } from "../../../collections/services/collection-registry-service";
import {
  seedLiveAuthor,
  seedPlainAuthor,
} from "../../../releases/__tests__/helpers/live-author";
import {
  ANY_EDITABLE_STATE,
  scheduleAsItStands,
} from "../../../releases/__tests__/helpers/release-writes";
import { ReleasesRepository } from "../../../releases/releases-repository";
import type { SingleEntryService } from "../../../singles/services/single-entry-service";
import type { SingleRegistryService } from "../../../singles/services/single-registry-service";
import type { VersionsDbApi } from "../../../versions/db-api";
import { VersionsRepository } from "../../../versions/versions-repository";
import { approvalDigest } from "../../approval-digest";
import { workflowDefinitionHash } from "../../hash";
import type { ReviewPart } from "../../review-state-repository";
import { takeWorkflowStep, type WorkflowCaller } from "../../steps";
import type { Workflow } from "../../types";

import {
  AT,
  partOf,
  person,
  publishedPastReview,
  seedState,
  stateOf,
  versionOf,
} from "./step-harness";
import { editorial } from "./step-workflows";

/** The definition hash of `editorial`, which every seeded review state is written under. */
export const HASH = workflowDefinitionHash(editorial);

/** An instant long past: a release scheduled for it is due. */
export const PAST = new Date("2020-01-01T00:00:00Z");

/** An instant far ahead: a release scheduled for it waits for its moment. */
export const LATER = new Date("2099-01-01T00:00:00Z");

/** Every operation a Single has, open to all. A Single has no `delete`. */
const SINGLE_OPEN = {
  read: () => true,
  update: () => true,
  publish: () => true,
  unpublish: () => true,
};
const OPEN = { ...SINGLE_OPEN, delete: () => true };
const drafts = { status: true, versions: { drafts: true } } as const;

/**
 * Boots the install. `workflow` is what Pages, Posts and Banner are attached to: `editorial` when
 * left out, none when null. `adapter` boots again on an earlier boot's database, as a deploy does.
 */
export async function bootApprovals(
  dialect: TestDialect,
  options: {
    workflow?: Workflow | null;
    adapter?: TestNextly["adapter"];
    seedPublic?: boolean;
    /** Drafts kept by part, the site's per-language storage; off, the site default, otherwise. */
    perLanguageStorage?: boolean;
    /**
     * The prefix of the tables this boot's collections and Single own, one per suite so no two
     * suites name the same table: short, since the schema derives longer names from it.
     */
    tablePrefix?: string;
  } = {}
): Promise<TestNextly> {
  const prefix = options.tablePrefix ?? "rap_";
  const attached =
    options.workflow === null
      ? {}
      : { workflow: options.workflow ?? editorial };
  const t = await createTestNextly({
    ...(options.adapter ? { adapter: options.adapter } : { dialect }),
    // A visitor's read is judged by the Public role a real boot makes, which reads everything
    // here by its rule.
    seedPublic: options.seedPublic ?? true,
    perLanguageStorage: options.perLanguageStorage === true,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "pages",
        dbName: `${prefix}pages`,
        ...drafts,
        access: OPEN,
        ...attached,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "posts",
        dbName: `${prefix}posts`,
        localized: true,
        ...drafts,
        access: OPEN,
        ...attached,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        dbName: `${prefix}banner`,
        ...drafts,
        access: SINGLE_OPEN,
        ...attached,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return t;
}

export const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/**
 * A document of `slug`, stored through the ordinary write, trusted: one created published says it
 * is published without review, as set-up code may.
 */
export async function doc(
  t: TestNextly,
  slug: "pages" | "posts",
  status: "draft" | "published" = "draft"
): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: slug, overrideAccess: true },
    publishedPastReview({ title: "Hello", status })
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error(`no id from create on ${slug}`);
  return id;
}

/** The person who signs documents off, created once per boot. */
const signers = new WeakSet<TestNextly>();
const BOB: WorkflowCaller = { kind: "user", userId: "bob" };

async function signer(t: TestNextly): Promise<WorkflowCaller> {
  if (!signers.has(t)) {
    await person(t, "bob", [
      ["sign-off", "pages"],
      ["sign-off", "posts"],
    ]);
    signers.add(t);
  }
  return BOB;
}

/** Takes `step` on one part of a collection's document, as a caller that just read it. */
export async function takeStep(
  t: TestNextly,
  slug: string,
  entryId: string,
  part: string | null,
  step: string,
  comment?: string
) {
  const caller = await signer(t);
  const state = await stateOf(t, partOf(slug, entryId, part));
  return takeWorkflowStep(t.adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step,
    parts: [part],
    seen: [
      {
        part,
        revision: state?.revision ?? 0,
        version: await versionOf(t, slug, entryId, part),
      },
    ],
    comment,
    caller,
  });
}

/**
 * Approves one part of a collection's document through the workflow's own steps: sent to legal by
 * alice, cleared by bob.
 */
export async function approve(
  t: TestNextly,
  slug: "pages" | "posts",
  entryId: string,
  part: string | null = null
): Promise<void> {
  await signer(t);
  await seedState(t, partOf(slug, entryId, part), "legal", {
    enteredBy: "alice",
    definitionHash: HASH,
  });
  await takeStep(t, slug, entryId, part, "clear");
  if ((await stateOf(t, partOf(slug, entryId, part)))?.approval == null) {
    throw new Error(`${slug} ${entryId} ${String(part)} not approved`);
  }
}

/** The Banner's table, from the registry. */
async function bannerTable(t: TestNextly): Promise<string> {
  const record = await (
    t.getService("singleRegistryService") as SingleRegistryService
  ).getSingleBySlug("banner");
  if (!record) throw new Error("no banner in the registry");
  return record.tableName;
}

/** Saves the Banner's title through the ordinary write, trusted, and answers its row's id. */
export async function saveBanner(
  t: TestNextly,
  title: string
): Promise<string> {
  await t.nextly.updateSingle({
    slug: "banner" as never,
    data: { title, _overwrite: true } as never,
  });
  const row = await t.adapter.selectOne<{ id: string }>(
    await bannerTable(t),
    {}
  );
  if (!row) throw new Error("no banner row");
  return String(row.id);
}

/** The Banner's shared part. */
export const bannerPart = (entryId: string): ReviewPart => ({
  scopeKind: "single",
  scopeSlug: "banner",
  entryId,
  part: null,
});

/**
 * Gives the Banner an approval of what it shows now: its newest recorded version, digested as an
 * approval is. A Single's steps are not offered, so its review state is written directly.
 */
export async function approveBanner(
  t: TestNextly,
  entryId: string
): Promise<void> {
  const ref = { scopeKind: "single" as const, scopeSlug: "banner", entryId };
  const repo = new VersionsRepository(t.adapter as unknown as VersionsDbApi);
  const newest = Math.max(
    ...(await repo.newestVersionNoByLocale(ref, [null, "en", "es"])).values()
  );
  const shown = await repo.findByVersionNo(ref, newest);
  if (!shown) throw new Error("the banner has no recorded version");
  await seedState(t, bannerPart(entryId), "cleared", {
    enteredBy: "alice",
    definitionHash: HASH,
    approval: {
      versionNo: newest,
      digest: approvalDigest(
        shown.snapshot,
        "single",
        editorial.onEdit.exemptFields
      ),
      by: "bob",
      at: AT,
    },
  });
}

/**
 * Records a version of the Banner newer than any it has, in `locale`, with `title` over the
 * newest one's snapshot: the history a language keeps after the site stops offering it, which
 * no save made now could write.
 */
export async function recordBannerVersionIn(
  t: TestNextly,
  entryId: string,
  locale: string,
  title: string
): Promise<void> {
  const ref = { scopeKind: "single" as const, scopeSlug: "banner", entryId };
  const repo = new VersionsRepository(t.adapter as unknown as VersionsDbApi);
  const newest = await repo.getMaxVersionNo(ref);
  const shown = await repo.findByVersionNo(ref, newest);
  if (!shown) throw new Error("the banner has no recorded version");
  await repo.insertVersion({
    ref,
    versionNo: newest + 1,
    status: shown.status,
    isAutosave: false,
    snapshot: { ...(shown.snapshot as Record<string, unknown>), title },
    locale,
  });
}

/** A member a release is arranged with. */
export interface Member {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  action: "publish" | "unpublish";
}

/** A release, the person told when it stops, and the person who added its documents. */
export interface Arranged {
  releaseId: string;
  owner: string;
  author: string;
}

/**
 * Gives a plain author what a release's run meets on the documents here: read, update, publish
 * and unpublish on each.
 */
async function mayRelease(t: TestNextly, author: string): Promise<void> {
  for (const action of ["read", "update", "publish", "unpublish"]) {
    await grantTo(t, author, action, ["pages", "posts", "banner"]);
  }
}

/**
 * A release owned by a person of its own, holding `members` each added by a plain author who may
 * write them, and scheduled for `at`; left a draft when `at` is null.
 */
export async function arrange(
  t: TestNextly,
  members: readonly Member[],
  at: Date | null,
  people: Partial<Pick<Arranged, "owner" | "author">> = {}
): Promise<Arranged> {
  const owner = people.owner ?? (await seedLiveAuthor(t));
  let author = people.author;
  if (author === undefined) {
    author = await seedPlainAuthor(t);
    await mayRelease(t, author);
  }
  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({
    title: "Launch",
    createdBy: owner,
  });
  for (const member of members) {
    await repo.addMember(
      { releaseId: release.id, locale: null, createdBy: author, ...member },
      ANY_EDITABLE_STATE
    );
  }
  if (at !== null) await scheduleAsItStands(repo, release.id, at, "UTC");
  return { releaseId: release.id, owner, author };
}

/** A publish member of a page. */
export const publishPage = (entryId: string): Member => ({
  scopeKind: "collection",
  scopeSlug: "pages",
  entryId,
  action: "publish",
});

/** The release's state, or "missing". */
export async function releaseState(
  t: TestNextly,
  releaseId: string
): Promise<string> {
  const [row] = await new ReleasesRepository(t.adapter).findReleases({
    ids: [releaseId],
  });
  return row?.state ?? "missing";
}

/** The stopped notices this release's owner has been given. */
export async function stoppedNotices(
  t: TestNextly,
  arranged: Pick<Arranged, "releaseId" | "owner">
): Promise<number> {
  const rows = await t.adapter.select<{ id: string }>(NOTICES_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "kind", op: "=", value: "releases.stopped" },
        { column: "subjectId", op: "=", value: arranged.releaseId },
        { column: "userId", op: "=", value: arranged.owner },
      ],
    },
  });
  return rows.length;
}

/** The ids of pages an anonymous visitor's ordinary list read returns. */
export async function visiblePages(t: TestNextly): Promise<string[]> {
  const result = await handlerOf(t).listEntries({
    collectionName: "pages",
    limit: 50,
  });
  const docs = (result.data?.docs ?? []) as { id: string }[];
  return docs.map(row => row.id);
}

/** The Banner's title as an anonymous visitor reads it, or null when they cannot read it. */
export async function visibleBannerTitle(t: TestNextly): Promise<unknown> {
  const singles = t.getService("singleEntryService") as SingleEntryService;
  const result = await singles.get("banner", { overrideAccess: false });
  if (result.success !== true) return null;
  return (result.data as { title?: unknown } | undefined)?.title ?? null;
}

/** A page's stored status, as its own row holds it. */
export async function storedPageStatus(
  t: TestNextly,
  entryId: string
): Promise<unknown> {
  const record = await (
    t.getService("collectionRegistryService") as CollectionRegistryService
  ).getCollectionBySlug("pages");
  if (!record) throw new Error("no pages in the registry");
  const row = await t.adapter.selectOne<{ status?: unknown }>(
    record.tableName,
    {
      columns: ["status"],
      where: { and: [{ column: "id", op: "=", value: entryId }] },
    }
  );
  return row?.status;
}

/** The codes of the release's hard problems, as its readiness answers them. */
export async function hardCodes(
  t: TestNextly,
  releaseId: string
): Promise<string[]> {
  const readiness = await t.nextly.releases.readiness({ releaseId });
  return readiness.hard.map(finding => finding.code);
}
