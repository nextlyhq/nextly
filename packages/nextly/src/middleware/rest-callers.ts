/**
 * How the REST limit tells who is asking: by the credential authentication
 * itself uses, a session that verifies first, then an API key.
 *
 * Kept apart from the limit so the limit can be driven with readers of a
 * test's own, and so the session reader is loaded only when a request first
 * needs it.
 *
 * @module middleware/rest-callers
 */
import { apiKeyRateLimitRefusal } from "../auth/middleware/api-key-budget";
import { createJsonErrorResponse } from "../auth/middleware/error-response";
import { container } from "../di/container";
import type {
  ApiKeyRefusalCause,
  ApiKeyService,
} from "../domains/auth/services/api-key-service";

import type { ResolvedApiKey } from "./rest-limit-gate";

/** What the REST limit asks of authentication. */
export interface RestCallerReaders {
  /** The user whose session the request carries, when it verifies. */
  sessionUser(request: Request): Promise<string | null>;
  /**
   * Look a presented key up: the key, `null` when it does not resolve, or
   * `undefined` when nothing could be asked. Why a key does not resolve is
   * told to `onRefused`.
   */
  lookupKey(
    rawKey: string,
    onRefused?: (cause: ApiKeyRefusalCause) => void
  ): Promise<ResolvedApiKey | undefined>;
  /** Spend a resolved key's own budget: its refusal once spent. */
  debitKey(keyId: string, request: Request): Promise<Response | null>;
}

/**
 * The API key a request presents, as `Authorization: Bearer <key>`, or `null`.
 *
 * The one reading of the header, so the limit and authentication agree on
 * which requests carry a key.
 */
export function presentedApiKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const rawKey = header.slice("Bearer ".length).trim();
  return rawKey === "" ? null : rawKey;
}

/**
 * The user whose session verifies, as every session reader verifies it: the
 * signature, the expiry and the account's revocation, through `getSession`.
 * A read that fails is no session: the request then spends the budget of
 * one carrying none, and its handler meets the same failure.
 */
async function verifiedSessionUser(request: Request): Promise<string | null> {
  const { getSession } = await import("../auth/session/get-session");
  const { env } = await import("../lib/env");
  try {
    const session = await getSession(request, env.NEXTLY_SECRET || "");
    return session.authenticated ? session.user.id : null;
  } catch {
    return null;
  }
}

function registeredApiKeyService(): ApiKeyService | undefined {
  try {
    return container.has("apiKeyService")
      ? container.get<ApiKeyService>("apiKeyService")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The readers the REST entry point uses.
 *
 * @param ready - Starts the services a key lookup needs, where something can.
 *   Called only for a request presenting a key while no key service is
 *   registered, which the route would start them for next anyway.
 */
export function defaultRestCallerReaders(
  ready?: () => Promise<void>
): RestCallerReaders {
  return {
    sessionUser: verifiedSessionUser,
    async lookupKey(rawKey, onRefused) {
      try {
        // Started only when nothing is registered yet. A running process
        // answers with the services it has, as authentication does: asking a
        // boot of a process already up can re-register its services in
        // development, under the key being looked up.
        let service = registeredApiKeyService();
        if (!service && ready) {
          await ready();
          service = registeredApiKeyService();
        }
        return service
          ? await service.authenticateApiKey(rawKey, onRefused)
          : undefined;
      } catch {
        // Not a verdict on the key: authentication asks again and answers.
        return undefined;
      }
    },
    async debitKey(keyId, request) {
      const refusal = await apiKeyRateLimitRefusal(keyId);
      return refusal ? createJsonErrorResponse(refusal, request) : null;
    },
  };
}
