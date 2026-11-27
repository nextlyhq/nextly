/**
 * The signed-in person's own Inbox: a page of one tab, how many are unread,
 * and marking items read or unread again. The server always answers for the person signed in,
 * never for one named in the request, so these calls take no user.
 *
 * Mirrors the notice view the notices routes answer with
 * (`packages/nextly/src/domains/notices/notices-service.ts`, `NoticeView`).
 *
 * @module components/features/notifications/notices-api
 */
import { protectedApi } from "@admin/lib/api/protectedApi";

/** One notice, written by the server in the words of its kind. */
export interface Notice {
  id: string;
  /** Namespaced by the feature that wrote it, such as `releases.stopped`. */
  kind: string;
  title: string;
  body?: string;
  subject: {
    type: string;
    id: string;
    /** Where the subject is in the admin; `null` when it has none or is gone. */
    link: string | null;
    gone: boolean;
  };
  createdAt: string;
  readAt: string | null;
}

/** A page of notices, newest first. */
export interface NoticeListResponse {
  items: Notice[];
  meta: { total: number; page: number; limit: number; hasNext: boolean };
}

/**
 * The Inbox's tabs: "For you", what people did that involves the person, and
 * "Alerts", what on the site needs fixing.
 */
export type InboxTab = "for-you" | "alerts";

/** What marking read names: some by id, or every unread one in a tab. */
export type MarkNoticesRead = { ids: string[] } | { all: true; tab: InboxTab };

/** The items shown at once in the Inbox's popover. */
const NOTICES_PAGE_SIZE = 20;

export const noticesApi = {
  list: (tab: InboxTab): Promise<NoticeListResponse> =>
    protectedApi.get<NoticeListResponse>(
      `/notices?tab=${tab}&page=1&limit=${NOTICES_PAGE_SIZE}`
    ),
  /** Unread items in both tabs, or in one. */
  unreadCount: async (tab?: InboxTab): Promise<number> =>
    (
      await protectedApi.get<{ total: number }>(
        tab === undefined
          ? "/notices/count?unread=true"
          : `/notices/count?unread=true&tab=${tab}`
      )
    ).total,
  markRead: (body: MarkNoticesRead): Promise<{ marked: number }> =>
    protectedApi.post<{ marked: number }>("/notices/read", body),
  markUnread: (body: { ids: string[] }): Promise<{ marked: number }> =>
    protectedApi.post<{ marked: number }>("/notices/unread", body),
};
