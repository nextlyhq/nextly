/**
 * Read a subject's content events: a document's, or a release's.
 *
 * The one read REST, the Direct API and the plugin service all call, so who
 * may read a subject's events is decided in one place:
 *
 * - **A document that exists** is read through the gate its version history
 *   uses: the read permission for its collection or Single, then the document's
 *   own rules (`assertVersionDocumentReadable`). Its current life is read.
 * - **A document that no longer exists** is read through
 *   `mayReadDeletedDocument`, never by more people than could read it while it
 *   existed. The life its latest deletion ended is read.
 * - **A release** is read by whoever may read releases, through Releases' own
 *   check, whether it still exists or not.
 *
 * Every refusal is "not found", as the version history's is: a distinct
 * refusal would confirm the subject exists to a caller not allowed to know.
 *
 * @module api/subject-events
 * @experimental
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { z } from "zod";

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import {
  canReadEntity,
  readAccessCaller,
  type ReadAccessCaller,
} from "../auth/entity-read-access";
import { getService } from "../di";
import { container } from "../di/container";
import { mayReadDeletedDocument } from "../domains/content-events/deleted-document-access";
import type { ContentEventSubject } from "../domains/content-events/record";
import {
  assertPageSize,
  ContentEventsRepository,
  type ContentEventQuery,
  type ContentEventRecord,
} from "../domains/content-events/repository";
import { resolveSingleDocumentId } from "../domains/singles/services/single-document-access";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { SHARED_PART } from "../schemas/content-events";

import type { PaginationMeta } from "./response-shapes";
import {
  assertVersionDocumentReadable,
  historyLanguagesOf,
  readableHistoryLocales,
} from "./versions-access";

/** Who is reading. */
export interface SubjectEventsCaller {
  /** Trusted server code: every access check is skipped. */
  overrideAccess?: boolean;
  /** The resolved caller, needed unless `overrideAccess`. */
  user?: UserContext;
  /** A scoped API key's own grants, when the caller is one. */
  authenticatedScope?: AuthenticatedScope;
  /** The request behind the read, handed to the document's read hooks. */
  request?: Request;
  /** The caller's hook context, handed to the document's read hooks. */
  context?: Record<string, unknown>;
}

/** What to read of a subject's events. */
export interface SubjectEventsQuery {
  /** Only events of these kinds. */
  kinds?: readonly string[];
  /** Only events that involved these parts (locale codes, or the shared part). */
  parts?: readonly string[];
  /** At most this many events, 1 to 100; 25 when absent. */
  limit?: number;
  /** Only events older than this one: the last item's id, for the next page. */
  before?: string;
}

const DEFAULT_PAGE = 25;

/** A comma-separated list, as `?kind=a,b` carries it; absent or empty is none. */
const listParam = z
  .string()
  .optional()
  .transform(value =>
    value === undefined
      ? undefined
      : value
          .split(",")
          .map(item => item.trim())
          .filter(item => item.length > 0)
  )
  .transform(items => (items?.length ? items : undefined));

/** The query a REST read takes. Bounds on `limit` are the read's own. */
const queryParams = z.object({
  kind: listParam,
  part: listParam,
  limit: z
    .string()
    .regex(/^\d+$/, "limit must be a whole number")
    .transform(Number)
    .optional(),
  before: z.string().trim().min(1).optional(),
});

/** Which subject a read by subject names. */
const subjectParams = z.discriminatedUnion("subject", [
  z.object({
    subject: z.enum(["collection", "single"]),
    slug: z.string().trim().min(1),
    id: z.string().trim().min(1),
  }),
  z.object({ subject: z.literal("release"), id: z.string().trim().min(1) }),
]);

/** Refused input, said in one sentence a caller can act on. */
function invalid(error: z.ZodError): NextlyError {
  return NextlyError.invalidInput({
    message:
      "Read a subject's events with ?kind=, ?part=, ?limit= (1 to 100) and ?before=, each optional.",
    logContext: { issues: error.issues.map(issue => issue.message) },
  });
}

/** The read's query, from a request's search parameters. */
export function parseSubjectEventsQuery(
  params: Record<string, unknown>
): SubjectEventsQuery {
  const parsed = queryParams.safeParse({
    kind: optionalString(params.kind),
    part: optionalString(params.part),
    limit: optionalString(params.limit),
    before: optionalString(params.before),
  });
  if (!parsed.success) throw invalid(parsed.error);
  const { kind, part, limit, before } = parsed.data;
  return {
    ...(kind ? { kinds: kind } : {}),
    ...(part ? { parts: part } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(before !== undefined ? { before } : {}),
  };
}

/** The subject a read by subject names, from its search parameters. */
export function parseSubjectParam(
  params: Record<string, unknown>
): ContentEventSubject {
  const parsed = subjectParams.safeParse({
    subject: optionalString(params.subject),
    slug: optionalString(params.slug),
    id: optionalString(params.id),
  });
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message:
        "Name the subject: ?subject=collection|single with ?slug= and ?id=, or ?subject=release with ?id=.",
      logContext: { issues: parsed.error.issues.map(issue => issue.message) },
    });
  }
  return parsed.data.subject === "release"
    ? { kind: "release", id: parsed.data.id }
    : {
        kind: parsed.data.subject,
        slug: parsed.data.slug,
        id: parsed.data.id,
      };
}

/** A parameter as text, or undefined when it was not given as text. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A page of a subject's events, newest first. */
export async function readSubjectEvents(
  subject: ContentEventSubject,
  query: SubjectEventsQuery,
  caller: SubjectEventsCaller
): Promise<{ items: ContentEventRecord[]; meta: PaginationMeta }> {
  const limit = query.limit ?? DEFAULT_PAGE;
  // Malformed paging fails before any read, by the repository's own bounds.
  assertPageSize(limit);

  const repository = new ContentEventsRepository(
    container.get<DrizzleAdapter>("adapter"),
    getService("logger")
  );
  const page = await readAuthorizedLife(
    subject,
    { ...query, limit },
    caller,
    repository
  );
  // A release's history lists only the documents the caller may read, as
  // the release's own document list does. The cursor stays the page's, so
  // the next page starts where this one's read ended.
  const items =
    subject.kind === "release"
      ? await getService("releasesService").historyVisibleTo(
          page.items,
          releaseActorOf(caller)
        )
      : page.items;
  return {
    items,
    // A cursor walk: page and total describe the window returned, and the
    // next page passes the last item's id as `before`.
    meta: {
      total: items.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext: page.nextBefore !== null,
      hasPrev: query.before !== undefined,
    },
  };
}

/** How many times a read is authorized again when a life ends under it. */
const LIFE_ATTEMPTS = 3;

/**
 * A page from the life the caller was authorized for.
 *
 * A document can be deleted and made again under the same id between the
 * authorization and the read, and its current life is then one this caller
 * was never judged against. A deletion always records a new end, so a latest
 * end unchanged after the read proves the life read is the life authorized.
 * A changed one means it may not be, so the caller is authorized again, and
 * refused if lives keep ending faster than they can be read.
 */
async function readAuthorizedLife(
  subject: ContentEventSubject,
  query: ContentEventQuery,
  caller: SubjectEventsCaller,
  repository: ContentEventsRepository
): Promise<Awaited<ReturnType<ContentEventsRepository["listForSubject"]>>> {
  for (let attempt = 1; attempt <= LIFE_ATTEMPTS; attempt += 1) {
    const { life, ended, visibleParts } = await authorizeSubject(
      subject,
      query,
      caller,
      repository
    );
    const page = await repository.listForSubject(subject, {
      ...query,
      ...(life === undefined ? {} : { life }),
      ...(visibleParts === undefined ? {} : { visibleParts }),
    });
    // Only the current life can change under a read: an ended one is named by
    // its end, and a release has one life.
    if (life !== "current") return page;
    if ((await repository.latestEnd(subject)) === ended) return page;
  }
  throw refused(subject, "document-life-ended-during-read");
}

/**
 * Refuse a caller who may not read this subject's events, and say which life
 * of it to read, with the subject's latest end as it stood before deciding,
 * and which of its parts the caller may be shown.
 */
async function authorizeSubject(
  subject: ContentEventSubject,
  query: ContentEventQuery,
  caller: SubjectEventsCaller,
  repository: ContentEventsRepository
): Promise<{
  life: ContentEventQuery["life"];
  ended: string | null;
  visibleParts?: readonly string[];
}> {
  if (subject.kind === "release") {
    await authorizeRelease(subject.id, caller);
    // A release id is never reused, so it has one life.
    return { life: undefined, ended: null };
  }
  const ended = await repository.latestEnd(subject);
  if (ended !== null && !(await documentExists(subject))) {
    const life = { endedBy: ended };
    if (caller.overrideAccess) return { life, ended };
    const visibleParts = await authorizeDeletedDocument(subject, query, caller);
    return { life, ended, visibleParts };
  }
  if (caller.overrideAccess) return { life: "current", ended };
  const visibleParts = await authorizeLiveDocument(subject, query, caller);
  return { life: "current", ended, visibleParts };
}

/**
 * A deleted document's gate, and the parts its events may show.
 *
 * A row that is gone cannot be read in any language, so the languages shown
 * are those its history can be asked about (`historyLanguagesOf`), which
 * `mayReadDeletedDocument` decides alike. A
 * language no longer configured is withheld here as it is from a live
 * document's history, and a read naming one is refused.
 */
async function authorizeDeletedDocument(
  subject: Exclude<ContentEventSubject, { kind: "release" }>,
  query: ContentEventQuery,
  caller: SubjectEventsCaller
): Promise<readonly string[]> {
  if (!(await mayReadDeletedDocument(subject, readerOf(caller)))) {
    throw refused(subject, "deleted-document-not-readable");
  }
  const visibleParts = [
    ...(await historyLanguagesOf(subject.kind, subject.slug)),
    SHARED_PART,
  ];
  if ((query.parts ?? []).some(part => !visibleParts.includes(part))) {
    throw refused(subject, "deleted-document-language-not-readable");
  }
  return visibleParts;
}

/**
 * The live document's gate, as its version history has it. The coarse read
 * permission runs here too, because not every entry point has a route that ran
 * it first: the Direct API, a plugin, and the read by subject.
 *
 * Returns the parts the caller may be shown: the shared part and each
 * language they may read the document in.
 */
async function authorizeLiveDocument(
  subject: Exclude<ContentEventSubject, { kind: "release" }>,
  query: ContentEventQuery,
  caller: SubjectEventsCaller
): Promise<readonly string[]> {
  const { user } = caller;
  if (user === undefined) throw refused(subject, "anonymous");
  if (!(await canReadEntity(subject.slug, readerOf(caller)))) {
    throw refused(subject, "document-type-not-readable");
  }
  // The hooks see what they would on the caller's own read of the document.
  const hookInputs = {
    ...(caller.request === undefined ? {} : { request: caller.request }),
    ...(caller.context === undefined ? {} : { context: caller.context }),
  };
  // Each language the read names is asked about, and any refused refuses it.
  await assertVersionDocumentReadable(
    subject.kind,
    subject.slug,
    subject.id,
    user,
    caller.authenticatedScope,
    hookInputs,
    (query.parts ?? []).filter(part => part !== SHARED_PART)
  );
  const readable = await readableHistoryLocales(
    subject.kind,
    subject.slug,
    subject.id,
    user,
    caller.authenticatedScope,
    hookInputs
  );
  return [...readable, SHARED_PART];
}

/**
 * Releases' own read check, through a read that runs it before anything else.
 * A refusal means no read authority; null means the release is gone but the
 * caller may read releases, so its events stay readable.
 */
async function authorizeRelease(
  id: string,
  caller: SubjectEventsCaller
): Promise<void> {
  try {
    await getService("releasesService").findByID(id, releaseActorOf(caller));
  } catch (error) {
    if (error instanceof NextlyError && error.code === "FORBIDDEN") {
      throw refused({ kind: "release", id }, "releases-not-readable");
    }
    throw error;
  }
}

/** The caller as Releases judges it: its read check and its document reads. */
function releaseActorOf(caller: SubjectEventsCaller) {
  return {
    userId: caller.user?.id ?? null,
    overrideAccess: caller.overrideAccess === true,
    ...(caller.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: caller.authenticatedScope }),
    ...(caller.user?.roles ? { userRoles: [...caller.user.roles] } : {}),
  };
}

/** Whether the document still exists, read without the caller's access. */
async function documentExists(
  subject: Exclude<ContentEventSubject, { kind: "release" }>
): Promise<boolean> {
  if (subject.kind === "single") {
    return (await resolveSingleDocumentId(subject.slug)) === subject.id;
  }
  const result = await getService("collectionsHandler").getEntry({
    collectionName: subject.slug,
    entryId: subject.id,
    overrideAccess: true,
    status: "all",
  });
  if (result.success) return true;
  if (result.statusCode === 404) return false;
  // Anything else is a fault, not an answer about the document.
  throw NextlyError.internal({
    logContext: {
      reason: "subject-events-document-lookup-failed",
      statusCode: result.statusCode,
      scopeSlug: subject.slug,
      entryId: subject.id,
    },
  });
}

/** The caller as an entity-level read decision reads it. */
function readerOf(caller: SubjectEventsCaller): ReadAccessCaller {
  // An anonymous caller reads nothing here: events are read by people and
  // keys, and an empty id is refused by every decision below.
  const user = caller.user ?? { id: "" };
  return readAccessCaller({
    user,
    ...(caller.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: caller.authenticatedScope }),
  });
}

/** "Not found", whatever the reason, with the reason kept for the log. */
function refused(subject: ContentEventSubject, reason: string): NextlyError {
  return NextlyError.notFound({
    logContext: {
      reason,
      subjectKind: subject.kind,
      ...(subject.kind === "release" ? {} : { scopeSlug: subject.slug }),
      subjectId: subject.id,
    },
  });
}
