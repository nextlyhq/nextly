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

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
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

import { respondData } from "./response-shapes";
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

  const holder = await (await getDocumentLockService()).read(ref);
  // `null` rather than an omitted key: "nobody holds this" is the answer, and a
  // missing field reads as a response that failed to say.
  return respondData({ holder: holder ?? null });
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

  return respondData({ ...outcome });
});

/** Extend a claim this caller still believes it holds. */
export const renewLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  const outcome = await (
    await getDocumentLockService()
  ).renew(readRef(body), readClaimToken(body));

  return respondData({ ...outcome });
});

/** Give up a claim. Releasing one already lost is not an error. */
export const releaseLock = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  await (
    await getDocumentLockService()
  ).release(readRef(body), readClaimToken(body));

  return respondData({ released: true });
});
