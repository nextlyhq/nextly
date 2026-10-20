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
  type SubjectEventsCaller,
  type SubjectEventsQuery,
} from "../../api/subject-events";
import type { ContentEventSubject } from "../../domains/content-events/record";
import type { ContentEventRecord } from "../../domains/content-events/repository";
import type { DirectAPIConfig, ListResult } from "../types/shared";

import type { NextlyContext } from "./context";
import { accessOptions, mergeConfig, runAsCaller } from "./helpers";

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
    // Run as the caller it names, as every collection operation is: a call
    // naming no person runs as none, so the document's hooks never judge the
    // person of an operation that set this one going.
    list: async args =>
      runAsCaller(ctx.defaultConfig, args, callArgs =>
        readSubjectEvents(
          callArgs.subject,
          queryOf(callArgs),
          callerOf(mergeConfig(ctx.defaultConfig, callArgs))
        )
      ),
  };
}

/** The read's query, from what the call named. */
function queryOf(args: ContentEventsListArgs): SubjectEventsQuery {
  return {
    ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
    ...(args.parts === undefined ? {} : { parts: args.parts }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.before === undefined ? {} : { before: args.before }),
  };
}

/**
 * The caller as every collection operation takes it: the whole user (custom
 * properties a read hook may scope by included), the key's own scope, the
 * instance's settings where the call says nothing, and the request and hook
 * context a collection read would carry, so a hook that narrows reads by them
 * answers the same caller here.
 */
function callerOf(config: DirectAPIConfig): SubjectEventsCaller {
  const access = accessOptions(config);
  return {
    // Trusted only when the merged config says so, as a collection read is: a
    // call forwarding `overrideAccess: undefined` replaces the instance's
    // setting, and is then judged rather than trusted, never the reverse.
    overrideAccess: access.overrideAccess === true,
    ...(access.user === undefined ? {} : { user: access.user }),
    ...(access.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: access.authenticatedScope }),
    ...(access.request === undefined ? {} : { request: access.request }),
    ...(config.context === undefined ? {} : { context: config.context }),
  };
}
