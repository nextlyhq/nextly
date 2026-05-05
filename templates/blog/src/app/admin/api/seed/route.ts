/**
 * POST /admin/api/seed — Auth-gated demo content seeder.
 *
 * Mirrors Payload's seed-button pattern (`templates/website/src/app/
 * (payload)/next/seed/route.ts`). The user clicks "Seed demo content"
 * on /welcome (or any page that POSTs here); we verify the caller has
 * a valid super-admin session, then invoke the Payload-style `seed`
 * function from src/endpoints/seed/index.ts.
 *
 * Why a POST route and not boot-time magic: prior versions of the
 * blog template ran the seed automatically when `next dev` first
 * registered services. That path silently failed when the cached
 * Nextly singleton was bootstrapped without `{ config }`, leaving
 * users with an empty database and no clear error. Moving to an
 * explicit user action eliminates the ordering fragility and gives
 * us a place to surface success / error toasts. See task 24
 * phase 3 for the full design.
 */

import { getNextly } from "@revnixhq/nextly";
import { getSession, isSuperAdmin } from "@revnixhq/nextly/auth";
import config from "@nextly-config";

import { seed } from "@/endpoints/seed";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.NEXTLY_SECRET;
  if (!secret) {
    // Configuration error rather than auth error — surface it so the
    // operator can fix env. Body is intentionally generic for the wire.
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

  // Demo seeding is a destructive setup-time action, so we require the
  // canonical super-admin role rather than any custom role with broad
  // collection permissions. Roles seeded by the template (admin /
  // editor / author) intentionally do NOT grant this. We initialise
  // Nextly first so `isSuperAdmin` can read from the live DB.
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
    await seed({ nextly });
    return Response.json({ message: "Demo content seeded." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[seed] route handler failed:", err);
    return Response.json({ errors: [{ message }] }, { status: 500 });
  }
}
