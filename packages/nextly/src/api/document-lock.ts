/**
 * Advisory document locking over HTTP.
 *
 * Four operations on one document: read who holds it, claim it, extend a claim,
 * give it up. Advisory throughout — a held document is reported and no write is
 * refused anywhere, so a claim left behind by a closed laptop costs a second
 * editor a dialog rather than access.
 *
 * The claimant is taken from the SESSION, never from the body. A caller that
 * could name its own owner id could claim a document as a colleague, and the
 * label shown to the next editor would be evidence of something that did not
 * happen.
 *
 * @module api/document-lock
 */

import {
  callerHoldsPermission,
  canReadEntity,
  readAccessCaller,
} from "../auth/entity-read-access";
import {
  isErrorResponse,
  requireAuthentication,
  type AuthContext,
} from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di/container";
import {
  documentLockKey,
  type DocumentLockService,
  type DocumentRef,
  type DocumentScopeKind,
} from "../domains/document-lock";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondData, respondMutation } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

async function getDocumentLockService(): Promise<DocumentLockService> {
  await getCachedNextly();
  return container.get<DocumentLockService>("documentLockService");
}

const SCOPE_KINDS = new Set<string>(["collection", "single"]);

/**
 * Read a document reference from whatever the request carries.
 *
 * Validated through `documentLockKey`, the same function the repository keys
 * rows with, rather than by a second set of rules here. A slug carrying the
 * separator, or a pair too long for the column, has to be refused identically
 * in both places or a reference this accepts becomes a row nothing can address.
 */
function readRef(source: {
  scopeKind?: unknown;
  slug?: unknown;
  entryId?: unknown;
}): DocumentRef {
  const { scopeKind, slug, entryId } = source;
  if (
    typeof scopeKind !== "string" ||
    !SCOPE_KINDS.has(scopeKind) ||
    typeof slug !== "string" ||
    typeof entryId !== "string" ||
    documentLockKey(scopeKind as DocumentScopeKind, slug, entryId) === undefined
  ) {
    throw NextlyError.validation({
      errors: [
        {
          path: "document",
          code: "invalid_document_ref",
          message:
            "A document lock needs a scopeKind of collection or single, plus a slug and entryId that are non-empty, free of ':' and short enough to key a row.",
        },
      ],
    });
  }
  return { scopeKind: scopeKind as DocumentScopeKind, slug, entryId };
}

/**
 * Whether this caller may see, or take, a claim on this document.
 *
 * Authentication is not enough. This route is direct-dispatched, so it never
 * reaches the central authorization path, and without this any signed-in
 * account or scoped API key could read who is editing a document it cannot
 * open, claim rows it has no business in, or use `takeover` to displace a
 * colleague's claim on a collection it was never granted.
 *
 * Reading a lock needs READ on the document, because the holder's name and the
 * fact that they are editing it are both facts about a document. Claiming,
 * renewing and releasing need UPDATE, because a lock is a statement that you
 * are editing, and someone who cannot edit is not.
 *
 * Both helpers are entity-generic and read the collection and single maps
 * alike, so a Single needs no branch here, and both delegate to the canonical
 * machinery rather than reproducing the API-key and super-admin rules that
 * `canReadEntity` documents at length.
 */
async function authorize(
  auth: AuthContext,
  ref: DocumentRef,
  intent: "read" | "write"
): Promise<void> {
  const caller = readAccessCaller(await readCaller(auth));
  const allowed =
    intent === "read"
      ? await canReadEntity(ref.slug, caller)
      : await callerHoldsPermission(`update-${ref.slug}`, caller);

  if (!allowed) {
    // The same refusal either way. Distinguishing "no such document" from "not
    // yours" would answer whether a slug exists to someone with no access to it.
    throw NextlyError.forbidden({
      logContext: { slug: ref.slug, scopeKind: ref.scopeKind, intent },
    });
  }
}

/** The claim token a renew or release must present. */
function readClaimToken(body: { claimToken?: unknown }): string {
  const { claimToken } = body;
  if (typeof claimToken !== "string" || claimToken === "") {
    throw NextlyError.validation({
      errors: [
        {
          path: "claimToken",
          code: "required",
          message:
            "A claim token is required: renewing and releasing prove they are the same claim, not merely the same person.",
        },
      ],
    });
  }
  return claimToken;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  // Parsed and inspected separately. Wrapping the shape check in the same
  // `try` would make a rejection of it indistinguishable from malformed JSON,
  // and the repository's own convention is that a refusal carries a code the
  // caller can act on rather than a bare throw the API layer reads as a 500.
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    parsed = undefined;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "body",
          code: "invalid_json",
          message: "Expected a JSON object body.",
        },
      ],
    });
  }
  return parsed as Record<string, unknown>;
}

/** Who holds this document, if anyone still does. */
export const readLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const url = new URL(req.url);
  const ref = readRef({
    scopeKind: url.searchParams.get("scopeKind") ?? undefined,
    slug: url.searchParams.get("slug") ?? undefined,
    entryId: url.searchParams.get("entryId") ?? undefined,
  });

  await authorize(auth, ref, "read");

  const holder = await (await getDocumentLockService()).read(ref);
  // `null` rather than an omitted key: "nobody holds this" is the answer, and a
  // missing field reads as a response that failed to say.
  // Shaped by WHO asked, and it names a colleague and what they are doing, so
  // it must not sit in a shared cache or be replayed to the next session.
  return respondData(
    { holder: holder ?? null },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});

/**
 * Claim a document, or report who already has it.
 *
 * `takeover` is the second editor deciding to edit anyway. It is accepted from
 * any authenticated caller because the lock is advisory: refusing the takeover
 * would not stop them editing, it would only stop them saying so, and the
 * displaced holder is told either way.
 */
export const acquireLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  const ref = readRef(body);
  await authorize(auth, ref, "write");

  const outcome = await (
    await getDocumentLockService()
  ).acquire(
    ref,
    {
      ownerId: auth.userId,
      ownerLabel: auth.userName ?? auth.userEmail ?? null,
    },
    { takeover: body.takeover === true }
  );

  // The canonical mutation envelope, so a client reads this with the same
  // handling as every other write. The outcome IS the item: "held" is an
  // answer about the document, not a failure of the request.
  return respondMutation(
    outcome.status === "acquired"
      ? "Document claimed."
      : "Document is being edited by someone else.",
    outcome
  );
});

/** Extend a claim this caller still believes it holds. */
export const renewLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  const ref = readRef(body);
  await authorize(auth, ref, "write");

  const outcome = await (
    await getDocumentLockService()
  ).renew(ref, readClaimToken(body));

  return respondMutation(
    outcome.status === "renewed" ? "Claim extended." : "Claim lost.",
    outcome
  );
});

/** Give up a claim. Releasing one already lost is not an error. */
export const releaseLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  const ref = readRef(body);
  await authorize(auth, ref, "write");

  await (await getDocumentLockService()).release(ref, readClaimToken(body));

  return respondMutation("Claim released.", { released: true });
});
