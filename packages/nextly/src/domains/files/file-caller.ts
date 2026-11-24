/**
 * Who is asking a file route, and how they are judged.
 *
 * Two kinds of caller reach a collection's files, and both are judged by the
 * one access decision every other way in uses:
 *
 * - **Staff and API keys**, recognised as every built-in route recognises
 *   them (`requireRouteAuthentication`), and handed to the collection services
 *   with their role set and, for a key, the key's own scope (`readCaller`), so
 *   a scoped key is judged by its scope and never as the person who made it.
 * - **A plugin-defined signed-in person**, of a kind the collection names in
 *   `files.principals`, recognised through the kind's own resolver and run as
 *   (`runAsPrincipal`), where the collection's rules alone decide.
 *
 * A request carrying a staff credential is judged as staff. A person is looked
 * for only when none is present, and only of the kinds the collection names,
 * so no staff path ever resolves a person and a collection that names no kind
 * is closed to every person.
 *
 * A write from another site is refused before anyone is recognised: the
 * session cookies of both kinds travel with any request the browser makes,
 * so a cookie-carried write must come from this site or an allowed origin. A
 * `Bearer` token, which another site cannot make the browser send, is exempt.
 *
 * @module domains/files/file-caller
 */
import { readCaller } from "../../api/authenticated-read";
import { requireRouteAuthentication } from "../../api/route-auth";
import { readAccessTokenCookie } from "../../auth/cookies/access-token-cookie";
import {
  carriesBearerToken,
  isUnsafeMethod,
  validateOrigin,
} from "../../auth/csrf/validate";
import { runAsPrincipal } from "../../auth/principal-scope";
import {
  actorFromAuthContext,
  type RequestActor,
} from "../../auth/request-actor";
import { NextlyError } from "../../errors/nextly-error";
import { env } from "../../lib/env";
import { principalFromRequest } from "../../plugins/principals/recognise";
import type { Principal } from "../../plugins/principals/types";
import type { ReadCaller } from "../../services/dashboard/readable-resources";

/**
 * Who started an upload, as its entry records them: `user` and the person's
 * id for a staff session, `apiKey` and the key's id for an API key, or a
 * signed-in person's kind and id. Only the same caller may confirm it.
 */
export interface FileUploader {
  kind: string;
  id: string;
}

/** A caller of the file routes, ready to be judged. */
export type FileCaller =
  | {
      type: "staff";
      uploader: FileUploader;
      /** The person, or the key's maker for an API key. */
      userId: string;
      /** The person or key, with the key's own scope (`readCaller`). */
      read: ReadCaller;
      /** Who a write is recorded as. */
      actor: RequestActor;
    }
  | {
      type: "principal";
      uploader: FileUploader;
      principal: Principal;
    };

/**
 * Refuse a write another site could have made with this browser's cookies:
 * an unsafe method, carrying no `Bearer` token, from an origin that is
 * neither this site nor an allowed one. Asked before anyone is recognised.
 */
export function refuseCrossSiteWrite(request: Request): void {
  if (!isUnsafeMethod(request.method) || carriesBearerToken(request)) return;
  if (validateOrigin(request, env.NEXTLY_ALLOWED_ORIGINS_PARSED ?? [])) return;
  throw NextlyError.csrfFailed({
    logContext: { reason: "file-route-cross-site-write" },
  });
}

/** Whether the request carries a credential a staff route reads. */
function carriesStaffCredential(request: Request): boolean {
  return (
    request.headers.get("authorization") !== null ||
    readAccessTokenCookie(request) !== null
  );
}

/**
 * The caller of a file route on `request`: staff or an API key when it
 * carries their credential, else a signed-in person of one of `kinds`.
 * Refuses an unauthenticated request as every built-in route does.
 */
export async function fileCaller(
  request: Request,
  kinds: readonly string[]
): Promise<FileCaller> {
  if (carriesStaffCredential(request) || kinds.length === 0) {
    const auth = await requireRouteAuthentication(request);
    return {
      type: "staff",
      uploader:
        auth.authMethod === "api-key" && auth.apiKeyId !== undefined
          ? { kind: "apiKey", id: auth.apiKeyId }
          : { kind: "user", id: auth.userId },
      userId: auth.userId,
      read: await readCaller(auth),
      actor: actorFromAuthContext(auth),
    };
  }
  for (const kind of kinds) {
    const principal = await principalFromRequest(request, kind);
    if (principal !== null) {
      return {
        type: "principal",
        uploader: { kind: principal.kind, id: principal.id },
        principal,
      };
    }
  }
  throw NextlyError.authRequired({
    logContext: { reason: "file-route-no-caller" },
  });
}

/**
 * Run `operation` as `caller`: inside the person's frame for a signed-in
 * person, so every gate it reaches judges them; as is for staff, whose user
 * and scope `operation` passes to the services itself.
 */
export function asFileCaller<T>(
  caller: FileCaller,
  operation: () => Promise<T>
): Promise<T> {
  return caller.type === "principal"
    ? runAsPrincipal(caller.principal, operation)
    : runAsPrincipal(null, operation);
}

/** Whether `caller` is the one who started an upload recorded as `uploader`. */
export function isUploader(
  caller: FileCaller,
  uploader: { kind: unknown; id: unknown }
): boolean {
  return (
    caller.uploader.kind === uploader.kind && caller.uploader.id === uploader.id
  );
}
