/**
 * GET/PUT /admin/api/meta/seed-status — Auth-gated read of the site's answer
 * to sample content, and its decline.
 *
 * Pattern B (project-local) route, mirroring the seed route at
 * src/app/admin/api/seed/route.ts. See findings/02-meta-routes-pattern-deviation.md.
 *
 * Both verbs require a super-admin session.
 *
 * GET answers `{ completedAt, skippedAt, answer, run }`: the two nextly_meta
 * flags, and the site's answer as Nextly reads it (`readSampleContent`),
 * with a load nobody has seen through in `run`.
 *
 * PUT `{ skippedAt: string }` declines sample content for the whole site
 * through Nextly (`declineSampleContent`), which refuses with 409 once the
 * content loaded or while a load is unfinished or unrecorded. The dashboard
 * itself declines through Nextly's own `/admin/api/dashboard/setup`; this
 * keeps the older door answering the same way.
 */

import { getNextly } from "nextly";
import { getSession, isSuperAdmin } from "nextly/auth";
import {
  declineSampleContent,
  readSampleContent,
  SAMPLE_DECLINED_KEY,
  SAMPLE_LOADED_KEY,
  SAMPLE_REFUSAL_MESSAGE,
} from "nextly/database/seeders";
import config from "@nextly-config";

async function ensureSuperAdmin(
  request: Request
): Promise<
  { ok: false; status: number; error: string } | { ok: true; userId: string }
> {
  const secret = process.env.NEXTLY_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: "Server configuration error." };
  }
  // Nextly is initialised before the session is read: reading one checks
  // that its account may still use it, which needs the database, and this
  // route can run in a function where nothing else has started Nextly yet.
  // Unavailable rather than an error, as the probe below answers it.
  try {
    await getNextly({ config });
  } catch {
    return { ok: false, status: 503, error: "Nextly is not available yet." };
  }
  const session = await getSession(request, secret);
  if (!session.authenticated) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (!(await isSuperAdmin(session.user.id))) {
    return { ok: false, status: 403, error: "Super-admin role required." };
  }
  return { ok: true, userId: session.user.id };
}

export async function GET(request: Request): Promise<Response> {
  const guard = await ensureSuperAdmin(request);
  if (!guard.ok) {
    return Response.json(
      { errors: [{ message: guard.error }] },
      { status: guard.status }
    );
  }

  try {
    const nextly = await getNextly({ config });
    const [completedAt, skippedAt, state] = await Promise.all([
      nextly.meta.get<string>(SAMPLE_LOADED_KEY),
      nextly.meta.get<string>(SAMPLE_DECLINED_KEY),
      readSampleContent(nextly.meta),
    ]);
    return Response.json({
      completedAt: completedAt ?? null,
      skippedAt: skippedAt ?? null,
      answer: state.answer ?? null,
      run: state.run ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta/seed-status GET] failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const guard = await ensureSuperAdmin(request);
  if (!guard.ok) {
    return Response.json(
      { errors: [{ message: guard.error }] },
      { status: guard.status }
    );
  }

  let body: { skippedAt?: unknown };
  try {
    body = (await request.json()) as { skippedAt?: unknown };
  } catch {
    return Response.json(
      { errors: [{ message: "Invalid JSON body." }] },
      { status: 400 }
    );
  }
  // Only a decline: the content is recorded loaded by the load itself, never
  // by a write that could close the offer over a load still running.
  if (typeof body?.skippedAt !== "string") {
    return Response.json(
      { errors: [{ message: "The body must be { skippedAt: string }." }] },
      { status: 400 }
    );
  }

  try {
    const nextly = await getNextly({ config });
    const declined = await declineSampleContent(nextly.meta, {
      by: guard.userId,
    });
    if (declined.outcome === "refused") {
      return Response.json(
        { errors: [{ message: SAMPLE_REFUSAL_MESSAGE[declined.reason] }] },
        { status: 409 }
      );
    }
    return Response.json({ message: "Seed status updated." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta/seed-status PUT] failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}
