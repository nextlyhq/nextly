/**
 * HEAD/POST /admin/api/seed — Auth-gated demo content seeder.
 *
 * HEAD is how the admin dashboard's setup card asks whether THIS person may
 * load sample content: 200 with X-Nextly-Seed-Template* headers for a
 * signed-in super-admin, 401/403 for anyone the POST would refuse, 404 where
 * the project ships no seed (the blank template), 503 while Nextly is still
 * starting. The card offers the load on a 200 only.
 *
 * POST runs the content seed (src/endpoints/seed/index.ts) through Nextly's
 * sample-content runner (`sampleContentPost` from `nextly/database/seeders`),
 * which loads it at most once at a time for the whole site, whoever starts
 * it: a start while another load is unfinished, after somebody loaded or
 * declined, or after a failed load without `{ "confirm": true }` is refused
 * with 409 and loads nothing. The runner records the outcome in nextly_meta,
 * so every tab and every person sees the same one. A body of
 * `{ "confirm": true }` loads again after a failure, once the person has been
 * told some of the content may already be there.
 *
 * Schema is created via SQL migrations (boot-time auto-apply).
 * This route only populates demo content.
 *
 * Why a POST and not boot-time magic: prior versions of the blog
 * template ran the seed automatically when `next dev` first registered
 * services. That path silently failed when the cached Nextly singleton
 * was bootstrapped without `{ config }`, leaving users with an empty
 * database and no clear error. Moving to an explicit user action
 * eliminates the ordering fragility and gives us a place to surface
 * success / error toasts.
 */

import { getNextly } from "nextly";
import { getSession, isSuperAdmin } from "nextly/auth";
import { sampleContentPost } from "nextly/database/seeders";
import config from "@nextly-config";

import { seed } from "@/endpoints/seed";

const TEMPLATE_SLUG = "blog";
const TEMPLATE_LABEL = "Blog";

async function ensureSuperAdmin(
  request: Request
): Promise<{ status: number; error: string } | null> {
  const secret = process.env.NEXTLY_SECRET;
  if (!secret) {
    return { status: 500, error: "Server configuration error." };
  }
  // Nextly is initialised before the session is read: reading one checks
  // that its account may still use it, which needs the database, and this
  // route can run in a function where nothing else has started Nextly yet.
  // Unavailable rather than an error, as the probe below answers it.
  try {
    await getNextly({ config });
  } catch {
    return { status: 503, error: "Nextly is not available yet." };
  }
  const session = await getSession(request, secret);
  if (!session.authenticated) {
    return { status: 401, error: "Authentication required." };
  }
  return null;
}

export async function HEAD(request: Request): Promise<Response> {
  // HEAD is the "is this endpoint here, and if so for which template"
  // probe. Auth check still runs so unauthenticated probes get 401 (the
  // dashboard treats 200/401/403 as "endpoint exists").
  const guard = await ensureSuperAdmin(request);
  if (guard) {
    return new Response(null, { status: guard.status });
  }
  // Authenticated but not super-admin: still 403 so non-super-admin
  // users don't see the seed card.
  try {
    const nextly = await getNextly({ config });
    const session = await getSession(request, process.env.NEXTLY_SECRET ?? "");
    if (session.authenticated && !(await isSuperAdmin(session.user.id))) {
      return new Response(null, { status: 403 });
    }
    void nextly;
  } catch {
    // If Nextly isn't initialised yet, signal unavailable rather than 500
    // (the dashboard treats this the same as endpoint-missing).
    return new Response(null, { status: 503 });
  }
  return new Response(null, {
    status: 200,
    headers: {
      "X-Nextly-Seed-Template": TEMPLATE_SLUG,
      "X-Nextly-Seed-Template-Label": TEMPLATE_LABEL,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.NEXTLY_SECRET;
  if (!secret) {
    return Response.json(
      { errors: [{ message: "Server configuration error." }] },
      { status: 500 }
    );
  }

  // Initialised before the session is read, for the reason given in
  // `ensureSuperAdmin` above.
  try {
    await getNextly({ config });
  } catch {
    return Response.json(
      { errors: [{ message: "Nextly is not available yet." }] },
      { status: 503 }
    );
  }
  const session = await getSession(request, secret);
  if (!session.authenticated) {
    return Response.json(
      { errors: [{ message: "Authentication required." }] },
      { status: 401 }
    );
  }

  try {
    const nextly = await getNextly({ config });

    if (!(await isSuperAdmin(session.user.id))) {
      return Response.json(
        {
          errors: [
            { message: "You don't have permission to perform this action." },
          ],
        },
        { status: 403 }
      );
    }

    // Claims the site's one load, loads, and records the outcome; refused
    // with nothing loaded when another load or an answer got there first.
    return await sampleContentPost(request, {
      store: nextly.meta,
      by: session.user.id,
      load: () => seed({ nextly, config }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] route handler failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}
