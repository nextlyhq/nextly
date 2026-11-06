/**
 * The signed-in person's own notices: a page of them, how many are unread,
 * and marking them read. The server always answers for the person signed in,
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

/** What marking notices read names: some by id, or every unread one. */
export type MarkNoticesRead = { ids: string[] } | { all: true };

/** The notices shown at once in the bell. */
const NOTICES_PAGE_SIZE = 20;

export const noticesApi = {
  list: (): Promise<NoticeListResponse> =>
    protectedApi.get<NoticeListResponse>(
      `/notices?page=1&limit=${NOTICES_PAGE_SIZE}`
    ),
  unreadCount: async (): Promise<number> =>
    (await protectedApi.get<{ total: number }>("/notices/count?unread=true"))
      .total,
  markRead: (body: MarkNoticesRead): Promise<{ marked: number }> =>
    protectedApi.post<{ marked: number }>("/notices/read", body),
};
