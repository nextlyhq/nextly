/**
 * `/api/dashboard/new-types`: the collections the signed-in person last
 * created entries of, for the dashboard's New button.
 *
 *   GET  /api/dashboard/new-types   their recent types they may still create in
 *   POST /api/dashboard/new-types   record `{ slug }` as their most recent type
 *
 * The person is always the signed-in user, never a parameter, and an API key
 * is refused: the list is a person's own. Whether they may create in a
 * collection is the admin's own question of them, `createInDefaultLanguage`:
 * a create sent from New names no language, so it writes the default one, and
 * a rule that answers by language is asked in that one.
 *
 * @module api/dashboard-new-types
 * @experimental Until the dashboard's New button is built on it.
 */
import { z } from "zod";

import { createsInDefaultLanguage } from "../auth/access/route-gate-adapters";
import { getRBACService } from "../auth/code-access";
import { capabilityLanguageOf, type AuthContext } from "../auth/middleware";
import { NextlyError } from "../errors/nextly-error";
import {
  type MayCreate,
  NEW_TYPES_KEPT,
  newTypesService,
} from "../services/dashboard/new-types-service";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { readBoundedJsonBody } from "./read-json-body";
import { respondAction, respondList } from "./response-shapes";
import { signedInPerson } from "./signed-in-person";
import { withErrorHandler } from "./with-error-handler";

/** A body names one slug; nothing larger is a real one. */
const MAX_BODY_BYTES = 1024;

const recordBody = z.object({ slug: z.string().min(1).max(191) }).strict();

/**
 * Whether the signed-in person may create entries of a collection, as the
 * create New opens is judged: the same cell the admin reads to offer it. The
 * cell's request names no language, so the caller's own is not asked for.
 */
function mayCreateFor(auth: AuthContext): MayCreate {
  const caller = { userId: auth.userId };
  const rules = getRBACService();
  const languageOf = capabilityLanguageOf("");
  return slug => createsInDefaultLanguage(caller, slug, rules, languageOf);
}

export const getDashboardNewTypes = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have a New type");
  const recent = await newTypesService().recent(
    auth.userId,
    mayCreateFor(auth)
  );
  return respondList(
    recent.map(slug => ({ slug })),
    {
      total: recent.length,
      page: 1,
      // One page holds every type the list keeps.
      limit: NEW_TYPES_KEPT,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});

export const postDashboardNewType = withErrorHandler(async (req: Request) => {
  const auth = await signedInPerson(req, "have a New type");
  const parsed = recordBody.safeParse(
    await readBoundedJsonBody(req, MAX_BODY_BYTES, {
      route: "dashboard-new-types",
    })
  );
  if (!parsed.success) {
    throw NextlyError.invalidInput({ message: "The body must be `{ slug }`." });
  }
  const recent = await newTypesService().record(
    auth.userId,
    parsed.data.slug,
    mayCreateFor(auth)
  );
  return respondAction("Recorded.", { recent });
});
