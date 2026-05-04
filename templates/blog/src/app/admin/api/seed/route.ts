/**
 * HEAD/POST /admin/api/seed — Auth-gated demo content seeder.
 *
 * HEAD is used by the admin dashboard SeedDemoContentCard to probe
 * whether seeding is available for the current project (which template
 * is shipped). Returns 200 + X-Nextly-Seed-Template* headers when an
 * authenticated super-admin asks. 401/403 still indicate the endpoint
 * exists; the dashboard treats those as "auth issue" rather than
 * "feature missing." 404 (route not present) means the template
 * doesn't ship a seed at all (e.g., blank template).
 *
 * POST runs the three-phase seed (see src/endpoints/seed/index.ts) and
 * writes seed.completedAt to nextly_meta on success so the dashboard
 * card hides on next probe. Returns the full SeedResult so the card
 * can render success summary / partial-success warnings.
 *
 * Why a POST and not boot-time magic: prior versions of the blog
 * template ran the seed automatically when `next dev` first registered
 * services. That path silently failed when the cached Nextly singleton
 * was bootstrapped without `{ config }`, leaving users with an empty
 * database and no clear error. Moving to an explicit user action
 * eliminates the ordering fragility and gives us a place to surface
 * success / error toasts.
 */

import { getNextly } from "@revnixhq/nextly";
import { getSession, isSuperAdmin } from "@revnixhq/nextly/auth";
import config from "@nextly-config";

import { seed } from "@/endpoints/seed";

const TEMPLATE_SLUG = "blog";
const TEMPLATE_LABEL = "Blog";

interface MetaServiceLike {
  set(key: string, value: unknown): Promise<void>;
}

async function ensureSuperAdmin(
  request: Request
): Promise<{ status: number; error: string } | null> {
  const secret = process.env.NEXTLY_SECRET;
  if (!secret) {
    return { status: 500, error: "Server configuration error." };
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

    const result = await seed({ nextly });

    // Persist completedAt so the dashboard card hides on next probe.
    // Best-effort: a meta-write failure should NOT mask a successful
    // seed. We surface it as a warning and let the card auto-hide via
    // its in-memory state instead.
    try {
      const meta = (
        nextly as unknown as { container: { get: <T>(name: string) => T } }
      ).container.get<MetaServiceLike>("metaService");
      await meta.set("seed.completedAt", new Date().toISOString());
    } catch (metaErr) {
      const m = metaErr instanceof Error ? metaErr.message : String(metaErr);
      result.warnings.push(`could not record seed.completedAt: ${m}`);
    }

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] route handler failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}
