/**
 * The notices a workflow gives the people it names, and the email that copies each.
 *
 * Three kinds, each about a document, given to one person by name:
 *
 * - `workflows.assigned`: a part was assigned to them, by an assignment or as the default reviewer
 *   of the stage a step entered;
 * - `workflows.approved`: a part they were accountable for was approved;
 * - `workflows.changes-requested`: changes were requested on a part they were accountable for
 *   (a kind's key is lowercase, so the settings' `changesRequested` switch is spelled with a hyphen).
 *
 * Each keeps a snapshot of the document as the move saw it (the collection's label, the title, the
 * part, the step and who acted), so it still reads after the document is gone, and links to the
 * document's edit page while it exists. Registered from the notices registration
 * (`register-workflow-notices`); recorded by the steps service in the move's own transaction
 * (`workflow-notice-recording`).
 *
 * The email is the notices domain's one notice email (`domains/notices/notice-email`) under the
 * workflows' own slug, its message made from the notice's own text and its link.
 *
 * @module domains/workflows/workflow-notices
 * @experimental Until the notices feature is complete.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import { runDetachedFromRequest } from "../../auth/caller-scope";
import { container } from "../../di/container";
import { NextlyError } from "../../errors";
import {
  resolveDocumentVisibilityScope,
  visibleDocuments,
} from "../../services/lib/document-visibility";
import { existingDocumentIds } from "../../services/lib/readable-documents";
import { resolveRunAs } from "../../shared/lib/resolve-run-as";
import type { JobDefinition } from "../jobs/job-registry";
import { databaseRunAs } from "../jobs/jobs-runner";
import {
  createNoticeEmailJob,
  noticeEmailMessage,
  type NoticeEmail,
  type NoticeEmailDeps,
  type NoticeEmailJobInput,
  type NoticeEmailMessage,
} from "../notices/notice-email";
import {
  defineNoticeKind,
  type NoticeKind,
  type NoticeRenderContext,
  type NoticeText,
  type NoticeToJudge,
} from "../notices/notice-kinds";

import type { ReviewDocument } from "./review-state-repository";
import { MAX_STEP_COMMENT_LENGTH } from "./step-comment";

/** What every workflow notice keeps of its document and the move, so it reads after a deletion. */
const workflowNoticeData = z.object({
  /** The collection's singular label, as the admin names it. */
  collection: z.string(),
  /** The document's title when the notice was written. */
  title: z.string(),
  /** The part's language, or null for the shared part. */
  part: z.string().nullable(),
  /** Whether the collection keeps translations: only then is a shared part named as such. */
  localized: z.boolean(),
  /** The step's label: the one taken, or for an assignment the work it asks for. */
  step: z.string().nullable(),
  /** Who acted, by name, or null where no name is known. */
  actor: z.string().nullable(),
  /**
   * The comment the step asked for changes with, as the step accepted it: kept by a request for
   * changes alone, so the writer reads in their notice what to change.
   */
  comment: z.string().min(1).max(MAX_STEP_COMMENT_LENGTH).optional(),
});

/** A request for changes' snapshot: always with the step's comment, which that step requires. */
const changesRequestedData = workflowNoticeData.refine(
  data => data.comment !== undefined,
  { message: "A request for changes keeps the step's comment." }
);

/** An assignment's or an approval's snapshot: never with a comment. */
const withoutCommentData = workflowNoticeData.refine(
  data => data.comment === undefined,
  { message: "Only a request for changes keeps a comment." }
);

/** @experimental */
export type WorkflowNoticeData = z.infer<typeof workflowNoticeData>;

/** What a workflow notice is about: a document. */
const DOCUMENT_SUBJECT = "document";

/**
 * A document as a notice's subject: its kind, its collection and its id, joined. Neither the kind
 * nor a slug holds a colon, so the id is everything after the second.
 *
 * @experimental
 */
export function documentSubjectId(document: ReviewDocument): string {
  return `${document.scopeKind}:${document.scopeSlug}:${document.entryId}`;
}

/** A subject id read back into the document it names; null for one that names none. */
function documentOf(subjectId: string): {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
} | null {
  const [kind, slug, ...id] = subjectId.split(":");
  if ((kind !== "collection" && kind !== "single") || !slug || id.length === 0)
    return null;
  return { kind, slug, entryId: id.join(":") };
}

/**
 * The notices among `notices` whose document the person `userId` may read now, each in the
 * language of the part it names (the shared part as a plain read answers it), asked of the read
 * path as them (`visibleDocuments`), as any list of documents is. An assignee or accountable person
 * who may not read a document, or that language of it, or no longer may, is not told its title,
 * the step's comment or its page. None for an account that is gone or deactivated. Detached from
 * any request, since the question is the recipient's, whoever's request renders the notice.
 */
async function readableDocumentNotices(
  userId: string,
  notices: readonly NoticeToJudge<WorkflowNoticeData>[]
): Promise<Set<string>> {
  const adapter = container.get<DrizzleAdapter>("adapter");
  const resolved = await resolveRunAs(databaseRunAs(adapter), userId);
  if (!resolved.ok || resolved.user === null) return new Set();
  const user = resolved.user;
  const named = notices.flatMap(notice => {
    const document = documentOf(notice.subjectId);
    if (document === null) return [];
    const locale = notice.data.part;
    return [
      {
        id: notice.id,
        document: locale === null ? document : { ...document, locale },
      },
    ];
  });
  const visible = await runDetachedFromRequest(async () =>
    visibleDocuments(
      named,
      each => each.document,
      { user },
      await resolveDocumentVisibilityScope()
    )
  );
  return new Set(visible.map(each => each.id));
}

/**
 * The documents that still exist, each with its edit page in the admin: one read per collection
 * for a page of notices, and one per Single. A document deleted since has none, and its notice
 * says so.
 */
async function documentNoticeLinks(
  subjectIds: readonly string[]
): Promise<Map<string, string>> {
  const bySlug = new Map<string, Map<string, string>>();
  const singles = new Map<string, Map<string, string>>();
  for (const subjectId of subjectIds) {
    const document = documentOf(subjectId);
    if (document === null) continue;
    const of = document.kind === "collection" ? bySlug : singles;
    const ids = of.get(document.slug) ?? new Map<string, string>();
    ids.set(document.entryId, subjectId);
    of.set(document.slug, ids);
  }
  const links = new Map<string, string>();
  for (const [slug, ids] of bySlug) {
    for (const entryId of await stillExisting(slug, [...ids.keys()])) {
      const subjectId = ids.get(entryId);
      if (subjectId)
        links.set(subjectId, `/admin/collections/${slug}/${entryId}`);
    }
  }
  for (const [slug, ids] of singles) {
    // A Single is one document: the notice names it while its id is the Single's own, and a
    // Single deleted and made again is another document.
    const live = await liveSingleId(slug);
    const subjectId = live === null ? undefined : ids.get(live);
    if (subjectId) links.set(subjectId, `/admin/singles/${slug}`);
  }
  return links;
}

/**
 * The id of the Single `slug`'s document, read without creating it; null where there is none.
 * Loaded when asked: the Singles service imports the versions domain, which imports this one.
 */
async function liveSingleId(slug: string): Promise<string | null> {
  const { resolveSingleDocumentId } = await import(
    "../singles/services/single-document-access"
  );
  try {
    return await resolveSingleDocumentId(slug);
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Which of `entryIds` still exist in the collection `slug`, whoever asks: none once the collection
 * itself is gone, whose documents went with it.
 */
async function stillExisting(
  slug: string,
  entryIds: readonly string[]
): Promise<Set<string>> {
  try {
    return await existingDocumentIds(slug, entryIds);
  } catch (error) {
    if (NextlyError.isNotFound(error)) return new Set();
    throw error;
  }
}

/** The document a notice names: its collection, its title, and the part where that tells more. */
function documentPhrase(data: WorkflowNoticeData): string {
  const named = `the ${data.collection} “${data.title}”`;
  if (data.part !== null) return `${named} (${data.part})`;
  return data.localized ? `${named} (shared fields)` : named;
}

/** One sentence of what happened, and that the document is gone where it is. */
function bodyOf(
  sentence: string,
  { subjectGone }: NoticeRenderContext
): string {
  return subjectGone
    ? `${sentence} The document has since been deleted.`
    : sentence;
}

/**
 * A notice's body: what happened, then the step's comment where the notice keeps one, as a
 * paragraph of its own.
 */
function withComment(body: string, comment: string | undefined): string {
  return comment === undefined ? body : `${body}\n\nComment: ${comment}`;
}

/** Who acted, as a sentence names them. */
const who = (data: WorkflowNoticeData): string => data.actor ?? "Someone";

/** The step, as a sentence names it; nothing for a move with no step. */
const withStep = (data: WorkflowNoticeData, word: string): string =>
  data.step === null ? "" : ` ${word} “${data.step}”`;

/** One workflow notice kind, every one sharing the snapshot, the link and the subject. */
function workflowNoticeKind(
  key: string,
  data: z.ZodType<WorkflowNoticeData>,
  render: (data: WorkflowNoticeData) => { title: string; sentence: string }
): NoticeKind<WorkflowNoticeData> {
  return defineNoticeKind<WorkflowNoticeData>({
    key,
    subjectType: DOCUMENT_SUBJECT,
    data,
    render: (snapshot, context): NoticeText => {
      const text = render(snapshot);
      return {
        title: text.title,
        body: withComment(bodyOf(text.sentence, context), snapshot.comment),
      };
    },
    link: documentNoticeLinks,
    readable: readableDocumentNotices,
  });
}

/** @experimental */
export const WORKFLOW_ASSIGNED_NOTICE = workflowNoticeKind(
  "workflows.assigned",
  withoutCommentData,
  data => ({
    title: `“${data.title}” was assigned to you`,
    sentence: `${who(data)} assigned you ${documentPhrase(data)}${withStep(data, "for")}.`,
  })
);

/** @experimental */
export const WORKFLOW_APPROVED_NOTICE = workflowNoticeKind(
  "workflows.approved",
  withoutCommentData,
  data => ({
    title: `“${data.title}” was approved`,
    sentence: `${who(data)} approved ${documentPhrase(data)}${withStep(data, "with")}.`,
  })
);

/** @experimental */
export const WORKFLOW_CHANGES_REQUESTED_NOTICE = workflowNoticeKind(
  "workflows.changes-requested",
  changesRequestedData,
  data => ({
    title: `Changes were requested on “${data.title}”`,
    sentence: `${who(data)} asked for changes to ${documentPhrase(data)}${withStep(data, "with")}.`,
  })
);

/** Every workflow notice kind, as the registration registers them. @experimental */
export const WORKFLOW_NOTICE_KINDS: readonly NoticeKind<WorkflowNoticeData>[] =
  [
    WORKFLOW_ASSIGNED_NOTICE,
    WORKFLOW_APPROVED_NOTICE,
    WORKFLOW_CHANGES_REQUESTED_NOTICE,
  ];

/** The registered slug of the workflows' notice email job. */
export const WORKFLOW_NOTICE_EMAIL_JOB = "workflows:notice-email";

/**
 * The workflows' notice email: each message the notice's own text and its link, made from a
 * workflow notice alone, so the job sends nothing for another feature's.
 */
const WORKFLOW_NOTICE_EMAIL: NoticeEmail = {
  slug: WORKFLOW_NOTICE_EMAIL_JOB,
  name: "workflow",
  message: (notice, subject) => {
    const kind = WORKFLOW_NOTICE_KINDS.find(
      candidate => candidate.key === notice.kind
    );
    const parsed = kind?.data.safeParse(notice.data);
    if (kind === undefined || !parsed?.success) return null;
    return emailOf(
      kind.render(parsed.data, { subjectGone: subject.subjectGone }),
      subject.url
    );
  },
};

/**
 * A workflow notice's email from its text: each paragraph of the body its own paragraph, so a
 * request for changes' comment reads apart from what happened, escaped in HTML as all text is.
 */
function emailOf(text: NoticeText, url: string | null): NoticeEmailMessage {
  const [body, ...after] = text.body?.split("\n\n") ?? [];
  return noticeEmailMessage({
    text: { title: text.title, ...(body === undefined ? {} : { body }) },
    after,
    url,
    linkLabel: "Open the document",
  });
}

/**
 * The job that sends a workflow notice's email: the shared notice email job, under the workflows'
 * slug, with its dependencies resolved per run.
 *
 * @experimental
 */
export function createWorkflowNoticeEmailJob(
  deps: () => NoticeEmailDeps
): JobDefinition<NoticeEmailJobInput> {
  return createNoticeEmailJob(WORKFLOW_NOTICE_EMAIL, deps);
}
