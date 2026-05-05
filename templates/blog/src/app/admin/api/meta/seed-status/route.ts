/**
 * GET/PUT /admin/api/meta/seed-status — Auth-gated read/write of the
 * `seed.completedAt` and `seed.skippedAt` flags in the `nextly_meta`
 * table. Used by the admin dashboard's SeedDemoContentCard to decide
 * whether to render itself.
 *
 * Pattern B (project-local) route, mirroring the seed route at
 * src/app/admin/api/seed/route.ts. See findings/02-meta-routes-pattern-deviation.md.
 *
 * Both verbs require a super-admin session. Body shape on PUT:
 *   { completedAt?: string }   — sets seed.completedAt
 *   { skippedAt?:   string }   — sets seed.skippedAt
 * Either or both may be set in one call.
 */

import { getNextly } from "@revnixhq/nextly";
import { getSession, isSuperAdmin } from "@revnixhq/nextly/auth";
import config from "@nextly-config";

const META_KEYS = {
  seedCompletedAt: "seed.completedAt",
  seedSkippedAt: "seed.skippedAt",
} as const;

interface MetaServiceLike {
  get<T = unknown>(key: string): Promise<T | null>;
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
  if (!(await isSuperAdmin(session.user.id))) {
    return { status: 403, error: "Super-admin role required." };
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const guard = await ensureSuperAdmin(request);
  if (guard) {
    return Response.json(
      { errors: [{ message: guard.error }] },
      { status: guard.status }
    );
  }

  try {
    const nextly = await getNextly({ config });
    const meta = nextly.container.get<MetaServiceLike>("metaService");
    const completedAt = await meta.get<string>(META_KEYS.seedCompletedAt);
    const skippedAt = await meta.get<string>(META_KEYS.seedSkippedAt);
    return Response.json({
      completedAt: completedAt ?? null,
      skippedAt: skippedAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta/seed-status GET] failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  const guard = await ensureSuperAdmin(request);
  if (guard) {
    return Response.json(
      { errors: [{ message: guard.error }] },
      { status: guard.status }
    );
  }

  let body: { completedAt?: string; skippedAt?: string };
  try {
    body = (await request.json()) as {
      completedAt?: string;
      skippedAt?: string;
    };
  } catch {
    return Response.json(
      { errors: [{ message: "Invalid JSON body." }] },
      { status: 400 }
    );
  }

  try {
    const nextly = await getNextly({ config });
    const meta = nextly.container.get<MetaServiceLike>("metaService");

    if (typeof body.completedAt === "string") {
      await meta.set(META_KEYS.seedCompletedAt, body.completedAt);
    }
    if (typeof body.skippedAt === "string") {
      await meta.set(META_KEYS.seedSkippedAt, body.skippedAt);
    }

    return Response.json({ message: "Seed status updated." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[meta/seed-status PUT] failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}
