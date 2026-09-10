/**
 * The public form endpoints, served by the plugin that owns the collections.
 *
 * `GET /api/forms`, `GET /api/forms/:slug` and `POST /api/forms/:slug/submit`
 * were served by the core dispatcher, which read collections named `forms` and
 * `form-submissions` in four hardcoded places. Core defines neither, so those
 * endpoints only ever worked when this plugin was installed, and they broke
 * outright on any install that renamed a collection through the plugin's own
 * overrides. They also validated a submission BEFORE the write seam judged it,
 * so a bot that tripped the honeypot while omitting a required field received a
 * distinguishable validation error and left no evidence behind.
 *
 * Contributed at the root mount, so the addresses are unchanged: a client
 * already calling `/api/forms/contact/submit` keeps calling it. Root routes are
 * consulted only where the built-in router declines, which is why core's
 * parser had to stop claiming `/forms` in the same change rather than a later
 * one. Left in place, it would answer first and these would never be reached.
 *
 * The bodies are the canonical envelopes, built with core's own helpers rather
 * than assembled here. A route that rebuilt the shape by hand would preserve
 * the URL while changing the contract underneath every client already calling
 * it, and would silently drop the post-commit warnings `respondAction` carries.
 *
 * @module routes/public-forms
 */

import {
  buildPaginatedResponse,
  formAvailability,
  NextlyError,
  NO_SUCH_FORM,
  respondAction,
  respondDoc,
  respondList,
  trustedClientIp,
  type FormAvailabilityInput,
  type PaginationMeta,
  type PluginRoute,
  type PluginRouteContext,
} from "nextly";

import { submitForm } from "../handlers/submit-form";
import type { ResolvedFormBuilderConfig } from "../types";

/**
 * These routes read and write as the anonymous visitor on the other end.
 *
 * `public: true` waives the ROUTE's authentication and says nothing about the
 * collections behind it. Elevating to `system` here would hand a form to any
 * caller on an install whose host set `formOverrides.access.read` to something
 * narrower, and accept a submission on one that closed creation, which is the
 * host's configuration being silently overridden rather than obeyed.
 */
const PUBLIC = { as: "public" } as const;

/** How many forms a page of the public listing holds when none is asked for. */
const DEFAULT_LIST_LIMIT = 100;

/** What a visitor is told when the form's author wrote no message of their own. */
const DEFAULT_SUCCESS_MESSAGE = "Thank you for your submission!";

/**
 * The collection names this install actually uses.
 *
 * A host may rename either collection through the plugin's overrides, and
 * `ctx.self.collections` maps what the plugin DECLARED to what was registered.
 * Reading the declared name directly is what made the core endpoints fail on a
 * renamed install while the plugin's own export route kept working.
 */
function installedSlugs(
  config: ResolvedFormBuilderConfig,
  self: PluginRouteContext["self"]
): { forms: string; submissions: string } {
  const declaredForms = config.formOverrides.slug;
  const declaredSubmissions = config.formSubmissionOverrides.slug;
  return {
    forms: self.collections[declaredForms] ?? declaredForms,
    submissions: self.collections[declaredSubmissions] ?? declaredSubmissions,
  };
}

/**
 * The config `submitForm` should read on THIS install.
 *
 * That helper takes the declared slugs from configuration, which is right for a
 * host calling it directly and wrong for a route, where the registered names
 * are knowable. Handing it a config whose slugs are already resolved keeps one
 * submission path rather than a second one that reads different tables.
 */
function configForInstall(
  config: ResolvedFormBuilderConfig,
  self: PluginRouteContext["self"]
): ResolvedFormBuilderConfig {
  const slugs = installedSlugs(config, self);
  return {
    ...config,
    formOverrides: { ...config.formOverrides, slug: slugs.forms },
    formSubmissionOverrides: {
      ...config.formSubmissionOverrides,
      slug: slugs.submissions,
    },
  };
}

/** A positive integer from a query string, or `undefined` when it is not one. */
function positiveInt(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The service's offset-based pagination, as the wire's page-based meta.
 *
 * The page arithmetic is `buildPaginatedResponse`'s, not a second copy of it.
 * Its edge cases are the ones this endpoint has always answered with and are
 * easy to get subtly wrong alone: an empty collection reports ONE page rather
 * than zero, and a page past the end reports the clamped page rather than the
 * one that was asked for, so `?page=100` on a single-page list cannot answer
 * "page 100 of 1".
 */
function toPageMeta(pagination: {
  total: number;
  limit: number;
  offset: number;
}): PaginationMeta {
  const limit = pagination.limit > 0 ? pagination.limit : DEFAULT_LIST_LIMIT;
  const built = buildPaginatedResponse([], {
    total: pagination.total,
    page: Math.floor(pagination.offset / limit) + 1,
    limit,
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

async function listPublishedForms(
  req: Request,
  ctx: PluginRouteContext,
  config: ResolvedFormBuilderConfig
): Promise<Response> {
  const url = new URL(req.url);
  const slugs = installedSlugs(config, ctx.self);

  // Published only. The listing is the one surface anyone can enumerate, so a
  // draft or closed form must not appear in it; the by-slug read below is what
  // explains a closed form, and only to a caller who already holds its slug.
  const result = await ctx.services.collections.listEntries(
    slugs.forms,
    {
      where: { status: { equals: "published" } },
      pagination: {
        limit: positiveInt(url.searchParams.get("limit")) ?? DEFAULT_LIST_LIMIT,
        page: positiveInt(url.searchParams.get("page")) ?? 1,
      },
    },
    PUBLIC
  );

  return respondList(result.data ?? [], toPageMeta(result.pagination));
}

async function readFormBySlug(
  slug: string,
  ctx: PluginRouteContext,
  config: ResolvedFormBuilderConfig
): Promise<Response> {
  const slugs = installedSlugs(config, ctx.self);

  // Fetched by slug alone, then judged. A status filter in the query would
  // answer 404 for a CLOSED form as readily as for one that never existed, and
  // those are different answers: a visitor following a link to a closed form is
  // owed the reason its author wrote.
  const result = await ctx.services.collections.listEntries(
    slugs.forms,
    { where: { slug: { equals: slug } }, pagination: { limit: 1 } },
    PUBLIC
  );

  const doc = result.data?.[0] as FormAvailabilityInput | undefined;
  const availability = formAvailability(doc);

  if (availability.kind === "absent") {
    // The same sentence every other door gives. The canonical "Not found."
    // would make what a visitor is told depend on which client they used.
    throw NextlyError.notFound({
      message: NO_SUCH_FORM,
      logContext: { entity: "form", slug, reason: availability.reason },
    });
  }

  if (availability.kind === "closed") {
    // Only what a visitor at this address needs. The author wrote the message
    // FOR them; nothing else on the row is theirs, and a closed form renders a
    // sentence rather than fields.
    return respondDoc({
      slug,
      status: "closed",
      closedMessage: availability.message,
    });
  }

  return respondDoc(doc as unknown as Record<string, unknown>);
}

/**
 * The submitted answers, or the refusal for a body that carries none.
 *
 * A malformed body and an absent one are the same mistake to a caller, so both
 * answer the way core did: a validation error naming `data`, rather than the
 * parser's own exception surfacing as a 500.
 */
async function readSubmittedData(
  req: Request,
  slug: string
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    parsed = undefined;
  }
  const body = parsed as { data?: Record<string, unknown> } | undefined;

  if (!body?.data || typeof body.data !== "object") {
    throw NextlyError.validation({
      errors: [
        {
          path: "data",
          code: "MISSING_FIELD",
          message: "Request body must contain a 'data' object.",
        },
      ],
      logContext: { slug },
    });
  }
  return body.data;
}

/**
 * The refusal an unaccepted outcome owes the caller.
 *
 * One place, so the status a given ending produces is read off a single list
 * rather than inferred from a message. `accepted` never reaches here: it is the
 * one outcome with a body rather than an error, and the caller returns it.
 */
function refusalFor(
  result: Awaited<ReturnType<typeof submitForm>>,
  slug: string
): NextlyError {
  const entity = { entity: "form", slug };
  switch (result.outcome) {
    case "no-such-form":
      return NextlyError.notFound({
        message: NO_SUCH_FORM,
        logContext: entity,
      });

    // A state conflict, not a validation failure. `validation` fixes the
    // canonical `error.message` to "Validation failed." and nests the real one
    // under `error.data.errors[0]`, so a client reading the documented envelope
    // would be handed the author's explanation and never show it.
    case "closed":
      return NextlyError.conflict({
        reason: "state",
        message: result.error ?? NO_SUCH_FORM,
        logContext: { ...entity, reason: "closed" },
      });

    case "duplicate":
      return NextlyError.conflict({
        reason: "state",
        message: result.error ?? "You have already submitted this form.",
        logContext: { ...entity, reason: "duplicate" },
      });

    // The codes come from the issue list, not from the message map beside it.
    // A client tells "you left this blank" from "this is not an email" by the
    // code, and reporting every failure as `INVALID` stops that working while
    // looking correct in a status-only test.
    case "invalid":
      return NextlyError.validation({
        errors: (result.validationIssues ?? []).map(issue => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
        logContext: { slug },
      });

    // A typed refusal is re-thrown as itself. The collection may refuse a write
    // for a reason its host chose, and those carry their own status and field
    // detail; answering all of them with one internal error tells a visitor the
    // server broke when their submission was in fact answered deliberately.
    // Anything untyped stays a 500, which is what an unexpected failure is.
    default:
      if (result.cause instanceof NextlyError) return result.cause;
      return NextlyError.internal({
        logContext: { ...entity, reason: "submission-failed" },
      });
  }
}

async function acceptSubmission(
  req: Request,
  ctx: PluginRouteContext,
  config: ResolvedFormBuilderConfig,
  slug: string
): Promise<Response> {
  const data = await readSubmittedData(req, slug);

  const result = await submitForm(
    {
      formSlug: slug,
      data,
      // The request itself, so the write seam resolves the client under this
      // deployment's proxy-trust settings and judges this submission on the
      // same facts as one arriving through any other door.
      request: req,
      // The address for the audit column and the single-submission check,
      // resolved by the core rather than read off a header here, which would
      // record whatever the sender chose to claim and let one visitor pass as
      // many.
      metadata: {
        ipAddress: trustedClientIp(req) ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      },
      access: PUBLIC,
    },
    {
      pluginContext: ctx,
      pluginConfig: configForInstall(config, ctx.self),
    }
  );

  if (result.outcome !== "accepted") throw refusalFor(result, slug);

  // One envelope for every accepted ending, including the two that are
  // deliberately indistinguishable from a refusal a bot could learn from: a
  // submission the honeypot flagged, and one the rate limiter refused.
  //
  // Both omit `submissionId`, because neither has a row a caller could then ask
  // about. That is a residual difference in the BODY, not in the status, and it
  // is the honest one: the alternatives are to invent an id that addresses
  // nothing, or to stop returning it to the real clients this endpoint has
  // always returned it to.
  return respondAction(
    result.successMessage ?? DEFAULT_SUCCESS_MESSAGE,
    {
      ...(result.submission ? { submissionId: result.submission.id } : {}),
      // Forwarded because this route is the only thing that can act on it. A
      // form configured to redirect on success resolves one here, and core's
      // endpoint dropped it, so the setting did nothing for any client posting
      // over HTTP. Additive, and present on a flagged submission too, so it
      // cannot be diffed against an accepted one.
      ...(result.redirect ? { redirect: result.redirect } : {}),
    },
    { status: 201 }
  );
}

/**
 * The three public form endpoints, at the addresses core used to serve.
 *
 * `public: true` on all three: a form is filled in by a visitor with no session
 * at all, which is the whole point of the feature.
 */
export function publicFormRoutes(
  config: ResolvedFormBuilderConfig
): PluginRoute[] {
  return [
    {
      method: "GET",
      path: "/forms",
      mount: "root",
      public: true,
      // Collection documents, so their stored timestamps are presented in the
      // installation's timezone exactly as the built-in read did.
      formatTimestamps: true,
      handler: (req, ctx) => listPublishedForms(req, ctx, config),
    },
    {
      method: "GET",
      path: "/forms/:slug",
      mount: "root",
      public: true,
      formatTimestamps: true,
      handler: (_req, ctx) => readFormBySlug(ctx.params.slug, ctx, config),
    },
    {
      method: "POST",
      path: "/forms/:slug/submit",
      mount: "root",
      public: true,
      handler: (req, ctx) =>
        acceptSubmission(req, ctx, config, ctx.params.slug),
    },
  ];
}
