/**
 * The routes a submission's emails are read and sent again through:
 *
 * - `GET /submissions/:id/sends`: each notification the submission sent,
 *   every recipient with its latest result, whether a send is in progress,
 *   and the recipients it can address now, for Resend. Asks reading
 *   submissions, and reads the submission as the person.
 * - `GET /notification-sends?form=&notification=&limit=`: a notification's
 *   recent sends across its form's submissions, newest first. Asks reading
 *   submissions.
 * - `POST /submissions/:id/resend`: Resend (`handlers/resend`). Asks updating
 *   submissions, and managing email deliveries before anything else.
 *
 * Lists answer `{ items, meta }`, Resend `{ message, item }`.
 *
 * @module routes/submission-sends
 */
import {
  buildPaginatedResponse,
  type PaginationMeta,
  type PluginContext,
  type PluginRoute,
  type PluginRouteContext,
  respondList,
} from "nextly";
import { z } from "zod";

import { formIdOf } from "../handlers/form-closing-hold";
import { type ResendDeps, resendRoute } from "../handlers/resend";
import { configuredRecipients } from "../handlers/send-record";
import {
  type NotificationSends,
  recentSends,
  submissionSends,
} from "../handlers/send-views";
import type { FormNotification } from "../types";

/** A list that is whole: one page holding every item. */
function wholeList(total: number): PaginationMeta {
  const built = buildPaginatedResponse([], {
    total,
    page: 1,
    limit: Math.max(total, 1),
  });
  return {
    total: built.totalDocs,
    page: built.page,
    limit: built.limit,
    totalPages: built.totalPages,
    hasNext: built.hasNextPage,
    hasPrev: built.hasPrevPage,
  };
}

/** A recipient the notification can address now, and whether it has it. */
interface AddressableNow {
  digest: string;
  hint: string;
  source: string;
  reached: boolean;
}

/**
 * The recipients each notification can address now, from the form and the
 * answers as they are, each marked as reached when a send of it has.
 */
async function withAddressable(
  ctx: PluginContext,
  deps: ResendDeps,
  submission: Record<string, unknown>,
  groups: NotificationSends[]
): Promise<Array<NotificationSends & { addressable: AddressableNow[] }>> {
  const form = (await ctx.services.ownCollections.findEntryById(
    deps.formsSlug,
    formIdOf(submission.form) ?? ""
  )) as unknown as Record<string, unknown>;
  const notifications = Array.isArray(form.notifications)
    ? (form.notifications as FormNotification[])
    : [];
  return Promise.all(
    groups.map(async group => {
      const notification = notifications.find(
        candidate => candidate.id === group.notification
      );
      const email = notification
        ? deps.build(form, submission, notification)
        : undefined;
      if (!notification || !email) return { ...group, addressable: [] };
      const reached = new Set(
        group.recipients
          .filter(recipient => recipient.state === "sent")
          .map(recipient => recipient.digest)
      );
      const now = await configuredRecipients(
        email,
        notification.recipientType === "field" ? "visitor" : "team",
        address => ctx.services.email.recipientDigest(address)
      );
      return {
        ...group,
        addressable: now.map(recipient => ({
          digest: recipient.digest,
          hint: recipient.hint,
          source: recipient.source,
          reached: reached.has(recipient.digest),
        })),
      };
    })
  );
}

/** `GET /submissions/:id/sends`. */
async function listSubmissionSends(
  ctx: PluginRouteContext,
  deps: ResendDeps
): Promise<Response> {
  // Read as the person: one they may not read has no sends to them.
  const submission = (await ctx.services.collections.findEntryById(
    deps.submissionsSlug,
    ctx.params.id ?? "",
    { as: "user", user: ctx.user ?? undefined }
  )) as unknown as Record<string, unknown>;
  const groups = await withAddressable(
    ctx,
    deps,
    submission,
    await submissionSends(ctx, String(submission.id))
  );
  return respondList(groups, wholeList(groups.length));
}

const RECENT = z.object({
  form: z.string().min(1).max(200),
  notification: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** `GET /notification-sends`. */
async function listRecentSends(
  req: Request,
  ctx: PluginRouteContext,
  deps: ResendDeps
): Promise<Response> {
  const query = RECENT.parse(
    Object.fromEntries(new URL(req.url).searchParams.entries())
  );
  const sends = await recentSends(
    ctx,
    query.form,
    query.notification,
    query.limit
  );
  // The submissions they were for, read as the person: one they may not
  // read is left out, with its send.
  const ids = [...new Set(sends.map(send => send.submission))];
  const { data } = await ctx.services.collections.listEntries(
    deps.submissionsSlug,
    {
      where: { id: { in: ids } },
      pagination: { limit: Math.max(ids.length, 1) },
      depth: 0,
    },
    { as: "user", user: ctx.user ?? undefined }
  );
  const titles = new Map(
    (data as Array<{ id: unknown; title?: unknown }>).map(row => [
      String(row.id),
      typeof row.title === "string" ? row.title : "",
    ])
  );
  const items = sends
    .filter(send => titles.has(send.submission))
    .map(send => ({ ...send, title: titles.get(send.submission) ?? "" }));
  return respondList(items, wholeList(items.length));
}

/** The routes, asked of the submissions collection as installed. */
export function submissionSendsRoutes(options: {
  /** The submissions collection's declared slug, for the permissions. */
  submissionsDeclared: string;
  /** What Resend and the reads build with, from a route's context. */
  deps: (ctx: PluginContext) => ResendDeps;
}): PluginRoute[] {
  const may =
    (action: "read" | "update") =>
    ({
      collection,
    }: {
      collection: (slug: string, action: string) => string;
    }) =>
      collection(options.submissionsDeclared, action);
  return [
    {
      method: "GET",
      path: "/submissions/:id/sends",
      requiredPermission: may("read"),
      handler: (_req, ctx) => listSubmissionSends(ctx, options.deps(ctx)),
    },
    {
      method: "GET",
      path: "/notification-sends",
      requiredPermission: may("read"),
      handler: (req, ctx) => listRecentSends(req, ctx, options.deps(ctx)),
    },
    {
      method: "POST",
      path: "/submissions/:id/resend",
      requiredPermission: may("update"),
      handler: (req, ctx) => resendRoute(req, ctx, options.deps(ctx)),
    },
  ];
}
