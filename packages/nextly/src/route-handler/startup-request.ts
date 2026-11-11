/**
 * The admin's startup request: `GET /startup?path=/me&path=/me/permissions…`
 * answers several of the admin's own GET requests at once.
 *
 * A fresh admin tab used to ask for about a dozen things (setup status, the
 * session, the person, their permissions, the navigation, settings) in up to
 * five rounds before its first screen's data, each round a full trip to a
 * server that may be far away. The admin now names the paths it is about to
 * ask for, and this answers each one exactly as its own route would:
 *
 * - **Through its own route.** Each path is sent to the admin API handler as a
 *   GET of its own, with the caller's credentials, so it passes its own
 *   authentication, permission check and rate limit, and answers in its own
 *   shape. Nothing here decides access.
 * - **Each part apart.** A part that is refused, or fails, carries its own
 *   status and error body; the other parts are answered as usual.
 * - **Bounded.** At most {@link MAX_STARTUP_PATHS} paths, each a plain path
 *   within the admin API, never this route again.
 * - **Whole.** No part is answered "unchanged" (`304`): the request names
 *   paths, not the answers the admin holds, so each part is sent in full,
 *   and a metadata part's tag (`ETag`) is not carried in it.
 *
 * The admin names the paths rather than this choosing them, because the admin
 * is what knows the exact URLs (and query strings) its screens ask for: one
 * list, in the one place that sends the requests.
 *
 * The answer's own headers say what the server says of the admin as a whole,
 * for the metadata the admin keeps on the device between visits: the schema
 * version and the permission version it labels that metadata with, and
 * whether the site lets it keep any ({@link deviceMemoryHeaders}).
 *
 * @module route-handler/startup-request
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { buildErrorResponse } from "../api/error-response";
import { readOrGenerateRequestId } from "../api/request-id";
import {
  respondData,
  SKIP_DATE_FORMATTING_HEADER,
} from "../api/response-shapes";
import { NextlyError } from "../errors/nextly-error";
import { refreshEpoch } from "../services/lib/rbac-epoch";

import { servedSchemaVersion } from "./schema-version";

/**
 * The environment variable a site sets to `off` so the admin keeps nothing on
 * its editors' devices (no menu, no schemas, no branding, no record of a
 * sign-in). Remembering is on when it is unset or anything else.
 */
const DEVICE_MEMORY_ENV = "NEXTLY_ADMIN_DEVICE_MEMORY";

/** The most paths one startup request may name. */
export const MAX_STARTUP_PATHS = 16;

/**
 * A path within the admin API: a leading `/`, plain segments, an optional
 * query, never a step up (`..`) and never this route itself.
 */
const startupPath = z
  .string()
  .max(512)
  .regex(/^\/[A-Za-z0-9._~\-/]*(\?[^#\s]*)?$/)
  .refine(path => !path.split("?")[0].split("/").includes(".."))
  .refine(path => {
    const first = path.split("?")[0].split("/")[1];
    return first !== "startup";
  });

const startupPaths = z.array(startupPath).min(1).max(MAX_STARTUP_PATHS);

/** One part of the answer: the path, and what its own route answered. */
interface StartupPart {
  path: string;
  status: number;
  body: unknown;
}

/** How one path is answered: the admin API's own GET handler. */
type AnswerGet = (request: Request, params: string[]) => Promise<Response>;

/**
 * Answer `GET /startup`. `answer` is the admin API's GET handler, which each
 * named path is sent through; its responses' cookies (a refreshed or newly
 * issued session) are passed on, so a part that sets one still sets it.
 */
export async function handleStartupRequest(
  req: Request,
  answer: AnswerGet
): Promise<Response> {
  const url = new URL(req.url);
  const parsed = startupPaths.safeParse(url.searchParams.getAll("path"));
  if (!parsed.success) {
    // Returned, not thrown: the admin API's GET has no boundary that turns a
    // throw into a response, so a throw here would reach Next.js as a 500.
    return buildErrorResponse(
      NextlyError.validation({
        errors: [
          {
            path: "path",
            code: "INVALID_VALUE",
            message: `Name between 1 and ${MAX_STARTUP_PATHS} admin API paths to answer.`,
          },
        ],
        logContext: { route: "startup", issues: parsed.error.issues.length },
      }),
      { requestId: readOrGenerateRequestId(req) }
    );
  }
  // Where the admin API is mounted: this route's own path, less `/startup`.
  const base = `${url.origin}${url.pathname.replace(/\/startup\/?$/, "")}`;

  const answered = await Promise.all(
    parsed.data.map(path => answerPath(req, base, path, answer))
  );

  // Each part was formatted by its own route; formatting the whole again would
  // treat their already-formatted dates as raw ones.
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    [SKIP_DATE_FORMATTING_HEADER]: "1",
    ...(await deviceMemoryHeaders()),
  });
  for (const { cookies } of answered) {
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  }
  return respondData({ parts: answered.map(({ part }) => part) }, { headers });
}

/**
 * What the admin's device memory is told with every startup answer:
 *
 * - `X-Nextly-Device-Memory`: `off` where the site set {@link DEVICE_MEMORY_ENV}
 *   to `off`, and `on` otherwise; the admin removes what it kept on `off`.
 * - `X-Nextly-Schema-Version`: the stored schema version this copy serves, as
 *   every other admin response carries it.
 * - `X-Nextly-Permission-Version`: the RBAC epoch, which moves on every change
 *   to a role, a grant or an assignment anywhere in the install. Sent as a
 *   hash, since the admin only compares it: the raw value would tell anyone
 *   how often roles change, which the comparison does not need.
 *
 * Read after the parts, so a change one of them made is the version sent. A
 * version that cannot be read is left out, and the admin then keeps nothing
 * labelled for this page.
 */
async function deviceMemoryHeaders(): Promise<Record<string, string>> {
  const remembering =
    process.env[DEVICE_MEMORY_ENV]?.trim().toLowerCase() === "off"
      ? "off"
      : "on";
  const headers: Record<string, string> = {
    "X-Nextly-Device-Memory": remembering,
  };
  const schemaVersion = await servedSchemaVersion();
  if (schemaVersion !== undefined) {
    headers["X-Nextly-Schema-Version"] = String(schemaVersion);
  }
  try {
    const epoch = await refreshEpoch();
    headers["X-Nextly-Permission-Version"] = createHash("sha256")
      .update(epoch)
      .digest("base64url")
      .slice(0, 22);
  } catch {
    // The epoch could not be read: no permission version is sent, and the
    // admin labels nothing it learns on this page.
  }
  return headers;
}

/** One path, answered by its own route as the caller's own GET. */
async function answerPath(
  req: Request,
  base: string,
  path: string,
  answer: AnswerGet
): Promise<{ part: StartupPart; cookies: string[] }> {
  const target = new URL(`${base}${path}`);
  const params = target.pathname
    .slice(new URL(base).pathname.length)
    .split("/")
    .filter(segment => segment !== "")
    .map(segment => decodeURIComponent(segment));
  // Every part is answered in full: the startup request carries no tag of a
  // part's answer, so a conditional header it was sent with is not passed on,
  // or a metadata part matching it would come back as an empty "unchanged".
  const headers = new Headers(req.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  const sub = new Request(target, { method: "GET", headers });
  let response: Response;
  try {
    response = await answer(sub, params);
  } catch (error) {
    // A route that throws rather than answering still answers here as its own
    // part, so one part's failure never takes the others with it.
    const failure =
      error instanceof NextlyError
        ? error
        : NextlyError.internal({
            cause: error instanceof Error ? error : undefined,
            logContext: { route: "startup", path },
          });
    return {
      part: {
        path,
        status: failure.statusCode,
        body: { error: failure.toResponseJSON(crypto.randomUUID()) },
      },
      cookies: [],
    };
  }
  // `application/json`, and the `application/problem+json` a refusal carries.
  const isJson = /\/(?:[\w.-]+\+)?json\b/i.test(
    response.headers.get("content-type") ?? ""
  );
  const body: unknown = isJson ? await response.json().catch(() => null) : null;
  return {
    part: { path, status: response.status, body },
    cookies: response.headers.getSetCookie(),
  };
}
