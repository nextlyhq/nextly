/**
 * `GET /api/ai/status`: whether AI is configured on this site, which model
 * roles have a model, which of the three AI permissions the caller holds, and
 * which tasks they may run.
 *
 * What the admin asks before drawing any AI control, and what a plugin or an
 * agent asks before offering one. Any signed-in caller may ask, a person or
 * an API key: the answer is about the caller, judged on their own grants, and
 * says nothing about providers, models or keys. The check is here, in the
 * route, not left to middleware.
 *
 * `?collection=<slug>&id=<entry>` asks about one piece of content: each task
 * is then available only where the caller may read it, and edit it where
 * the task writes its result, as its run would be judged.
 *
 * @experimental With the AI contract.
 * @module api/ai-status
 */
import { z } from "zod";

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import type { AIRunTarget } from "../domains/ai/ai-contract";
import { aiService } from "../domains/ai/ai-wiring";
import { NextlyError } from "../errors/nextly-error";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondDoc } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/** The content a status may be asked about: a slug, and optionally an entry. */
const targetQuery = z
  .object({
    collection: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_-]+$/)
      .optional(),
    id: z.string().min(1).max(200).optional(),
  })
  .refine(q => q.id === undefined || q.collection !== undefined);

/** The target the query names, or none; a malformed one is refused. */
function targetOf(params: URLSearchParams): AIRunTarget | undefined {
  const parsed = targetQuery.safeParse({
    collection: params.get("collection") ?? undefined,
    id: params.get("id") ?? undefined,
  });
  if (!parsed.success) {
    throw NextlyError.invalidInput({
      message:
        "`collection` must be a collection or Single's slug, and `id` needs a `collection`.",
    });
  }
  const { collection, id } = parsed.data;
  if (collection === undefined) return undefined;
  return id === undefined ? { collection } : { collection, id };
}

export const getAIStatus = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  const target = targetOf(new URL(req.url).searchParams);
  // Per caller and changed by a switch or a setting at any time, so never
  // cached anywhere.
  return respondDoc(await aiService().status(auth, { target }), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});
