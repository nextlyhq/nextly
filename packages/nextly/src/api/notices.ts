/**
 * `/api/notices` — the signed-in person's own notices.
 *
 *   GET  /api/notices?unread=&page=&limit=   a page, newest first
 *   GET  /api/notices/count?unread=           how many, or how many unread
 *   POST /api/notices/read                    mark `{ ids }` or `{ all: true }` read
 *
 * The person is ALWAYS the signed-in user, never a parameter, so nobody can
 * read or mark another person's notices however the request is written. An API
 * key is refused: notices are a person's own inbox in the admin, and a key has
 * no inbox.
 *
 * @module api/notices
 * @experimental Until the notices feature is complete.
 */
import { z } from "zod";

import { container } from "../di";
import type { NoticesService } from "../domains/notices/notices-service";
import { NextlyError } from "../errors/nextly-error";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondAction, respondCount, respondList } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A mark-read body is a list of ids at most; nothing larger is a real one. */
const MAX_MARK_READ_BYTES = 64 * 1024;

/** The ids a mark-read names, or every unread notice. */
const markReadBody = z.union([
  z.object({ ids: z.array(z.string().min(1)).max(500) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

function service(): NoticesService {
  return container.get<NoticesService>("noticesService");
}

/** `unread=true` or `unread=false`, or a refusal; absent means all. */
function unreadParam(params: URLSearchParams): boolean | undefined {
  const value = params.get("unread");
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw NextlyError.invalidInput({
    message: "`unread` must be true or false.",
  });
}

/** A whole number from a query string, or a refusal naming it. */
function wholeParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw NextlyError.invalidInput({
      message: `\`${key}\` must be a whole number.`,
    });
  }
  return n;
}

export const getNotices = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have notices");
  const params = new URL(req.url).searchParams;
  const page = await service().find({
    userId: auth.userId,
    unread: unreadParam(params),
    page: wholeParam(params, "page"),
    limit: wholeParam(params, "limit"),
  });
  const totalPages = Math.ceil(page.total / page.limit);
  return respondList(
    page.rows,
    {
      total: page.total,
      page: page.page,
      limit: page.limit,
      totalPages,
      hasNext: page.page < totalPages,
      hasPrev: page.page > 1,
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});

export const getNoticeCount = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have notices");
  const params = new URL(req.url).searchParams;
  const total = await service().count({
    userId: auth.userId,
    unread: unreadParam(params),
  });
  return respondCount(total, { headers: PRIVATE_NO_STORE_HEADERS });
});

export const markNoticesRead = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have notices");
  const parsed = markReadBody.safeParse(
    await readBoundedJsonBody(req, MAX_MARK_READ_BYTES, { route: "notices" })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The body must be `{ ids: string[] }` or `{ all: true }`.",
    });
  }
  const marked = await service().markRead({
    userId: auth.userId,
    ...parsed.data,
  });
  return respondAction("Notices marked read.", { marked });
});
