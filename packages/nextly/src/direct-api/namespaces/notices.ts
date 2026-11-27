/**
 * Direct API `nextly.notices.*` — a person's own notices, from server code.
 *
 * The same reads and writes as `/api/notices`, for code running in the
 * server process. REST takes the person from the session; here the caller
 * names them, because the Direct API is a trusted in-process caller that acts
 * for whoever it says it is acting for — a route handler passes the signed-in
 * user, a job the user it is notifying.
 *
 * Writing notices is not here: a notice is written by the feature that owns
 * its kind, through the notices service, inside the change it reports.
 *
 * @module direct-api/namespaces/notices
 */
import { container } from "../../di/container";
import { toPaginationMeta } from "../../dispatcher/helpers/service-envelope";
import type {
  NoticesService,
  NoticeTab,
  NoticeView,
} from "../../domains/notices/notices-service";
import type { ListResult, MutationResult } from "../types/shared";

export interface NoticesNamespace {
  /**
   * A page of this person's notices, newest first, as `{ items, meta }`.
   * `tab` (experimental) narrows it to the Inbox's "For you" or "Alerts".
   */
  find(args: {
    userId: string;
    tab?: NoticeTab;
    unread?: boolean;
    page?: number;
    limit?: number;
  }): Promise<ListResult<NoticeView>>;
  /**
   * How many notices this person has, or how many are unread, in both tabs
   * or, with `tab` (experimental), in one.
   */
  count(args: {
    userId: string;
    tab?: NoticeTab;
    unread?: boolean;
  }): Promise<number>;
  /**
   * Mark this person's notices read: the ones named, or all of them, in both
   * tabs or, with `tab` (experimental), in one.
   */
  markRead(
    args: { userId: string } & (
      | { ids: string[] }
      | { all: true; tab?: NoticeTab }
    )
  ): Promise<MutationResult<{ marked: number }>>;
  /**
   * Make this person's named notices unread again.
   *
   * @experimental
   */
  markUnread(args: {
    userId: string;
    ids: string[];
  }): Promise<MutationResult<{ marked: number }>>;
}

function service(): NoticesService {
  return container.get<NoticesService>("noticesService");
}

export function createNoticesNamespace(): NoticesNamespace {
  return {
    find: async args => {
      const page = await service().find(args);
      return {
        items: page.rows,
        meta: toPaginationMeta({
          total: page.total,
          page: page.page,
          limit: page.limit,
          totalPages: Math.ceil(page.total / page.limit),
        }),
      };
    },
    count: args => service().count(args),
    // The mutation envelope every Direct API write returns.
    markRead: async args => {
      const marked = await service().markRead(args);
      return {
        message:
          marked === 1
            ? "1 notice marked read."
            : `${marked} notices marked read.`,
        item: { marked },
      };
    },
    markUnread: async args => {
      const marked = await service().markUnread(args);
      return {
        message:
          marked === 1
            ? "1 notice marked unread."
            : `${marked} notices marked unread.`,
        item: { marked },
      };
    },
  };
}
