/**
 * Advisory document locking over HTTP.
 *
 * Four operations on one document: read who holds it, claim it, extend a claim,
 * give it up. Advisory throughout — a held document is reported and no write is
 * refused anywhere, so a claim left behind by a closed laptop costs a second
 * editor a dialog rather than access.
 *
 * Claiming carries one optional extra rather than a fifth operation: a caller
 * that is refused may say it is still waiting, which leaves a mark on the row
 * for the holder's own heartbeat to find. It rides the claim because the
 * locked-out editor is already sending one on every beat. It is a courtesy and
 * not a consent gate — nothing about it moves the document, and the lease
 * expiring stays the only thing that does.
 *
 * The claimant is taken from the SESSION, never from the body. A caller that
 * could name its own owner id could claim a document as a colleague, and the
 * label shown to the next editor would be evidence of something that did not
 * happen.
 *
 * @module api/document-lock
 */

import type { ReadAccessCaller } from "../auth/code-access";
import {
  callerHoldsPermission,
  entityReadFor,
  readAccessCaller,
} from "../auth/entity-read-access";
import {
  authorizeCaller,
  isErrorResponse,
  requireAuthentication,
  type AuthContext,
} from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { actorFromAuthContext } from "../auth/request-actor";
import { container } from "../di/container";
import {
  documentLockKey,
  type DocumentLockService,
  type DocumentRef,
  type DocumentScopeKind,
} from "../domains/document-lock";
import {
  changeSinceHeldVersion,
  heldVersionOf,
} from "../domains/document-lock/held-version";
import { peopleById } from "../domains/versions/author-hydration";
import type { DecodedVersion } from "../domains/versions/stale-version";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { getNextlyLogger } from "../observability/logger";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondData, respondMutation } from "./response-shapes";
import {
  assertDocumentUpdatable,
  assertVersionDocumentReadable,
} from "./versions-access";
import { withErrorHandler } from "./with-error-handler";

/**
 * What the next editor is told holds the document: a person by their name,
 * else their email; an API key as one, by its maker's name where they have
 * one; and, when nothing names the caller, "Someone". Never empty, so no lock
 * message can read "null is editing this document".
 *
 * A key is named as a key rather than as its maker, because a script holding
 * a document is not its maker sitting at it, and the person asked to let go
 * should know which of the two they are waiting on. The maker's name is read
 * through `peopleById`, the one lookup that names a person, and only for a
 * key: a session already carries it.
 *
 * 🔴 A key's label is cut to fit the lock row's label column. The column is as
 * wide as the widest name, and the suffix makes a long name's label wider, so
 * uncut it failed the claim on PostgreSQL and MySQL while SQLite stored it.
 * Cut by code point, so no character is split in half.
 *
 * Names are trimmed first: a name of spaces is no name, and would otherwise
 * read "'s API key" or a blank where the holder belongs.
 */
async function holderLabel(auth: AuthContext): Promise<string> {
  if (auth.authMethod === "api-key") {
    const maker = (await peopleById([auth.userId]))
      .get(auth.userId)
      ?.name?.trim();
    if (!maker) return "An API key";
    const suffix = "'s API key";
    const room = OWNER_LABEL_LENGTH - suffix.length;
    return `${Array.from(maker).slice(0, room).join("")}${suffix}`;
  }
  return auth.userName?.trim() || auth.userEmail?.trim() || "Someone";
}

/**
 * The lock row's `owner_label` column width on PostgreSQL and MySQL
 * (`schemas/document-lock`), which a stored label must fit.
 */
const OWNER_LABEL_LENGTH = 255;

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
 * fact that they are editing it are both facts about a document. Claiming and
 * renewing need UPDATE, because a lock is a statement that you are editing, and
 * someone who cannot edit is not.
 *
 * A claim's UPDATE is asked exactly as the REST update of the document asks
 * it (`authorizeCaller`, the route gate's decision): an API key must hold the
 * grant AND pass the collection's or Single's own `update` rule. A key judged
 * on its grant alone could claim, and take over, a document whose rule refuses
 * it every edit. The document gate below is then told the route ran, which is
 * true, because the same question has just been asked.
 *
 * 🔴 UPDATE means THIS document, not documents of this kind. `update-<slug>` is
 * the coarse route permission and says only the latter, so a document the caller
 * cannot actually load — a draft they may not see, a row that is gone — is
 * refused by the read path while that permission still stands. Without the
 * second gate a caller claims a document every real update denies them, and the
 * real editor is then shown a false holder and pushed to take over their own
 * row. The gate the version routes already use runs here, for the reason its
 * own docblock gives.
 *
 * A release stops at the grant alone, because it is the opposite statement:
 * that this editor has STOPPED editing. The document gate reads the row, so
 * the holder's own save can flip its answer mid-claim, and a code rule can
 * change while the claim is held; asking either on the way out would refuse
 * the departing editor's own DELETE and strand the claim until its lease
 * lapsed, leaving colleagues a holder who has already left. What a release actually rests on is the claim token, which names the one
 * acquisition being given up and fences the DELETE itself.
 *
 * Both gates are entity-generic and read the collection and single maps
 * alike, so a Single needs no branch here, and both delegate to the canonical
 * machinery rather than reproducing the API-key and super-admin rules that
 * `canReadEntity` documents at length.
 *
 * Answers the caller as the gates read it, so what a claim is told about the
 * document afterwards is judged for the same caller.
 */
async function authorize(
  auth: AuthContext,
  ref: DocumentRef,
  intent: "read" | "claim" | "release"
): Promise<Awaited<ReturnType<typeof readCaller>>> {
  const authenticated = await readCaller(auth);
  const caller = readAccessCaller(authenticated);
  if (intent === "claim") {
    // The update gate's own refusal, in the words it names the thing with:
    // the one document the claim names, as "this post". It names only what
    // the request already named, so it does not answer whether it exists.
    const decision = await authorizeCaller(
      auth,
      "update",
      ref.slug,
      ref.entryId ? "one" : "all"
    );
    if (isErrorResponse(decision)) throw toNextlyAuthError(decision);
  }
  const allowed =
    intent === "read"
      ? await mayReadDocument(ref, caller, authenticated)
      : intent === "claim" ||
        (await callerHoldsPermission(`update-${ref.slug}`, caller));

  if (!allowed) {
    // The same refusal either way. Distinguishing "no such document" from "not
    // yours" would answer whether a slug exists to someone with no access to it.
    throw NextlyError.forbidden({
      logContext: { slug: ref.slug, scopeKind: ref.scopeKind, intent },
    });
  }

  if (intent === "claim") {
    // Route authorization has just run, so the coarse re-check is skipped and
    // what runs here is the stored per-document rules this gate exists for.
    await assertDocumentUpdatable(
      ref.scopeKind,
      ref.slug,
      ref.entryId,
      authenticated.user,
      authenticated.authenticatedScope
    );
  }
  return authenticated;
}

/**
 * What a claim or renewal that named the version its copy started from is told
 * changed since: added to an answer that holds the document, and only then. A
 * refused or lost claim holds nothing to save from, and a caller that named no
 * version is answered as before, with no read of the document.
 *
 * Who and when are told only to a caller who may read the document, asked of
 * this caller by the read gate a refused save asks.
 */
async function withChange<T extends { status: string }>(
  outcome: T,
  holds: T["status"],
  ref: DocumentRef,
  held: DecodedVersion | undefined,
  authenticated: Awaited<ReturnType<typeof readCaller>>
): Promise<T> {
  if (held === undefined || outcome.status !== holds) return outcome;
  try {
    const changed = await changeSinceHeldVersion(ref, held, {
      user: authenticated.user,
      trusted: false,
      authenticatedScope: authenticated.authenticatedScope,
    });
    return changed === undefined ? outcome : { ...outcome, changed };
  } catch (error) {
    // 🔴 The claim or renewal has already committed: answered without the
    // change rather than as an error, so its token still reaches the editor,
    // which can renew and release it. An answer it never saw would leave a
    // lease it cannot see renewing, held against its colleagues.
    getNextlyLogger().warn({
      op: "document-lock-change-read-failed",
      message: "Could not tell a holder what changed; answered without it.",
      error: error instanceof Error ? error.message : String(error),
    });
    return outcome;
  }
}

/**
 * Whether the caller may read the document the lock names. A caller whose
 * read rule allows only the entries a filter matches may read this lock only
 * where the document is one of them, asked of the document by id; every
 * other caller is judged by the collection, as before.
 */
async function mayReadDocument(
  ref: DocumentRef,
  caller: ReadAccessCaller,
  authenticated: Awaited<ReturnType<typeof readCaller>>
): Promise<boolean> {
  const read = await entityReadFor(ref.slug, caller);
  if (read.allowed) return true;
  if (read.filter === undefined) return false;
  try {
    // The document read the entity reader's answer lets run, which applies
    // the filter it kept for the request.
    await assertVersionDocumentReadable(
      ref.scopeKind,
      ref.slug,
      ref.entryId,
      authenticated.user,
      authenticated.authenticatedScope
    );
    return true;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return false;
    throw error;
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

/**
 * What a claim and a renewal both read before they act: the caller, the body,
 * the document, the version the caller's copy started from, and the caller as
 * the gates judged them.
 *
 * The version is read before anything is claimed or renewed, so a malformed
 * one is refused without displacing anybody.
 */
async function claimRequest(req: Request) {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const body = await readBody(req);
  const ref = readRef(body);
  const held = heldVersionOf(body);
  const authenticated = await authorize(auth, ref, "claim");
  return { auth, body, ref, held, authenticated };
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
 * displaced holder is told either way. A takeover that displaces somebody is
 * recorded in the document's history, and refused if it cannot be.
 */
export const acquireLock = withErrorHandler(async (req: Request) => {
  const { auth, body, ref, held, authenticated } = await claimRequest(req);

  const acquired = await (
    await getDocumentLockService()
  ).acquire(
    ref,
    {
      ownerId: auth.userId,
      ownerLabel: await holderLabel(auth),
      // What a takeover's history event credits: the key itself for an API
      // key, and the person by name only, never by the email above.
      actor: actorFromAuthContext(auth),
      personName: auth.userName ?? null,
    },
    {
      takeover: body.takeover === true,
      // Read the same way `takeover` is, and for the same reason: anything
      // other than the boolean is not a person asking for anything.
      requestAccess: body.requestAccess === true,
    }
  );
  const outcome = await withChange(
    acquired,
    "acquired",
    ref,
    held,
    authenticated
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
  const { body, ref, held, authenticated } = await claimRequest(req);

  const outcome = await withChange(
    await (await getDocumentLockService()).renew(ref, readClaimToken(body)),
    "renewed",
    ref,
    held,
    authenticated
  );

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
  await authorize(auth, ref, "release");

  await (await getDocumentLockService()).release(ref, readClaimToken(body));

  return respondMutation("Claim released.", { released: true });
});
