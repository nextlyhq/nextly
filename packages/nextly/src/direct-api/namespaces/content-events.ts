/**
 * Direct API `nextly.contentEvents.*` — a subject's content events, from
 * server code.
 *
 * The same read REST answers at a document's `…/events` and at
 * `/content-events`: a document's or a release's events, filtered by kind and
 * part, newest first, page by page. It goes through the same access check, so
 * a caller is refused here exactly where REST would refuse them; trusted
 * server code (`overrideAccess`, the default) reads without one.
 *
 * @module direct-api/namespaces/content-events
 * @experimental Until the content-history feature is complete.
 */
import {
  readSubjectEvents,
  type SubjectEventsQuery,
} from "../../api/subject-events";
import type { ContentEventSubject } from "../../domains/content-events/record";
import type { ContentEventRecord } from "../../domains/content-events/repository";
import type { DirectAPIConfig, ListResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { accessOptions, mergeConfig } from "./helpers";

/** What `contentEvents.list` takes: a subject, a query, and the caller. */
export type ContentEventsListArgs = DirectAPIConfig &
  SubjectEventsQuery & { subject: ContentEventSubject };

/** @experimental */
export interface ContentEventsNamespace {
  /**
   * A page of a subject's events, newest first, as `{ items, meta }`. The next
   * page passes the last item's id as `before`.
   */
  list(args: ContentEventsListArgs): Promise<ListResult<ContentEventRecord>>;
}

export function createContentEventsNamespace(
  ctx: NextlyContext
): ContentEventsNamespace {
  return {
    list: async args => {
      // The caller as every collection operation takes it: the whole user
      // (custom properties a read hook may scope by included), the key's own
      // scope, and the instance's settings where the call says nothing.
      const access = accessOptions(mergeConfig(ctx.defaultConfig, args));
      return readSubjectEvents(
        args.subject,
        {
          ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
          ...(args.parts === undefined ? {} : { parts: args.parts }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.before === undefined ? {} : { before: args.before }),
        },
        {
          overrideAccess: access.overrideAccess ?? true,
          ...(access.user === undefined ? {} : { user: access.user }),
          ...(access.authenticatedScope === undefined
            ? {}
            : { authenticatedScope: access.authenticatedScope }),
        }
      );
    },
  };
}
