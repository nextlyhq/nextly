/**
 * `/api/notices` — the signed-in person's own notices.
 *
 *   GET  /api/notices?tab=&unread=&page=&limit=   a page, newest first
 *   GET  /api/notices/count?tab=&unread=           how many, or how many unread
 *   POST /api/notices/read      mark `{ ids }` or `{ all: true, tab? }` read
 *   POST /api/notices/unread    mark `{ ids }` unread again
 *
 * `tab` is `for-you` or `alerts`, the Inbox's two tabs; absent means both.
 * It, and `/unread`, are experimental until the Inbox is complete.
 *
 * The person is ALWAYS the signed-in user, never a parameter, so nobody can
 * read or mark another person's notices however the request is written. An API
 * key is refused: notices are a person's own inbox in the admin, and a key has
 * no inbox.
 *
 * @module api/notices
 */
import { z } from "zod";

import { container } from "../di";
import {
  NOTICE_TABS,
  type NoticesService,
  type NoticeTab,
} from "../domains/notices/notices-service";
import { NextlyError } from "../errors/nextly-error";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondAction, respondCount, respondList } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A mark-read body is a list of ids at most; nothing larger is a real one. */
const MAX_MARK_READ_BYTES = 64 * 1024;

/** The ids a mark names; a mark-unread names nothing else. */
const markIdsBody = z
  .object({ ids: z.array(z.string().min(1)).max(500) })
  .strict();

/** One of the Inbox's tabs, as a query or a body spells it. */
const tabName = z.enum(NOTICE_TABS);

/** The ids a mark-read names, or every unread notice, in both tabs or one. */
const markReadBody = z.union([
  markIdsBody,
  z.object({ all: z.literal(true), tab: tabName.optional() }).strict(),
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

/** One of the Inbox's tabs, or a refusal; absent means both. */
function tabParam(params: URLSearchParams): NoticeTab | undefined {
  const value = params.get("tab");
  if (value === null) return undefined;
  const tab = tabName.safeParse(value);
  if (!tab.success) {
    throw NextlyError.invalidInput({
      message: `\`tab\` must be one of: ${NOTICE_TABS.join(", ")}.`,
    });
  }
  return tab.data;
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
    tab: tabParam(params),
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
    tab: tabParam(params),
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
      message:
        "The body must be `{ ids: string[] }` or `{ all: true, tab? }`, with `tab` one of: " +
        `${NOTICE_TABS.join(", ")}.`,
    });
  }
  const marked = await service().markRead({
    userId: auth.userId,
    ...parsed.data,
  });
  return respondAction("Notices marked read.", { marked });
});

/**
 * "Mark as unread": the named notices of the signed-in person become unread
 * again. Only by id, since nobody asks for everything to be unread.
 *
 * @experimental
 */
export const markNoticesUnread = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have notices");
  const parsed = markIdsBody.safeParse(
    await readBoundedJsonBody(req, MAX_MARK_READ_BYTES, { route: "notices" })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message: "The body must be `{ ids: string[] }`.",
    });
  }
  const marked = await service().markUnread({
    userId: auth.userId,
    ids: parsed.data.ids,
  });
  return respondAction("Notices marked unread.", { marked });
});
