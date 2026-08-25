/**
 * Where a preview token sends the visitor.
 *
 * The preview route is handed a token scope — a collection, an entry id and
 * maybe a locale — and needs a site-relative path to forward to. Everything
 * required to answer that already exists: `resolvePreviewUrl` knows how both
 * authoring paths declare a preview, and the general settings hold the site
 * URL. What did not exist was anything joining them FROM AN ID, because the
 * admin's own preview button resolves from form data instead — it previews what
 * is on screen, including edits not yet saved, while a token names a stored
 * document and carries no values at all.
 *
 * Dependencies arrive as functions rather than being resolved here, so this
 * file is exercisable without a database — the same arrangement
 * `createPreviewRoute` uses for `draftMode`.
 *
 * @module domains/collections/services/preview-redirect-resolver
 */

import { NextlyError } from "../../../errors/nextly-error";

import {
  resolvePreviewUrl,
  type PreviewDeclaration,
} from "./preview-url-resolver";

/**
 * What reading the previewed document produced.
 *
 * `absent` and `unreadable` are SEPARATE because they are different diagnoses
 * with different remedies, and a loader that folds them together makes the
 * resolver confidently wrong about which happened. A read that fails on a
 * transient database error, a rate limit, or a throwing read hook says nothing
 * about whether the document exists — reporting it as "this may have been
 * deleted" tells an editor their work is gone when it is sitting there intact.
 *
 * The distinction has to be made HERE, by whoever performed the read, because
 * only they hold the service's failure envelope. Once it is a `null` the
 * information is gone and no amount of care downstream recovers it.
 */
export type PreviewDocumentRead =
  | { kind: "document"; document: Record<string, unknown> }
  /** The read succeeded and there is no such document. */
  | { kind: "absent" }
  /** The read itself failed, so whether the document exists is UNKNOWN. */
  | { kind: "unreadable" };

/**
 * A service ENVELOPE reduced to one of the three outcomes.
 *
 * One translator, called by every loader that reads through a service result,
 * because this is a single decision — which envelope means the document is
 * absent — and two copies of it agree only until one is edited. They would
 * then disagree about the SAME entry: the mint would hand out a link the route
 * refuses, or the two would diagnose one read differently. That the rule is
 * currently `statusCode === 404` is exactly why it belongs in one place; the
 * day it becomes the envelope's canonical code instead, it moves once.
 *
 * `undefined` data counts as absent alongside `null`: a success envelope that
 * carries no document is not a document, and a loader reading `data` off a
 * partially-populated result must not present that as one.
 */
export function readFromEnvelope(read: {
  success: boolean;
  statusCode?: number;
  /** Present only when a typed error was flattened into this envelope. */
  code?: string;
  data?: unknown;
}): PreviewDocumentRead {
  if (!read.success) {
    /*
     * A 404 alone does NOT establish absence, and `code` is what separates the
     * two. The service's own not-found branch returns a bare
     * `{ success: false, statusCode: 404, message: "Entry not found" }`, while
     * a THROWN NextlyError reaches this envelope through `errorEnvelopeFields`,
     * which always sets `code` — and an `afterRead` hook raising not-found for
     * a DEPENDENT lookup lands there with a 404 while the previewed row loaded
     * perfectly well. Reading that as absence tells an author their entry may
     * have been deleted because something it references was.
     *
     * Erring toward `unreadable` is the safe direction and STAYS safe if that
     * branch ever gains a code: absence becomes unreachable and every failure
     * reads as "could not be read", which is unhelpful rather than alarming.
     */
    return read.statusCode === 404 && read.code === undefined
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
  return read.data === null || read.data === undefined
    ? { kind: "absent" }
    : { kind: "document", document: read.data as Record<string, unknown> };
}

/**
 * A read whose failures arrive as THROWN errors, as one of the three outcomes.
 *
 * The Direct API does not hand back a failure envelope: `findSingle` throws for
 * every unsuccessful result. A loader that only checked for `null` therefore
 * never produced `absent` OR `unreadable` — the throw travelled past it and the
 * caller answered with a raw internal error instead of the refusal it had
 * carefully prepared.
 *
 * Written ONCE and shared by every caller with a throwing loader, because two
 * copies of "which status counts as absent" agree until one is edited. Only a
 * not-found is evidence of absence; anything else means the question went
 * unanswered, which is the same rule {@link readFromEnvelope} applies.
 */
export async function readOrReport(
  load: () => Promise<Record<string, unknown> | null>
): Promise<PreviewDocumentRead> {
  try {
    const document = await load();
    return document === null
      ? { kind: "absent" }
      : { kind: "document", document };
  } catch (error) {
    /*
     * The STRUCTURAL guard, not `instanceof`. The cached instance lives on
     * `globalThis` precisely because Next.js and Turbopack duplicate ESM
     * modules, so an error thrown by one copy of this package fails an
     * `instanceof` check performed in another — and a removed Single would then
     * be reported as a transient read failure, telling an author to retry
     * something that will never succeed.
     */
    return NextlyError.isNotFound(error)
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
}

/** What this resolver needs from the outside world. */
export interface PreviewRedirectDeps {
  /**
   * The entry the token names, and whether the read could answer at all.
   *
   * Read TRUSTED and with the lifecycle widened, because the caller is
   * anonymous: someone following a preview link has no session of their own.
   * The authorization happened when the link was minted, against the gate that
   * serves real reads, and the signed token is what carries that verdict
   * forward. Asking again here — against an anonymous caller — would deny every
   * preview, which is the whole capability.
   *
   * What this read produces is a PATH and never content. The content read is a
   * separate decision, made on the destination page by the draft gate, against
   * the row that page actually resolves.
   */
  loadEntry: (
    collection: string,
    entryId: string,
    locale: string | undefined
  ) => Promise<PreviewDocumentRead>;
  /** The collection's preview declaration, from whichever authoring path wrote it. */
  loadDeclaration: (
    collection: string
  ) => Promise<PreviewDeclaration | undefined>;
  /** The configured site URL, or `null` when none is set. */
  loadSiteUrl: () => Promise<string | null>;
}

/** A token scope reduced to what a redirect needs. */
export interface PreviewRedirectScope {
  collection: string;
  entryId: string;
  locale?: string;
}

/**
 * Why a document has no preview path, when it has none.
 *
 * Every member names a DIFFERENT person and a different next action, which is
 * the whole reason they are separate values. A missing declaration is a
 * developer's job; a document that cannot be addressed yet is usually one empty
 * field the editor can fill; a foreign origin is a settings or declaration
 * problem that no field on the entry will ever fix. Collapsing them meant the
 * editor was told to fill in a slug that was already correct.
 */
export type PreviewRefusalCause =
  /** The document is confirmed absent — deleted, or never there. */
  | "documentGone"
  /**
   * The read FAILED, so whether the document exists is unknown.
   *
   * Kept apart from `documentGone` because the remedies are opposites: one is
   * permanent and there is nothing to do, the other is usually transient and
   * the answer is to try again. Reporting a database hiccup as a deletion is
   * the same class of wrong diagnosis this whole type exists to end.
   */
  | "documentUnreadable"
  /** No `preview.url` or `urlTemplate` on this collection or Single at all. */
  | "notConfigured"
  /** Declared, but it yields no address for THIS document yet — usually an empty slug. */
  | "unavailable"
  /** The declaration named a different origin than the site is served from. */
  | "foreignOrigin"
  /** A URL that would not parse, or a path that escapes this origin. */
  | "unresolvable";

/** A site-relative path, or the reason there is not one. */
export type PreviewPathOutcome =
  | { kind: "path"; path: string }
  | { kind: "refused"; cause: PreviewRefusalCause };

/**
 * The site-relative path a preview token should land on, or `null` to refuse.
 *
 * `null` is not an error channel, and this function exists to keep it that way.
 * The preview route answers `null` with exactly the 404 an invalid token gets,
 * which is what stops the endpoint becoming an oracle for which entries exist
 * in draft: a stranger must not be able to tell a deleted entry from one that
 * was never previewable from one whose token was forged.
 *
 * So the flattening lives HERE, in one place, DERIVED from
 * {@link explainPreviewRedirect} rather than computed beside it. The route goes
 * on calling this and cannot leak a cause even by accident, while the
 * authenticated mint path — where the caller already holds `update` on the
 * document and learns nothing by being told why — calls the explaining form.
 * Two functions each deciding when to refuse would agree until one was edited,
 * and the one that drifted would be the one facing the public.
 */
export async function resolvePreviewRedirect(
  scope: PreviewRedirectScope,
  deps: PreviewRedirectDeps,
  requestOrigin?: string
): Promise<string | null> {
  return pathOrNull(await computePreviewRedirect(scope, deps, requestOrigin));
}

/** The one place an outcome becomes the route's deliberately uninformative `null`. */
function pathOrNull(outcome: PreviewPathOutcome): string | null {
  return outcome.kind === "path" ? outcome.path : null;
}

/*
 * The authenticated boundary, as a TYPE rather than a sentence.
 *
 * A docblock saying "authenticated callers only" is not a control: the correct
 * path and the easy path differ, so the rule gets broken by someone who knows
 * it — import the explaining form from an anonymous handler and the cause
 * separates a deleted draft from an unconfigured one, which is the oracle this
 * file exists to prevent.
 *
 * The symbol is NOT exported, so no other module can produce a value of this
 * type. {@link previewCallerAuthorized} is the only constructor and it demands
 * the authenticated principal, which an anonymous handler does not have — so
 * reaching the cause now requires writing a fabricated user id at the call
 * site, which is a deliberate act rather than an easy mistake.
 */
const AUTHORIZED_PREVIEW_CALLER = Symbol("nextly.preview.authorizedCaller");

/**
 * The one document a witness was granted for.
 *
 * A grant is per-DOCUMENT because that is what the mint checks: `update` on
 * this entry, or on this Single. A witness that named only its holder would
 * claim something broader than anything was ever verified.
 */
export type AuthorizedPreviewScope =
  | { collection: string; entryId: string }
  | { single: string };

/**
 * Proof that the caller was authorized FOR THIS DOCUMENT before a refusal
 * reason was handed over.
 *
 * The scope travels inside the proof because authentication is not the property
 * being relied on. `requireRouteAuthentication` returns a full `AuthContext`
 * without consulting a single permission — it exists for handlers that do their
 * own per-resource filtering — so a witness demanding only that shape would be
 * obtainable by any signed-in account, including one with no access to the
 * document it then asked about. The explainer's whole premise is that its
 * caller could already read this draft; the witness now carries the fact that
 * makes that true.
 */
export interface AuthorizedPreviewCaller {
  readonly [AUTHORIZED_PREVIEW_CALLER]: {
    userId: string;
    scope: AuthorizedPreviewScope;
  };
}

/**
 * Mint that proof. Called from ONE place: the per-document authorization gate.
 *
 * The parameter SHAPE is not the control and must not be mistaken for it. An
 * earlier version demanded the whole route-auth shape on the theory that an
 * anonymous handler could not produce one — a proxy for "you authenticated",
 * and a weak one, since any handler can assemble an object literal. What
 * actually establishes the claim is WHERE this is called from:
 * `assertEntryPreviewable` and `assertSinglePreviewable` return it only after
 * every one of their refusals has been passed FOR THIS DOCUMENT, so a grant
 * cannot exist unless the gate ran and allowed it.
 *
 * That provenance is enforced by a test asserting exactly one non-test module
 * imports this, rather than by a comment asking nicely — a second importer is
 * a failing build, which is the difference between a control and a convention.
 *
 * The identity is carried rather than discarded, and an empty one refused: a
 * gate that authorized nobody has not authorized this document either.
 */
export function previewCallerAuthorized(
  principal: { id: string },
  authorizedFor: AuthorizedPreviewScope
): AuthorizedPreviewCaller {
  if (principal.id === "") {
    /*
     * The public message stays generic and the detail goes to the log: reaching
     * this is a programming mistake in a gate, not something the person making
     * the request can act on, and naming the boundary in a response would
     * describe an internal control to whoever tripped it.
     */
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage:
        "previewCallerAuthorized requires the authenticated caller's id",
    });
  }
  return {
    [AUTHORIZED_PREVIEW_CALLER]: { userId: principal.id, scope: authorizedFor },
  };
}

/**
 * Refuse a witness granted for some OTHER document.
 *
 * Checked rather than trusted, because the grant and the question are supplied
 * by the same caller and nothing else compares them. Without this the witness
 * would still only prove "was authorized for something", and a handler holding
 * a grant for a document it may read could ask about one it may not.
 *
 * A throw rather than a refusal outcome: this is a handler passing mismatched
 * arguments, not a document that cannot be previewed, and answering it with a
 * refusal cause would hide a bug behind a legitimate-looking response.
 */
function assertGrantCovers(
  caller: AuthorizedPreviewCaller,
  asked: AuthorizedPreviewScope
): void {
  const granted = caller[AUTHORIZED_PREVIEW_CALLER].scope;
  const covers =
    "single" in asked
      ? "single" in granted && granted.single === asked.single
      : "collection" in granted &&
        granted.collection === asked.collection &&
        granted.entryId === asked.entryId;

  if (!covers) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "An unexpected error occurred.",
      logMessage:
        "a preview refusal was asked for a document the caller's grant does not cover",
    });
  }
}

/**
 * The same answer as {@link resolvePreviewRedirect}, saying why when it refuses.
 *
 * For AUTHENTICATED callers only, and the `caller` parameter is what enforces
 * that rather than this sentence. The cause distinguishes documents a stranger
 * must not be able to tell apart, so handing it to an anonymous request would
 * rebuild the oracle the `null` above exists to prevent.
 */
export async function explainPreviewRedirect(
  scope: PreviewRedirectScope,
  deps: PreviewRedirectDeps,
  caller: AuthorizedPreviewCaller,
  requestOrigin?: string
): Promise<PreviewPathOutcome> {
  // READ, not merely required. A witness nobody inspects proves only that the
  // caller could construct one, which is a weaker claim than the explainer
  // relies on.
  assertGrantCovers(caller, {
    collection: scope.collection,
    entryId: scope.entryId,
  });
  return computePreviewRedirect(scope, deps, requestOrigin);
}

/**
 * The shared computation both façades wrap.
 *
 * Private, so the flattening wrapper does not have to hold a witness to reach
 * it — the route needs no authorization to be told `null`, and making it mint
 * a proof it does not have would have turned the control into a formality.
 */
async function computePreviewRedirect(
  scope: PreviewRedirectScope,
  deps: PreviewRedirectDeps,
  requestOrigin?: string
): Promise<PreviewPathOutcome> {
  const [entry, preview, siteUrl] = await Promise.all([
    // The locale the token names, not the site's default. A localized entry's
    // slug lives in its companion row, so reading without one resolves the
    // DEFAULT language's slug and builds a path to a different translation —
    // while the draft gate goes on comparing the token's locale, so the
    // destination refuses the very draft the link was minted for.
    deps.loadEntry(scope.collection, scope.entryId, scope.locale),
    deps.loadDeclaration(scope.collection),
    deps.loadSiteUrl(),
  ]);

  // A link outlives what it points at: an entry can be deleted between minting
  // and clicking, and that is a refusal rather than a fault. A read that could
  // not answer is a different refusal, because "gone" is a claim the failed
  // read never established.
  if (entry.kind === "absent") {
    return { kind: "refused", cause: "documentGone" };
  }
  if (entry.kind === "unreadable") {
    return { kind: "refused", cause: "documentUnreadable" };
  }

  return reduceToSitePath({
    preview,
    document: entry.document,
    siteUrl,
    requestOrigin,
  });
}

/**
 * A preview declaration and a document reduced to a site-relative path.
 *
 * Shared by the entry path above and the Single path beside it rather than
 * written twice. Both ask the identical question — given a declaration and the
 * document it describes, what path on this site does it name — and two copies
 * of an origin comparison agree only until one is edited, at which point the
 * one that drifted still returns a plausible-looking path.
 */
function reduceToSitePath({
  preview,
  document,
  siteUrl,
  requestOrigin,
}: {
  preview: PreviewDeclaration | undefined;
  document: Record<string, unknown>;
  siteUrl: string | null;
  requestOrigin?: string;
}): PreviewPathOutcome {
  const resolution = resolvePreviewUrl({ preview, entry: document, siteUrl });

  // `noSiteUrl` is ACCEPTED here, and it is the case that matters most: having
  // no site URL is the default state of a fresh install.
  //
  // That state hides the admin's preview BUTTON for a good reason — the admin
  // may be served from another origin, so it has no host to put in front of a
  // path and the only one within reach is its own, which is confidently wrong.
  // This resolver is not in that position. It answers a route already running
  // ON the site, and returns a site-relative path the browser resolves against
  // the origin it is standing on. Refusing here would make preview depend on a
  // settings field it never reads.
  if (resolution.status === "noSiteUrl") {
    const path = siteRelativePath(resolution.path);
    return path === null
      ? { kind: "refused", cause: "unresolvable" }
      : { kind: "path", path };
  }

  // The two remaining non-resolved statuses are kept APART rather than folded
  // into one refusal, because they are the pair this whole return type exists
  // for: `notConfigured` is a collection nobody has declared a preview for, and
  // `unavailable` is a declared collection whose document has no address YET.
  // The first is a developer's job and the second is usually one empty field.
  if (resolution.status !== "resolved") {
    return { kind: "refused", cause: resolution.status };
  }

  // The origin is COMPARED, never stripped from the URL.
  //
  // A declaration's `url` is application code, free to return any host.
  // Removing the origin would reduce another site's URL to a bare path, and a
  // bare path is precisely what the route's site-relative guard is built to
  // approve — so the guard would run, pass, and have been handed a value that
  // already destroyed the evidence it exists to judge.
  //
  // With no site URL configured, the origin serving this request is the only
  // honest thing to compare against — and it is the right one, because this
  // answers a route running ON the site. Rejecting outright would mean a fresh
  // installation whose declaration returns an absolute same-origin URL still
  // gets a 404.
  const comparisonOrigin = siteUrl ?? requestOrigin;
  if (comparisonOrigin === undefined) {
    return { kind: "refused", cause: "unresolvable" };
  }
  try {
    const target = new URL(resolution.url);
    const site = new URL(comparisonOrigin);
    // Named rather than folded into `unresolvable`: this is the one refusal an
    // editor can neither cause nor cure, so telling them to fill in a field
    // sends them to look at a slug that was correct all along.
    if (target.origin !== site.origin) {
      return { kind: "refused", cause: "foreignOrigin" };
    }
    return {
      kind: "path",
      path: `${target.pathname}${target.search}${target.hash}`,
    };
  } catch {
    // An unparseable site URL or target. Both are configuration a visitor
    // cannot act on, and both refuse the same way everything else here does.
    return { kind: "refused", cause: "unresolvable" };
  }
}

/**
 * A path that cannot leave this origin, or `null`.
 *
 * Used only where no site URL exists to compare an origin against. A leading
 * slash is not sufficient on its own: `//host` and `/\host` both reach another
 * origin, because a special scheme normalises a backslash to a slash. Both
 * arrive here rather than being caught earlier, since neither parses as an
 * absolute URL either.
 *
 * The parser is asked rather than the list of spellings restated, so this
 * cannot fall behind what a browser accepts. The base is a sentinel that
 * appears in no output: anything still pointing at it after resolution stayed
 * on the current origin, and anything that moved away named a host.
 */
const RESOLUTION_BASE = "https://preview.invalid";

function siteRelativePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  try {
    const resolved = new URL(path, RESOLUTION_BASE);
    if (resolved.origin !== RESOLUTION_BASE) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

/** What resolving a Single's redirect needs from the outside world. */
export interface SinglePreviewRedirectDeps {
  /**
   * The Single's document in the locale the token names, and whether the read
   * could answer at all.
   *
   * A Single is addressed by slug, so unlike an entry there is nothing to look
   * up by id — but the document is still needed, because a declaration may
   * derive the path from it.
   */
  loadSingle: (
    slug: string,
    locale: string | undefined
  ) => Promise<PreviewDocumentRead>;
  /** The Single's preview declaration, from whichever authoring path wrote it. */
  loadDeclaration: (slug: string) => Promise<PreviewDeclaration | undefined>;
  /** The configured site URL, or `null` when none is set. */
  loadSiteUrl: () => Promise<string | null>;
}

/** A Single-scoped token reduced to what a redirect needs. */
export interface SinglePreviewRedirectScope {
  single: string;
  locale?: string;
}

/**
 * The site-relative path a Single's preview token should land on, or `null`.
 *
 * Deliberately its own function rather than a branch inside the entry resolver:
 * the two differ in everything they LOAD — one by id from a collection, one by
 * slug with no id at all — and share only what they do with the result, which
 * is `reduceToSitePath` and is called by both.
 */
export async function resolveSinglePreviewRedirect(
  scope: SinglePreviewRedirectScope,
  deps: SinglePreviewRedirectDeps,
  requestOrigin?: string
): Promise<string | null> {
  return pathOrNull(
    await computeSinglePreviewRedirect(scope, deps, requestOrigin)
  );
}

/**
 * The same answer as {@link resolveSinglePreviewRedirect}, saying why it refused.
 *
 * Authenticated callers only, on the same grounds as
 * {@link explainPreviewRedirect}: the cause separates cases a stranger must not
 * be able to tell apart.
 */
export async function explainSinglePreviewRedirect(
  scope: SinglePreviewRedirectScope,
  deps: SinglePreviewRedirectDeps,
  caller: AuthorizedPreviewCaller,
  requestOrigin?: string
): Promise<PreviewPathOutcome> {
  // See {@link explainPreviewRedirect}: the grant is compared against the
  // document actually being asked about, not merely presented.
  assertGrantCovers(caller, { single: scope.single });
  return computeSinglePreviewRedirect(scope, deps, requestOrigin);
}

/** The shared computation both Single façades wrap. See {@link computePreviewRedirect}. */
async function computeSinglePreviewRedirect(
  scope: SinglePreviewRedirectScope,
  deps: SinglePreviewRedirectDeps,
  requestOrigin?: string
): Promise<PreviewPathOutcome> {
  const [document, preview, siteUrl] = await Promise.all([
    deps.loadSingle(scope.single, scope.locale),
    deps.loadDeclaration(scope.single),
    deps.loadSiteUrl(),
  ]);

  // A Single is never deleted the way an entry is, but it can be removed from
  // the configuration, and a link minted before that is a link to nothing. A
  // read that failed is a different answer: it establishes nothing about
  // whether the Single is still configured.
  if (document.kind === "absent") {
    return { kind: "refused", cause: "documentGone" };
  }
  if (document.kind === "unreadable") {
    return { kind: "refused", cause: "documentUnreadable" };
  }

  return reduceToSitePath({
    preview,
    document: document.document,
    siteUrl,
    requestOrigin,
  });
}
