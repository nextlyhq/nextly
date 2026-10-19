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
import type { ListResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { actorOf, type ReleaseCallerArgs } from "./releases";

/** @experimental */
export interface ContentEventsNamespace {
  /**
   * A page of a subject's events, newest first, as `{ items, meta }`. The next
   * page passes the last item's id as `before`.
   */
  list(
    args: { subject: ContentEventSubject } & SubjectEventsQuery &
      ReleaseCallerArgs
  ): Promise<ListResult<ContentEventRecord>>;
}

export function createContentEventsNamespace(
  ctx: NextlyContext
): ContentEventsNamespace {
  return {
    list: async args => {
      // The caller resolved by the rule every caller-taking namespace uses,
      // from the ORIGINAL argument bag, so an omitted identity and an
      // explicitly anonymous one stay different questions.
      const actor = actorOf(ctx, args);
      return readSubjectEvents(
        args.subject,
        {
          ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
          ...(args.parts === undefined ? {} : { parts: args.parts }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.before === undefined ? {} : { before: args.before }),
        },
        {
          overrideAccess: actor.overrideAccess,
          ...(actor.userId === null
            ? {}
            : {
                user: {
                  id: actor.userId,
                  ...(actor.userRoles ? { roles: actor.userRoles } : {}),
                },
              }),
          ...(actor.authenticatedScope === undefined
            ? {}
            : { authenticatedScope: actor.authenticatedScope }),
        }
      );
    },
  };
}
