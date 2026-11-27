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
 * @experimental With the AI contract.
 * @module api/ai-status
 */
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { aiService } from "../domains/ai/ai-wiring";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondDoc } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

export const getAIStatus = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  // Per caller and changed by a switch or a setting at any time, so never
  // cached anywhere.
  return respondDoc(await aiService().status(auth), {
    headers: PRIVATE_NO_STORE_HEADERS,
  });
});
