/**
 * Telling the people a move names, in the move's own transaction.
 *
 * A step or an assignment says who it names ({@link NamedNotice}): the assignee of a part, or the
 * person accountable for the stage a part left when it was approved or sent back. Each is given a
 * notice in their own list (`workflow-notices`), recorded with the move's transaction, so the
 * notice stands only if the move does. Its occurrence is the part, its review cycle (the review
 * state's row, made afresh when a part enters review again after a discard) and its new revision,
 * so a move recorded twice gives one notice, and the next move on the part another.
 *
 * Nobody is told of their own act (a key's act is its owner's), nor where the person's account is
 * gone: a notice belongs to a person who exists, and writing one for an account that does not
 * would refuse the whole move. Work routed to a role names no one, and so tells no one.
 *
 * The notice's email job is queued beside it only where the site sends email (core's email
 * service is registered and configured) and the trigger's switch in the workflow's settings is not
 * off. The bell's notice is recorded either way.
 *
 * Everything the transaction cannot ask without a second connection is read on the pool first
 * ({@link prepareNoticeTelling}): whether the notices table exists, whether email is sent, the
 * workflows' settings and the collections' names.
 *
 * @module domains/workflows/workflow-notice-recording
 * @experimental Until the notices feature is complete.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { container } from "../../di/container";
import { entryHeadingSource } from "../../lib/entry-heading";
import type { CollectionRegistryService } from "../collections/services/collection-registry-service";
import type { ContentEventActor } from "../content-events/actor";
import type { EmailService } from "../email/services/email-service";
import { appLocalization } from "../i18n/configured-locales";
import { enqueueNoticeEmail } from "../notices/notice-email";
import { registeredNoticeKind, type NoticeKind } from "../notices/notice-kinds";
import type { NoticesService } from "../notices/notices-service";
import { VersionsRepository } from "../versions/versions-repository";

import {
  readReviewStateId,
  type ReviewDocument,
} from "./review-state-repository";
import {
  documentSubjectId,
  WORKFLOW_APPROVED_NOTICE,
  WORKFLOW_ASSIGNED_NOTICE,
  WORKFLOW_CHANGES_REQUESTED_NOTICE,
  WORKFLOW_NOTICE_EMAIL_JOB,
  WORKFLOW_NOTICE_KINDS,
  type WorkflowNoticeData,
} from "./workflow-notices";
import {
  readWorkflowSettings,
  type WorkflowSettings,
} from "./workflow-settings-repository";

/** What a notice reports, named as the workflow settings' email switches name it. */
type WorkflowNoticeTrigger = keyof NonNullable<WorkflowSettings["emails"]>;

const KIND_OF: Record<WorkflowNoticeTrigger, NoticeKind<WorkflowNoticeData>> = {
  assigned: WORKFLOW_ASSIGNED_NOTICE,
  approved: WORKFLOW_APPROVED_NOTICE,
  changesRequested: WORKFLOW_CHANGES_REQUESTED_NOTICE,
};

/** One person a move names, and what it tells them. */
export interface NamedNotice {
  trigger: WorkflowNoticeTrigger;
  /** The person told. */
  userId: string;
  document: ReviewDocument;
  /** The workflow's slug, whose settings decide the email. */
  workflow: string;
  part: string | null;
  /** The part's review-state revision after the move: with the part, the notice's occurrence. */
  revision: number;
  /** The step's label: the one taken, or for an assignment the work it asks for. */
  step: string | null;
  /**
   * The content the notice names, as a version's snapshot, where the move read one already;
   * absent, it is read on the transaction.
   */
  snapshot?: unknown;
  /** The step's comment, kept by a request for changes alone. */
  comment?: string;
}

/** How one collection is named: its singular label, its title field, and whether it translates. */
interface CollectionNaming {
  label: string;
  titleField: string | undefined;
  localized: boolean;
}

/** What telling reads on the pool before the move's transaction opens. */
export interface NoticeTelling {
  service: NoticesService;
  dialect: string;
  /** Whom the act counts as: nobody is told of their own. Null for trusted code. */
  accountable: string | null;
  /** Who acted, as a notice names them. */
  actor: string | null;
  /** Whether the site sends email at all. */
  sendsEmail: boolean;
  /** Each workflow's email switches, by its slug. */
  emails: ReadonlyMap<string, WorkflowSettings["emails"]>;
  /** Each collection's naming, by its slug. */
  collections: ReadonlyMap<string, CollectionNaming>;
}

/** What a document's title reads as where it has none. */
const UNTITLED = "Untitled";

/** The notices service, where the notices table exists and every workflow kind is registered. */
async function readyNotices(): Promise<NoticesService | null> {
  if (!container.has("noticesService")) return null;
  // A kind not registered could not be written, and the move must not fail for it.
  if (
    WORKFLOW_NOTICE_KINDS.some(kind => registeredNoticeKind(kind.key) !== kind)
  ) {
    return null;
  }
  const service = container.get<NoticesService>("noticesService");
  return (await service.ready()) ? service : null;
}

/** Whether the site sends email: core's service registered, and a provider set up. */
async function sendsEmail(): Promise<boolean> {
  if (!container.has("emailService")) return false;
  return container.get<EmailService>("emailService").isConfigured();
}

/** Who acted, as a notice names them: a person by name, a key as a key, trusted code by none. */
function actorName(event: ContentEventActor): string | null {
  if (event.kind === "person") return event.name;
  return event.kind === "apiKey" ? "An API key" : null;
}

/** Each workflow's email switches, read once each. */
async function emailSwitches(
  adapter: DrizzleAdapter,
  workflows: readonly string[]
): Promise<Map<string, WorkflowSettings["emails"]>> {
  const switches = new Map<string, WorkflowSettings["emails"]>();
  for (const workflow of new Set(workflows)) {
    const stored = await readWorkflowSettings(adapter, workflow);
    switches.set(workflow, stored?.settings.emails);
  }
  return switches;
}

/** Each collection's naming, read once each from the registry. */
async function collectionNamings(
  slugs: readonly string[]
): Promise<Map<string, CollectionNaming>> {
  const namings = new Map<string, CollectionNaming>();
  if (!container.has("collectionRegistryService")) return namings;
  const registry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  for (const slug of new Set(slugs)) {
    const record = await registry.getCollectionBySlug(slug);
    if (!record) continue;
    namings.set(slug, {
      label: record.labels?.singular || slug,
      titleField: record.admin?.useAsTitle,
      localized: Boolean(record.localized),
    });
  }
  return namings;
}

/**
 * What telling the people of a move needs from the pool, read before its transaction opens; null
 * where no one can be told (the notices table not migrated yet, or no notices service).
 *
 * @param documents the workflow and collection of each document the move may tell anyone about
 * @param caller whom the act counts as, and how its record names the actor
 */
export async function prepareNoticeTelling(
  adapter: DrizzleAdapter,
  documents: ReadonlyArray<{ workflow: string; slug: string }>,
  caller: { accountable: string | null; event: ContentEventActor }
): Promise<NoticeTelling | null> {
  const service = await readyNotices();
  if (service === null) return null;
  return {
    service,
    dialect: adapter.getCapabilities().dialect,
    accountable: caller.accountable,
    actor: actorName(caller.event),
    sendsEmail: await sendsEmail(),
    emails: await emailSwitches(
      adapter,
      documents.map(document => document.workflow)
    ),
    collections: await collectionNamings(
      documents.map(document => document.slug)
    ),
  };
}

/** Whether a notice's email is queued: the site sends email, and its trigger's switch is not off. */
function emailsFor(telling: NoticeTelling, notice: NamedNotice): boolean {
  return (
    telling.sendsEmail &&
    telling.emails.get(notice.workflow)?.[notice.trigger] !== false
  );
}

/** The people among `ids` whose accounts exist, in one read on the transaction. */
async function existingPeople(
  tx: TransactionContext,
  ids: readonly string[]
): Promise<Set<string>> {
  const rows = await tx.select<{ id: string }>("users", {
    columns: ["id"],
    where: { and: [{ column: "id", op: "IN", value: [...new Set(ids)] }] },
  });
  return new Set(rows.map(row => row.id));
}

/**
 * The newest recorded version's snapshot of a part, for its title, read on the transaction without
 * locking: a language's own, and for the shared part, that of a document with no languages or
 * else of its default language. Undefined for a part never saved.
 */
async function snapshotOn(
  tx: TransactionContext,
  document: ReviewDocument,
  part: string | null
): Promise<unknown> {
  const repo = new VersionsRepository(tx);
  const locales =
    part !== null ? [part] : [null, appLocalization()?.defaultLocale ?? null];
  const newest = Math.max(
    0,
    ...(await repo.newestVersionNoByLocale(document, locales)).values()
  );
  if (newest === 0) return undefined;
  return (await repo.findByVersionNo(document, newest))?.snapshot;
}

/** A collection's naming, or its slug alone where the registry no longer names it. */
function namingOf(telling: NoticeTelling, slug: string): CollectionNaming {
  return (
    telling.collections.get(slug) ?? {
      label: slug,
      titleField: undefined,
      localized: false,
    }
  );
}

/**
 * A document's title, from a version's snapshot, as every other surface names it, with the field
 * it came from: each recipient is judged on that field when the notice is shown to them.
 */
function titleOf(
  snapshot: unknown,
  titleField: string | undefined
): { title: string; titleField?: string } {
  const content =
    snapshot !== null && typeof snapshot === "object"
      ? (snapshot as Record<string, unknown>)
      : {};
  const heading = entryHeadingSource(content, titleField);
  return heading === undefined
    ? { title: UNTITLED }
    : { title: heading.text, titleField: heading.field };
}

/** The snapshot a notice keeps of its document and the move. */
async function dataOf(
  tx: TransactionContext,
  telling: NoticeTelling,
  notice: NamedNotice
): Promise<WorkflowNoticeData> {
  const naming = namingOf(telling, notice.document.scopeSlug);
  const snapshot =
    "snapshot" in notice
      ? notice.snapshot
      : await snapshotOn(tx, notice.document, notice.part);
  return {
    collection: naming.label,
    ...titleOf(snapshot, naming.titleField),
    part: notice.part,
    localized: naming.localized,
    step: notice.step,
    actor: telling.actor,
    ...(notice.comment === undefined ? {} : { comment: notice.comment }),
  };
}

/** Records one notice on the transaction, and queues its email beside it where it is sent. */
async function tellOne(
  tx: TransactionContext,
  telling: NoticeTelling,
  notice: NamedNotice
): Promise<void> {
  // The review cycle the move is in: the part's review-state row, made afresh each cycle (a
  // discard removes it, and the next entry into review starts again at revision 1), so its id
  // tells this cycle's moves from an earlier cycle's at the same revision.
  const cycle = await readReviewStateId(tx, {
    ...notice.document,
    part: notice.part,
  });
  const recorded = await telling.service.record(
    {
      kind: KIND_OF[notice.trigger],
      userId: notice.userId,
      subjectId: documentSubjectId(notice.document),
      // The part, its review cycle and its new revision: each part's move is its own occurrence.
      occurrence: JSON.stringify([notice.part, cycle, notice.revision]),
      data: await dataOf(tx, telling, notice),
    },
    tx
  );
  // Only the call that created the notice queues its email, so one notice has one.
  if (!recorded.created || recorded.id === null) return;
  if (!emailsFor(telling, notice)) return;
  await enqueueNoticeEmail(
    tx,
    telling.dialect,
    WORKFLOW_NOTICE_EMAIL_JOB,
    recorded.id,
    new Date()
  );
}

/**
 * Tells each person `notices` names, on the move's transaction: never the person who acted, nor
 * one whose account is gone.
 */
export async function tellNamedPeople(
  tx: TransactionContext,
  telling: NoticeTelling | null,
  notices: readonly NamedNotice[]
): Promise<void> {
  if (telling === null) return;
  const others = notices.filter(
    notice => notice.userId !== telling.accountable
  );
  if (others.length === 0) return;
  const people = await existingPeople(
    tx,
    others.map(notice => notice.userId)
  );
  for (const notice of others) {
    if (people.has(notice.userId)) await tellOne(tx, telling, notice);
  }
}
